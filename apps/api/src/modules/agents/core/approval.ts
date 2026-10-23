/* Human-in-the-loop suspension + resume. Parks a run on awaiting_input (a
 * clarifying ask_user question, a pipeline stage approval, or an existing-edit
 * gate) and, on the user's answer, resumes the parked pipeline: applies the
 * approval choice, runs the approved stage (edit commit or asset generation), and
 * re-suspends or finishes. Also builds the end-of-run storyboard table. */
import { storyInputsOf } from "./story-inputs.ts";
import { groundedResearch } from "./research-state.ts";
import { askUserInput } from "./tools/ask-user.ts";
import { beginStoryClarification } from "./story-clarification.ts";
import type { StoryClarificationBatch } from "@maleo/shared";
import { audioKindLabel } from "@maleo/shared/audio-overlays";
import { type ApprovalChoice, type PipelineRun } from "./pipeline.ts";
import { persist } from "./persistence.ts";
import { emitToolCall } from "./trace.ts";
import { getStoryPlan } from "./plan-state.ts";
import { redraftStoryPlanFlow } from "./services/planning.ts";
import { researchAgain } from "./services/research.ts";
import { str } from "./services/util.ts";
import { planVerification } from "./evidence.ts";
import { recordPipelineCheckpoint } from "../../../lib/agent-trace.ts";
import { recordRequiredAction, saveRun } from "./run-repository.ts";
import type { AgentJob, StoryboardTableRow } from "./model.ts";
import { currentProducer, putJobArtifact } from "./artifact-store.ts";
import { emitWorkflowProgress, makeWorkflowPlan, setWorkflowItem } from "./workflow-progress.ts";

// Build + emit a readable storyboard table (Timestamp / Content) from the current
// timeline so every run ends with a clip-first summary the user can scan.
export function emitStoryboardTable(job: AgentJob): void {
	if (!job.scenes.length) return;
	const rows: StoryboardTableRow[] = [];
	let acc = 0;
	for (const s of job.scenes) {
		const start = acc;
		acc += Math.max(1, s.durationSec);
		rows.push({ startSec: start, endSec: acc, content: s.visual?.trim() || s.name, kind: "scene" });
		if (s.voiceover?.trim())
			rows.push({
				startSec: start,
				endSec: acc,
				content: `Voiceover: "${s.voiceover.trim()}"`,
				kind: "voiceover",
			});
	}
	for (const t of job.textOverlays)
		rows.push({
			startSec: t.startSec,
			endSec: t.startSec + t.durationSec,
			content: `Text: ${t.content}`,
			kind: "text",
		});
	// Real timeline clips (cross-beat voiceover/music, b-roll) — table reads clips, not
	// just scene beats, so a voiceover spanning beats shows its true span.
	for (const a of job.audioOverlays)
		rows.push({
			startSec: a.startSec,
			endSec: a.startSec + a.durationSec,
			content: `${audioKindLabel(a.kind, a.origin)}: ${(a.content || a.url || "").slice(0, 80)}`,
			kind: "voiceover",
		});
	for (const v of job.videoOverlays)
		rows.push({
			startSec: v.startSec,
			endSec: v.startSec + v.durationSec,
			content: `${v.kind === "video" ? "Video" : "Image"}: ${v.label || v.url}`,
			kind: "scene",
		});
	rows.sort((a, b) => a.startSec - b.startSec || (a.kind === "scene" ? -1 : 1));
	const table = putJobArtifact(
		job,
		"storyboard_table",
		{ title: "Storyboard", rows },
		currentProducer(job),
	);
	job.events.push({ kind: "artifact", artifact: table });
}

// Suspend the run on ask_user (Design B): surface the question + option chips and
// flip to awaiting_input. The caller already persisted job.run (position +
// transcript); resumeAgentJob() continues from there once the user answers.
export async function suspendForQuestion(
	job: AgentJob,
	rawArgs: Record<string, unknown>,
): Promise<void> {
	const parsed = askUserInput.safeParse(rawArgs);
	const q = parsed.success
		? parsed.data
		: {
				question: str(rawArgs.question, "Could you clarify what you'd like me to do?"),
				options: undefined,
			};
	job.pendingQuestion = q;
	// Record the required_action + stamp its id BEFORE persist, so the snapshot
	// carries pendingActionId — the answer route needs it to match the wait after a
	// restart rehydrates the job from the DB.
	job.pendingActionId = await recordRequiredAction(job, "ask_user");
	// Status after the id: a reader of this shared job never sees a wait with no action to answer.
	job.status = "awaiting_input";
	job.events.push({
		kind: "question",
		question: q.question,
		options: q.options,
		actionId: job.pendingActionId,
	});
	await persist(job);
	// Checkpoint the full job (Phase 4) so an ask_user pause — like a pipeline
	// approval — can rehydrate on a different instance / after a restart.
	await recordPipelineCheckpoint(job, { label: "clarification", status: "awaiting_input" });
}

/* Suspend on the ONE pre-research story clarification batch.
 *
 * The same suspension machinery as every other gate — one required_action, one
 * `awaiting_input`, one checkpoint — so the existing awaiting-input timeout and
 * abandonment path govern it without a second implementation. `question` and
 * `options` stay populated from the first question so a client that predates
 * batches still renders something answerable. */
export async function suspendForStoryClarification(
	job: AgentJob,
	batch: StoryClarificationBatch,
): Promise<void> {
	const first = batch.questions[0]!;
	const q: NonNullable<AgentJob["pendingQuestion"]> = {
		question:
			batch.questions.length > 1
				? `${batch.intro?.trim() || "A few decisions before I plan this story."} (${batch.questions.length} questions)`
				: first.question,
		options: first.options.map((option) => ({ label: option.label, value: option.value })),
		batch,
	};
	beginStoryClarification(job, batch);
	job.pendingQuestion = q;
	// Stamp pendingActionId before persist (see suspendForQuestion) and mirror it
	// onto the batch state, so a submission carrying a superseded action id is
	// rejected rather than applied to whatever is pending now.
	job.pendingActionId = await recordRequiredAction(job, "ask_user");
	// Status after the id: a reader of this shared job never sees a wait with no action to answer.
	job.status = "awaiting_input";
	if (job.run?.storyClarification) job.run.storyClarification.actionId = job.pendingActionId;
	job.events.push({
		kind: "question",
		question: q.question,
		options: q.options,
		actionId: job.pendingActionId,
		batch,
	});
	await persist(job);
	await recordPipelineCheckpoint(job, { label: "story clarification", status: "awaiting_input" });
}

export function parsePipelineApprovalChoice(answer: string): ApprovalChoice | null {
	const clean = answer.toLowerCase().replace(/\s+/g, " ").trim();
	if (/\b(reject|rejected|revise|cancel|no|tolak)\b/.test(clean)) return "reject";
	if (/\b(approve all|approve-all|all|lanjut semua|generate all)\b/.test(clean))
		return "approve_all";
	if (/\b(approve|approved|yes|ok|lanjut|generate|proceed)\b/.test(clean)) return "approve";
	return null;
}

/* What the plan is grounded in, said at the gate.
 *
 * These counts already existed — `planVerification` scores them and the research
 * card carries the sources — but they lived beside the decision instead of in it.
 * The one moment an operator spends assets is the moment they should learn the
 * script cites nothing. Reported, never blocking: a thin citation is a judgement
 * call, not a wasted provider call. */
export function groundingSummary(job: AgentJob): string {
	const plan = getStoryPlan(job);
	if (!plan?.sections.length) return "";
	// What the plan cites, by its own reference — not research fetched since.
	const sources = groundedResearch(job)?.sources.length ?? 0;
	const verification = planVerification(plan.sections);
	if (!plan.factual) return "";
	if (!sources)
		return " Grounding was requested for this brief and no sources were retrieved — the narration is model recollection, not cited.";
	const total = verification.coverage?.total ?? 0;
	const verified = verification.coverage?.verified ?? 0;
	const uncited = total - verified;
	return ` Grounded in ${sources} retrieved source(s); ${verified}/${total} factual section(s) citation-verified${uncited ? `, ${uncited} citing none` : ""}.`;
}

/* An approval the agent runtime asks for before a tool changes approved or
 * existing work. The same question card, required action and checkpoint as a
 * pipeline gate, without a pipeline cursor: the run resumes into the tool that
 * asked (adopt-mastra-internal-agent 2.3). */
export const APPROVAL_OPTIONS = [
	{ label: "Approve", value: "approve" },
	{ label: "Approve all", value: "approve all" },
	{ label: "Reject", value: "reject" },
];

export async function suspendForToolApproval(
	job: AgentJob,
	summary: string,
	label: string,
	options = APPROVAL_OPTIONS,
): Promise<void> {
	const q = { question: summary, options };
	job.pendingQuestion = q;
	// Stamp pendingActionId before persist (see suspendForQuestion).
	job.pendingActionId = await recordRequiredAction(job, "approve");
	// Status after the id: a reader of this shared job never sees a wait with no action to answer.
	job.status = "awaiting_input";
	job.events.push({
		kind: "question",
		question: q.question,
		options: q.options,
		actionId: job.pendingActionId,
	});
	await persist(job);
	await recordPipelineCheckpoint(job, { label, status: "awaiting_input" });
}

/* Park a rejected plan gate, holding everything pre-production already paid for.
 *
 * What this replaces set `status = "done"` and told the operator to send a
 * revision, which started a new run: the frame, the skeleton and the retrieved
 * research were all thrown away to change a sentence. The run now waits at the
 * same gate with the plan intact, and the next free-text answer is the revision. */
/* Ask what to change in a rejected plan. With a pipeline run, the run parks on its
 * cursor; without one (the agent runtime), the caller suspends its own step. */
export async function suspendForPlanRevision(
	job: AgentJob,
	run: PipelineRun | undefined,
	label: string,
): Promise<void> {
	const q: NonNullable<AgentJob["pendingQuestion"]> = {
		freeText: true,
		question: `Rejected. Tell me what to change and I will redraft the ${label} against the same arc and sources — no assets are generated until you approve.`,
		options: [
			{ label: "Approve anyway", value: "approve" },
			{ label: "Research again", value: "research again" },
		],
	};
	job.run = {
		...(job.run ?? {
			instruction: job.brief,
			transcript: "",
			step: 0,
			builtSomething: false,
			finishRejected: false,
			asks: 0,
		}),
		...(run ? { pipeline: run } : {}),
		awaitingRevision: true,
	};
	job.pendingQuestion = q;
	job.pendingActionId = await recordRequiredAction(job, "approve");
	// Status after the id: a reader of this shared job never sees a wait with no action to answer.
	job.status = "awaiting_input";
	// The real answer here is typed prose, so the composer must reach this parked
	// run rather than starting a new one.
	job.events.push({
		kind: "question",
		question: q.question,
		options: q.options,
		actionId: job.pendingActionId,
		freeText: true,
	});
	await persist(job);
	await recordPipelineCheckpoint(job, { label, status: "awaiting_input" });
}

/* One revision iteration: redraft every section against the held skeleton, then
 * re-gate. The bound exists so a loop that never converges is reported rather
 * than run forever; it is sized for repeated free iteration, not for a single
 * correction. */
const MAX_PLAN_REVISIONS = 12;

/* One revision of a rejected plan, without parking anywhere: redraft every
 * section against the held frame, skeleton and research. The caller re-gates —
 * the pipeline driver onto its cursor, the agent runtime's workflow onto its own
 * step. `limit_reached` has already ended the run needing attention. */
export async function revisePlan(
	job: AgentJob,
	answer: string,
	label: string,
): Promise<{ outcome: "redrafted" | "limit_reached" | "failed"; note: string }> {
	const runState = job.run!;
	const revisions = (runState.revisions ?? 0) + 1;
	if (revisions > MAX_PLAN_REVISIONS) {
		job.pendingQuestion = undefined;
		runState.awaitingRevision = false;
		job.events.push({
			kind: "final",
			text: `Revision limit reached (${MAX_PLAN_REVISIONS} redrafts). The current plan is kept — approve it, or start a new run to replan from scratch.`,
		});
		job.status = "needs_attention";
		await persist(job);
		await recordPipelineCheckpoint(job, { label, status: "done" });
		return { outcome: "limit_reached", note: "Revision limit reached." };
	}
	runState.revisions = revisions;
	runState.awaitingRevision = false;
	job.pendingQuestion = undefined;
	let workflow = makeWorkflowPlan({
		id: "active",
		route: "plan_story",
		title: "Revise story plan",
		items: [
			{ id: "revision", label: "Revision received", status: "done" },
			{ id: "redraft", label: `Redraft ${label}`, status: "running", tool: "plan_story" },
			{ id: "approval", label: "Wait for your approval" },
		],
	});
	emitWorkflowProgress(job, workflow);
	await saveRun(job);
	let note: string;
	try {
		({ note } = await emitToolCall(job, "plan_story", { revision: answer }, async () =>
			redraftStoryPlanFlow(job, answer, storyInputsOf(job)),
		));
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		workflow = setWorkflowItem(workflow, "redraft", "failed", { reason: message });
		emitWorkflowProgress(job, workflow);
		return { outcome: "failed", note: message };
	}
	workflow = setWorkflowItem(
		setWorkflowItem(workflow, "redraft", "done", { reason: note }),
		"approval",
		"running",
	);
	emitWorkflowProgress(job, workflow);
	return { outcome: "redrafted", note };
}

export function isResearchAgainRequest(answer: string): boolean {
	return /\bresearch (again|more)\b|\bmore sources\b|\bcari sumber lagi\b/i.test(answer.trim());
}

/* Retrieve more sources for the plan on the table, then redraft against them.
 *
 * Free, like everything else before approval: it merges into the bundle rather
 * than replacing it, so the sources the current plan already cites survive a
 * second search that ranked differently. */
/* Research the plan's topic again and, when that added sources, redraft against
 * them — without parking anywhere. `unchanged` means nothing new was found, so
 * the plan and its gate stand exactly as they were. */
export async function researchPlanAgain(
	job: AgentJob,
): Promise<{ outcome: "redrafted" | "unchanged" | "failed" | "no_plan"; note: string }> {
	const plan = getStoryPlan(job);
	if (!plan) return { outcome: "no_plan", note: "" };
	const runState = job.run!;
	runState.awaitingRevision = false;
	job.pendingQuestion = undefined;
	const topic = plan.planningBrief || job.brief;
	let workflow = makeWorkflowPlan({
		id: "active",
		route: "plan_story",
		title: "Research again",
		items: [
			{ id: "research", label: "Retrieve more sources", status: "running", tool: "research_topic" },
			{ id: "redraft", label: "Redraft against the sources" },
			{ id: "approval", label: "Wait for your approval" },
		],
	});
	emitWorkflowProgress(job, workflow);
	await saveRun(job);
	let added = 0;
	const { note: researchNote } = await emitToolCall(job, "research_topic", { topic }, async () => {
		const result = await researchAgain(job, { topic });
		added = result.added;
		return { note: result.note };
	});
	// What matters is whether the pass ADDED anything: a search that failed while the
	// plan still holds its earlier sources has produced nothing to redraft against,
	// and redrafting on it would spend a draft pass to say the same thing again.
	workflow = setWorkflowItem(workflow, "research", added ? "done" : "failed", {
		reason: researchNote,
	});
	emitWorkflowProgress(job, workflow);
	if (!added) {
		// The redraft row is marked skipped rather than left pending, so the card
		// does not show a step that will never run.
		workflow = setWorkflowItem(
			setWorkflowItem(workflow, "redraft", "skipped", {
				reason: "no new sources to draft against",
			}),
			"approval",
			"running",
		);
		emitWorkflowProgress(job, workflow);
		return { outcome: "unchanged", note: researchNote };
	}
	let note: string;
	try {
		({ note } = await emitToolCall(
			job,
			"plan_story",
			{ revision: "incorporate the newly retrieved sources" },
			async () =>
				redraftStoryPlanFlow(
					job,
					`Ground the narration in the retrieved sources; ${added} new source(s) are now available.`,
					storyInputsOf(job),
					{ grounded: true },
				),
		));
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		workflow = setWorkflowItem(workflow, "redraft", "failed", { reason: message });
		emitWorkflowProgress(job, workflow);
		return { outcome: "failed", note: message };
	}
	workflow = setWorkflowItem(
		setWorkflowItem(workflow, "redraft", "done", { reason: note }),
		"approval",
		"running",
	);
	emitWorkflowProgress(job, workflow);
	return { outcome: "redrafted", note };
}
