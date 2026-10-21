/* Story planning, one step at a time, with explicit inputs and outputs.
 *
 * Each function is one node of the planning core: it reads what it is handed and
 * the job's live inputs (locked constraints, direction roster, writer style,
 * held research by key), and returns what the next node needs. What crosses a
 * wait — the shape, the frame, the research key, the plan — is plain data the
 * workflow engine keeps in flow state, so a resumed draft never depends on a
 * closure from before the wait. */
import type { z } from "zod";
import { planStoryArgs } from "../helpers/schemas.ts";
import type { AgentJob } from "../model.ts";
import { researchOf } from "../research-state.ts";
import { storyInputsOf } from "../story-inputs.ts";
import {
	clarificationPlanningText,
	clarificationProvenance,
	postResearchProvenance,
} from "../story-clarification.ts";
import {
	clarificationContradictions,
	clarificationPlanningBlock,
	verifyStoryClarification,
	type StoryClarificationBatch,
	type StoryClarificationProvenance,
} from "@maleo/shared";
import {
	DEFAULT_TIMELINE_TEMPLATE,
	bibleWithDirectedReferences,
	bindingIdentity,
	canonicalizeLegacyStoryPlan,
	forbiddenPhraseHits,
	normalizeVideoPlanKind,
	resolveStoryStructure,
	storyArcCoverageNote,
	storyArcCoverageViolations,
	storyDensityFor,
	type DirectedReferenceEntry,
	type StoryBible,
	type StoryStructure,
	type WriterStyleProfile,
} from "@maleo/shared";
import {
	analyzeEvidenceDecisions,
	priorDecisionsFrom,
	suspendForPostResearchClarification,
	type EvidenceDecisionOutcome,
} from "../post-research-clarification.ts";
import { workspaceWriterStyle } from "../../../../lib/config-yaml.ts";
import {
	distributeWordBudget,
	wordBudgetForTarget,
	type StorySection,
} from "../../../../lib/story.ts";
import {
	authorStoryBible,
	generateStyleBible,
	planStoryFrame,
	planStoryFromFrame,
	storyPlanShape,
	type StoryFrame,
	type StoryPlanDraft,
	type StoryPlanShape,
	type StoryResearchEvidence,
} from "../../../../lib/content-generator.ts";
import {
	loadStyleBibleReference,
	saveStyleBibleReference,
	recordAgentToolEvent,
} from "../../../../lib/agent-trace.ts";
import { runResearch } from "./research.ts";
import { matchingResearch, materializePlannedSections, planVerification } from "../evidence.ts";
import { setStoryPlan, emitPlanTable } from "../plan-state.ts";
import { lockedConstraintsFor } from "../visual-gen.ts";
import { persist } from "../persistence.ts";
import { emitToolCall, pushNote } from "../trace.ts";
import { fingerprintBrief } from "./util.ts";
import { storyPromptLayers, voicePromptLayers } from "../material-layers.ts";
import {
	currentStoryDirectionFingerprint,
	directionOptionsFor,
	storyDirectionInputsFor,
} from "./storyboard-command-service.ts";
import type { ResearchBundle } from "../../../../lib/web-research.ts";

export type PlanStoryArgs = z.output<typeof planStoryArgs>;

export function directedBibleEntries(
	plan: Pick<StoryPlanDraft, "sections" | "plannedReferences" | "referenceAliases">,
	roster: Awaited<ReturnType<typeof directionOptionsFor>>["roster"],
): DirectedReferenceEntry[] {
	const aliases = new Map((plan.referenceAliases ?? []).map((entry) => [entry.ref, entry.aliases]));
	const planned = new Map((plan.plannedReferences ?? []).map((entry) => [entry.key, entry]));
	const entities = new Map(roster.map((entry) => [entry.id, entry]));
	const identities = new Set(
		plan.sections.flatMap(
			(section) =>
				section.editorial?.shots?.flatMap((shot) => shot.bindings.map(bindingIdentity)) ?? [],
		),
	);
	return [...identities].flatMap((identity): DirectedReferenceEntry[] => {
		if (identity.startsWith("entity:")) {
			const entity = entities.get(identity.slice("entity:".length));
			return entity
				? [
						{
							identity,
							role: entity.role,
							label: entity.label,
							description: entity.description,
							aliases: aliases.get(identity),
						},
					]
				: [];
		}
		const reference = planned.get(identity.slice("planned:".length));
		return reference
			? [
					{
						identity,
						role: reference.role,
						label: reference.label,
						description: reference.description,
						aliases: aliases.get(identity),
					},
				]
			: [];
	});
}

export async function workspaceBreath(job: AgentJob) {
	const writerStyle = await workspaceWriterStyle(job.workspace);
	return {
		writerStyle,
		breath: writerStyle
			? {
					sentencesPerHundredWords: writerStyle.sentencesPerHundredWords,
					sentencePauseSec: (job.timelineTemplate ?? DEFAULT_TIMELINE_TEMPLATE)
						.sentenceVoiceoverPauseSec,
				}
			: undefined,
	};
}

export function writerStyleWarning(
	sections: readonly StorySection[],
	writerStyle: WriterStyleProfile | undefined,
): string {
	if (!writerStyle) return "";
	const hits = sections.flatMap((section, index) =>
		forbiddenPhraseHits(section.narration, writerStyle).map((phrase) => `${index + 1}:"${phrase}"`),
	);
	return hits.length
		? ` Writer style (${writerStyle.label}) — avoid: ${hits.join(", ")}. Advisory only; approve when you are happy with the prose.`
		: "";
}

/* The options both the frame and the draft plan with, re-derived from live inputs
 * each time. `sectionCount`/`wordBudget` are the PRE-shape values, which
 * `storyPlanShape` then clamps; passing the clamped ones back in would re-clamp an
 * already-clamped number. */
export async function planOptsFor(
	job: AgentJob,
	args: PlanStoryArgs,
	input: {
		sectionCount: number;
		wordBudget: number;
		structure: StoryStructure;
		writerStyle: WriterStyleProfile | undefined;
	},
) {
	return {
		sectionCount: input.sectionCount,
		wordBudget: input.wordBudget,
		locked: await lockedConstraintsFor(job),
		language: job.language || undefined,
		structure: input.structure,
		planKind: normalizeVideoPlanKind(args.planKind),
		arc: args.arc,
		writerStyle: input.writerStyle,
		direction: await directionOptionsFor(job),
		// Configuration may demand grounding the frame did not ask for; it can never
		// switch grounding off. This is what makes `researchFirst` load-bearing.
		requireGrounding: job.run?.pipeline?.profile.researchFirst,
	};
}

/* ── setup and preservation ── */

export interface PlanningSetup {
	brief: string;
	clarification: string;
	targetSec: number;
	structure: StoryStructure;
	sectionCount: number;
	wordsPerSec: number;
}

export async function setupPlanning(job: AgentJob, args: PlanStoryArgs): Promise<PlanningSetup> {
	const { breath } = await workspaceBreath(job);
	const brief = storyPromptLayers(args.brief || job.brief, job.direction);
	const clarification = clarificationPlanningText(job);
	const targetSec = Math.max(5, args.targetDurationSec ?? job.targetDurationSec ?? 60);
	if (targetSec !== job.targetDurationSec) job.targetDurationSec = targetSec;
	const structure = resolveStoryStructure(args.structure, targetSec);
	const density = storyDensityFor(structure, targetSec, breath);
	return {
		brief,
		clarification,
		targetSec,
		structure,
		sectionCount: args.sectionCount ?? density.sectionCount,
		wordsPerSec: density.wordsPerSec,
	};
}

/** Whether the plan the project holds already has generated (or failed) sections. */
export function planHasGeneratedWork(job: AgentJob): boolean {
	return Boolean(
		storyInputsOf(job).plan?.sections.some(
			(section) => section.status && section.status !== "draft",
		),
	);
}

export function preservedPlanNote(job: AgentJob): string {
	const existing = storyInputsOf(job).plan!;
	const generated = existing.sections.filter(
		(section) => section.status && section.status !== "draft",
	);
	const ready = generated.filter((section) => section.status === "ready").length;
	const failed = generated.filter((section) => section.status === "failed").length;
	return `Story plan already in progress (${existing.sections.length} sections, ${ready} ready, ${failed} failed) — not re-planning, which would discard generated work. Use generate_story_assets to resume (it retries the failed/missing sections), or regenerate_section to redo one. To start over, clear the plan first.`;
}

/* ── brief and frame ── */

export interface PlanningBrief {
	wordBudget: number;
	scriptingBrief: string;
}

export async function bindPlanningBrief(
	job: AgentJob,
	setup: PlanningSetup,
): Promise<PlanningBrief> {
	const { breath } = await workspaceBreath(job);
	const { structure, targetSec, brief, clarification, sectionCount } = setup;
	const wordBudget =
		structure === "narration_section"
			? wordBudgetForTarget(targetSec, breath)
			: Math.round(targetSec * setup.wordsPerSec);
	pushNote(
		job,
		"Planning",
		structure === "narration_section"
			? `Drafting the story plan for ~${Math.round(targetSec / 60)} min (~${wordBudget} words)…`
			: `Drafting the story plan for ~${targetSec}s across ~${sectionCount} beats…`,
	);
	return {
		wordBudget,
		scriptingBrief: [voicePromptLayers(brief, job.direction), clarification]
			.filter(Boolean)
			.join("\n\n"),
	};
}

export interface PlanningFrame {
	shape: StoryPlanShape;
	frame: StoryFrame;
	grounded: boolean;
	/** The key of research the run already holds for this brief, if any. */
	matchedKey: string | null;
}

export async function frameStory(
	job: AgentJob,
	args: PlanStoryArgs,
	setup: PlanningSetup,
	brief: PlanningBrief,
): Promise<PlanningFrame> {
	const { writerStyle } = await workspaceBreath(job);
	const planOpts = await planOptsFor(job, args, {
		sectionCount: setup.sectionCount,
		wordBudget: brief.wordBudget,
		structure: setup.structure,
		writerStyle,
	});
	const shape = storyPlanShape(setup.targetSec, planOpts);
	let frame: StoryFrame;
	try {
		frame = await planStoryFrame(
			brief.scriptingBrief,
			setup.targetSec,
			shape.sectionCount,
			planOpts,
		);
	} catch (err) {
		throw new Error(`Story planning failed: ${err instanceof Error ? err.message : String(err)}`);
	}
	const matched = matchingResearch(storyInputsOf(job).research, setup.brief);
	return {
		shape,
		frame,
		grounded: frame.grounding.needed,
		matchedKey: matched ? fingerprintBrief(matched.topic) : null,
	};
}

/* ── research ── */

export async function retrievePlanningResearch(
	job: AgentJob,
	topic: string,
	questions: readonly string[],
): Promise<{ key: string | null }> {
	const startedAt = Date.now();
	const input = { topic, questions: [...questions] };
	job.events.push({ kind: "tool_call_started", tool: "research_topic", args: input });
	const result = await runResearch(job, input);
	job.events.push({ kind: "tool_call_completed", tool: "research_topic", note: result.note });
	await recordAgentToolEvent(job, {
		toolCallId: crypto.randomUUID(),
		tool: "research_topic",
		args: input,
		note: result.note,
		ok: Boolean(result.bundle),
		startedAt,
	});
	const research = result.bundle?.sources.length ? result.bundle : undefined;
	if (!research) pushNote(job, "Research", result.note);
	return { key: research ? fingerprintBrief(research.topic) : null };
}

/** The held bundle, by identity. A key with no matching bundle means the research
 *  planning held is gone; the plan is then ungrounded and says so. */
export function heldResearch(
	job: AgentJob,
	key: string | null | undefined,
): ResearchBundle | undefined {
	if (!key) return undefined;
	const held = researchOf(job);
	return held && fingerprintBrief(held.topic) === key ? held : undefined;
}

export interface PlanningHold {
	researchKey: string | null;
	sourceCount: number;
	/** The pre-research decisions as they stood when planning held its state. */
	clarification: StoryClarificationProvenance | null;
}

export function holdPlanning(job: AgentJob, researchKey: string | null): PlanningHold {
	return {
		researchKey,
		sourceCount: heldResearch(job, researchKey)?.sources.length ?? 0,
		clarification: clarificationProvenance(job) ?? null,
	};
}

export function evidenceOf(
	research: ResearchBundle | undefined,
): StoryResearchEvidence | undefined {
	return research && research.sources.length
		? { sources: research.sources.map((s) => ({ url: s.url, title: s.title, excerpt: s.excerpt })) }
		: undefined;
}

/* ── post-research decisions ── */

export async function decideEvidence(
	job: AgentJob,
	args: PlanStoryArgs,
	brief: string,
	frame: StoryFrame,
	hold: PlanningHold,
): Promise<EvidenceDecisionOutcome> {
	const research = heldResearch(job, hold.researchKey);
	return analyzeEvidenceDecisions({
		brief,
		request: args.brief || job.brief || "",
		planKind: frame.planKind,
		language: frame.language,
		sources: (research?.sources ?? []).map((source) => ({
			title: source.title,
			url: source.url,
			excerpt: source.excerpt,
		})),
		priorDecisions: priorDecisionsFrom(hold.clarification ?? undefined),
	});
}

export function reportEvidenceFallback(job: AgentJob, reason: string): void {
	pushNote(
		job,
		"Evidence review",
		`Could not review the sources for editorial decisions — continuing on best judgment. (${reason})`,
	);
}

export async function askEvidenceDecision(
	job: AgentJob,
	batch: StoryClarificationBatch,
): Promise<{ question: string; actionId: string; note: string }> {
	const actionId = await suspendForPostResearchClarification(job, batch);
	if (!actionId)
		throw new Error(
			"Story planning cannot pause for questions: the required action did not persist.",
		);
	const count = batch.questions.length;
	const note = `Researched the topic and found ${count} editorial decision${count === 1 ? "" : "s"} only you can make — planning is paused until you answer.`;
	return { question: job.pendingQuestion?.question ?? note, actionId, note };
}

/* ── draft and materialize ── */

export async function draftPlannedStory(
	job: AgentJob,
	args: PlanStoryArgs,
	setup: PlanningSetup,
	brief: PlanningBrief,
	framed: PlanningFrame,
	hold: PlanningHold,
): Promise<StoryPlanDraft> {
	/* Re-validated, not cast: the arguments crossed JSON and possibly a process
	 * boundary, and coercing them through the tool's own schema is the discipline
	 * they passed on the way in. */
	const parsed = planStoryArgs.parse(args);
	const { writerStyle } = await workspaceBreath(job);
	const planOpts = await planOptsFor(job, parsed, {
		sectionCount: setup.sectionCount,
		wordBudget: brief.wordBudget,
		structure: setup.structure,
		writerStyle,
	});
	const evidence = evidenceOf(heldResearch(job, hold.researchKey));
	/* What the user chose after reading the sources, beside the request, never over
	 * it — a chosen case study that never reached the draft would have cost the user
	 * a question and changed nothing. */
	const draftBrief = [brief.scriptingBrief, clarificationPlanningBlock(postResearchProvenance(job))]
		.filter(Boolean)
		.join("\n\n");
	try {
		return await planStoryFromFrame(draftBrief, setup.targetSec, framed.frame, framed.shape, {
			...planOpts,
			research: evidence,
			allowInfographics: job.timelineTemplate?.useData !== false,
			direction: await directionOptionsFor(job),
		});
	} catch (err) {
		throw new Error(`Story planning failed: ${err instanceof Error ? err.message : String(err)}`);
	}
}

export function materializePlan(
	job: AgentJob,
	wordBudget: number,
	plan: StoryPlanDraft,
	hold: PlanningHold,
	grounded: boolean,
): StorySection[] {
	const budgets = distributeWordBudget(wordBudget, plan.sections.length);
	const allowData = job.timelineTemplate?.useData !== false;
	return materializePlannedSections(
		plan.sections,
		0,
		evidenceOf(heldResearch(job, hold.researchKey)),
		grounded,
		budgets,
	).map((section) =>
		allowData
			? section
			: {
					...section,
					motionGraphic: {
						needed: false,
						kind: "none" as const,
						purpose: "none" as const,
						reason: "Timeline template disables data overlays.",
					},
				},
	);
}

/* ── style and Story Bible ── */

export async function loadPlanStyle(job: AgentJob): Promise<string | null> {
	return (await loadStyleBibleReference(job.projectId)) ?? null;
}

export async function generatePlanStyle(job: AgentJob, brief: string): Promise<string | null> {
	let visualStyle: string | null = null;
	await emitToolCall(job, "generate_style", { brief }, async () => {
		visualStyle = await generateStyleBible(brief, await lockedConstraintsFor(job));
		const preview = visualStyle.length > 160 ? `${visualStyle.slice(0, 160)}…` : visualStyle;
		return { note: `Locked visual style: ${preview}`, effect: "asset" as const };
	});
	return visualStyle;
}

export async function savePlanStyle(job: AgentJob, visualStyle: string): Promise<void> {
	await saveStyleBibleReference(job, visualStyle);
}

/* The story's visual constants as fields, authored once here. Traced like the
 * style call beside it, and non-fatal for the same reason: a plan without a bible
 * still generates through the legacy prose path. */
export async function authorPlanBible(
	job: AgentJob,
	brief: string,
	plan: StoryPlanDraft,
	visualStyle: string | undefined,
): Promise<StoryBible | null> {
	const directionRoster = (await directionOptionsFor(job)).roster;
	const referenceEntries = plan.needsDirection ? [] : directedBibleEntries(plan, directionRoster);
	let bible: StoryBible | null = null;
	await emitToolCall(
		job,
		"author_story_bible",
		{ brief, plannedReferences: plan.plannedReferences?.length ?? 0 },
		async () => {
			const descriptive = await authorStoryBible(brief, {
				locked: await lockedConstraintsFor(job),
				summary: visualStyle,
				boundLabels: referenceEntries.map((entry) => entry.label),
				povLifecycle: plan.povLifecycle,
				language: job.language || plan.language,
			});
			const authored = bibleWithDirectedReferences(descriptive, referenceEntries);
			bible = authored;
			return {
				note: `Story bible: ${authored.subjects.length} subject(s), ${authored.locations.length} location(s)${authored.palette ? `, palette ${authored.palette}` : ""}.`,
				effect: "asset" as const,
			};
		},
	);
	return bible;
}

/* ── save ── */

export interface PersistPlanInput {
	brief: string;
	grounded: boolean;
	targetSec: number;
	structure: StoryStructure;
	wordBudget: number;
	hold: PlanningHold;
	plan: StoryPlanDraft;
	sections: StorySection[];
	visualStyle?: string;
	bible?: StoryBible;
}

/** Write the plan, report it, and return the planning note. */
export async function persistPlannedStory(job: AgentJob, input: PersistPlanInput): Promise<string> {
	const { brief, grounded, targetSec, structure, wordBudget, plan, sections, visualStyle, bible } =
		input;
	const { writerStyle } = await workspaceBreath(job);
	const research = heldResearch(job, input.hold.researchKey);
	const evidence = evidenceOf(research);
	const postResearch = postResearchProvenance(job);
	const unverified = !evidence && grounded;

	/* The plan's clarification provenance, checked against what the plan holds. A
	 * decision nothing structural can verify stays SUPPLIED; only one naming a field
	 * the plan carries is reported honored, or contradicted when the plan disagrees.
	 * From the hold first: a completion resumed in a fresh process has the hold but
	 * not necessarily the run state the batch was recorded on. */
	const clarificationProv = input.hold.clarification ?? clarificationProvenance(job);
	const verifiedClarification =
		clarificationProv?.status === "answered"
			? verifyStoryClarification(clarificationProv, {
					language: job.language || plan.language,
					planKind: plan.planKind,
				})
			: clarificationProv;
	const contradictions = clarificationContradictions(verifiedClarification);
	const generationState = canonicalizeLegacyStoryPlan(sections);
	const directionFingerprint = plan.needsDirection
		? undefined
		: await currentStoryDirectionFingerprint(job, sections);
	setStoryPlan(job, targetSec, sections, true, unverified, {
		planningBrief: brief,
		factual: grounded,
		researchKey: research ? fingerprintBrief(research.topic) : null,
		visualStyle,
		bible,
		clarification: verifiedClarification,
		postResearchClarification: postResearch,
		engagement: plan.engagement,
		planKind: plan.planKind,
		arc: plan.arc,
		frameDegraded: plan.frameDegraded,
		explainerContract: plan.explainerContract,
		povLifecycle: plan.povLifecycle,
		structure,
		language: job.language || plan.language,
		plannedReferences: plan.plannedReferences,
		referenceAliases: plan.referenceAliases,
		directionFingerprint,
		directionInputs: await storyDirectionInputsFor(job),
		needsDirection: plan.needsDirection,
		directionBlocked: plan.directionBlocked,
		directionErrors: plan.directionErrors,
		generationState,
	});
	// Persist the plan into a storyboard version now, in the same step that created
	// it: a later step rehydrates the job from storyboards, and a plan held only in
	// memory would be gone by generation.
	await persist(job);
	const arcTitle = plan.arc ? ` · ${plan.arc}` : "";
	emitPlanTable(
		job,
		sections,
		structure === "narration_section"
			? `Story plan${arcTitle} · ${sections.length} sections · ~${Math.round(targetSec / 60)} min`
			: `Story plan${arcTitle} · ${sections.length} beats · ~${targetSec}s`,
	);
	job.events.push({ kind: "storyboard_patch" });
	const verification = planVerification(sections);
	const cited = verification.coverage?.verified ?? 0;
	const grounding = evidence
		? ` ${verification.status?.toUpperCase() ?? "UNVERIFIED"}: ${research!.sources.length} source(s), ${cited}/${verification.coverage?.total ?? 0} factual sections citation-verified.`
		: unverified
			? " UNVERIFIED DRAFT — no web sources were retrieved; claims are model recollection, not cited."
			: "";
	const unit = structure === "narration_section" ? "sections" : "beats";
	// Reported, never gated: prose taste and pacing are opinions, not defects.
	const craftNote = writerStyleWarning(sections, writerStyle);
	const arcViolations = storyArcCoverageViolations({
		arc: plan.arc,
		sections,
		engagement: plan.engagement,
	});
	const arcNote = plan.arc
		? ` Arc: ${plan.arc}.${arcViolations.length ? ` Structure warnings — ${storyArcCoverageNote(arcViolations)}. Advisory only; approve when the pacing reads right to you.` : ""}`
		: "";
	const degradedNote = plan.frameDegraded
		? " NOTE: the framing stage failed, so the arc and language came from defaults rather than from the brief."
		: "";
	const undrafted = sections.filter((section) => section.needsDrafting).length;
	const undraftedNote = undrafted
		? ` ${undrafted} section(s) never drafted and are kept empty — re-run planning or edit them by hand.`
		: "";
	// An ignored decision is reported as ignored.
	const clarificationNote = contradictions.length
		? ` NOTE: the plan does not honor ${contradictions.length} clarification decision(s) — ${contradictions.map((decision) => `${decision.header}: asked for "${decision.answer}", plan has "${decision.planValue ?? "something else"}"`).join("; ")}.`
		: verifiedClarification?.status === "answered" && verifiedClarification.decisions.length
			? ` Planning received ${verifiedClarification.decisions.length} clarification decision(s).`
			: "";
	// Said separately from the pre-research count: a different fact.
	const postResearchNote =
		postResearch?.status === "answered" && postResearch.decisions.length
			? ` Drafted against ${postResearch.decisions.length} post-research decision(s) — ${postResearch.decisions.map((decision) => `${decision.header}: ${decision.answer}`).join("; ")}.`
			: "";
	return `Planned ${sections.length} ${unit} (~${wordBudget} words).${grounding}${arcNote}${degradedNote}${undraftedNote}${clarificationNote}${postResearchNote}${craftNote} Review the story plan, then approve to generate voiceover + images.`;
}
