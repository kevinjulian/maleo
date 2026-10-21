/* Evidence leaf — the factual/citation layer: decide whether a brief is worth
 * grounding, match persisted research to a plan, validate that quoted evidence
 * actually appears in retrieved excerpts (exact-quote, not URL membership),
 * strip unsupported claims from a blueprint, materialize planned sections with
 * honest citation status, and score plan verification. Pure/leaf: depends only
 * on shared blueprint derivation + leaf utilities; domain types are imported
 * type-only from the orchestrator, so both the orchestrator and the planning /
 * longform services import these directly (no runtime cycle). */
import type { StoryPlanContext, VerificationStatus } from "./model.ts";
import type { StorySection } from "../../../lib/story.ts";
import type { PovShot } from "@maleo/shared";
import type { ResearchBundle } from "../../../lib/web-research.ts";
import type { StoryPlanSection, StoryResearchEvidence } from "../../../lib/content-generator.ts";
import { estimateDurationFromWords } from "../../../lib/story.ts";
import { fingerprintBrief } from "./services/util.ts";

// ── Factual heuristic ───────────────────────────────────────────────────────
const MAX_PLANNED_SECTION_SHOTS = 8;

/* Whether a brief needs grounding is decided by the FRAME stage, which is already
 * a model call over the brief, and carried on the plan as `factual`. The keyword
 * regex that used to decide it here is gone: it missed briefs that make checkable
 * claims in words it did not list, and grounded fiction that happened to contain
 * one. See `storyGroundingSchema` in @maleo/shared. */

// ── Research matching ───────────────────────────────────────────────────────

/** The research for this brief, when the research held is about it. */
export function matchingResearch(
	research: ResearchBundle | undefined,
	brief: string,
): ResearchBundle | undefined {
	if (!research?.sources.length) return undefined;
	const key = fingerprintBrief(brief);
	// Reload/edit runs may omit the brief; absence does not contradict persisted
	// research. A non-empty explicit brief must match the actual research topic.
	return !key || fingerprintBrief(research.topic) === key ? research : undefined;
}

/** The research a new draft for this plan works from, under the plan's own
 *  research key. What an existing plan cites is `groundedResearch`. */
export function researchForPlan(
	research: ResearchBundle | undefined,
	plan: StoryPlanContext,
): ResearchBundle | undefined {
	if (!research?.sources.length) return undefined;
	if (plan.researchKey)
		return fingerprintBrief(research.topic) === plan.researchKey ? research : undefined;
	return matchingResearch(research, plan.planningBrief ?? "");
}

// ── Quote validation ────────────────────────────────────────────────────────

function normalizeEvidenceText(value: string): string {
	return value
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function validateQuotedEvidence(
	sourceEvidence: Array<{ url: string; quote: string }> | undefined,
	evidence?: StoryResearchEvidence,
): Array<{ url: string; quote: string }> {
	if (!evidence?.sources.length) return [];
	const byUrl = new Map(evidence.sources.map((s) => [s.url, normalizeEvidenceText(s.excerpt)]));
	const seen = new Set<string>();
	const valid: Array<{ url: string; quote: string }> = [];
	for (const item of sourceEvidence ?? []) {
		const quote = item.quote.trim();
		const normalized = normalizeEvidenceText(quote);
		const excerpt = byUrl.get(item.url);
		if (!excerpt || normalized.length < 20 || !excerpt.includes(normalized)) continue;
		const key = `${item.url}\n${normalized}`;
		if (seen.has(key)) continue;
		seen.add(key);
		valid.push({ url: item.url, quote });
	}
	return valid;
}

/** Keep only exact quotes present in retrieved excerpts; URL membership alone is insufficient. */
export function validateSourceEvidence(
	section: StoryPlanSection,
	evidence?: StoryResearchEvidence,
): Array<{ url: string; quote: string }> {
	return validateQuotedEvidence(section.sourceEvidence, evidence);
}

export function materializePlannedSections(
	planned: StoryPlanSection[],
	startIndex: number,
	evidence: StoryResearchEvidence | undefined,
	factualBrief: boolean,
	budgets?: number[],
): StorySection[] {
	interface PlannedShotCue {
		visualPrompt: string;
		cue: string;
		refKeys?: string[];
		povShot?: PovShot;
	}
	const splitNarrationCue = (
		visualPrompt: string,
		cue: string,
		refKeys?: string[],
		povShot?: PovShot,
	): PlannedShotCue => {
		const cleanPrompt = visualPrompt.replace(/\s+/g, " ").trim();
		const match = cleanPrompt.match(/\bNarration beat\s*:\s*(.+)$/i);
		if (!match) return { visualPrompt: cleanPrompt, cue, refKeys, povShot };
		const stripped = cleanPrompt.slice(0, match.index).replace(/\s+/g, " ").trim();
		return {
			visualPrompt: stripped || cleanPrompt.replace(match[0], "").trim(),
			cue: cue || match[1]!.trim(),
			refKeys,
			povShot,
		};
	};
	return planned.map((p, i) => {
		const sourceEvidence = validateSourceEvidence(p, evidence);
		// In a factual/historical brief every section must earn its citation state.
		// The planner cannot self-exempt unsupported prose by labelling it false.
		const factual = factualBrief;
		// Multiple shots → multiple images swapping under one voiceover, ordered to
		// follow the narration. A shot is either a bare prompt (legacy) or
		// { visualPrompt, cue } where cue is the narration beat it illustrates (drives
		// semantic-sync timing). Capped at 8; the primary visualPrompt seeds shot 0.
		const rawShots = (p.shots && p.shots.length ? p.shots : [p.visualPrompt])
			.map((x) => (typeof x === "string" ? { visualPrompt: x } : x))
			.map((x) => splitNarrationCue(x.visualPrompt, (x.cue ?? "").trim(), x.refKeys, x.povShot))
			.filter((x) => x.visualPrompt.length > 0)
			.slice(0, MAX_PLANNED_SECTION_SHOTS);
		const shots = rawShots.length ? rawShots : [splitNarrationCue(p.visualPrompt, "", p.refKeys)];
		const visualPrompts = shots.map((x) => x.visualPrompt);
		/* A cue is the narration beat a shot illustrates, and downstream grouping
		 * matches on it verbatim. A cue the narrator does not actually speak is
		 * therefore text nothing can match, so it is recorded as unverified (empty)
		 * rather than retained — narration grouping then falls back to its balanced
		 * contiguous split instead of matching on words that are not there. */
		const narration = normalizeEvidenceText(p.narration);
		const shotCues = shots.map((x) => {
			const cue = x.cue.trim();
			if (!cue) return "";
			return narration.includes(normalizeEvidenceText(cue)) ? cue : "";
		});
		const povShots = shots
			.map((x) => x.povShot)
			.filter((x): x is NonNullable<typeof x> => Boolean(x && Object.values(x).some(Boolean)));
		const visualRefKeys = shots.map((x) => [...new Set(x.refKeys ?? p.refKeys ?? [])]);
		const refKeys = [...new Set([...(p.refKeys ?? []), ...visualRefKeys.flat()])];
		const sectionId = p.id ?? `sec-${startIndex + i + 1}`;
		return {
			id: p.semanticBeatId ?? sectionId,
			...(p.semanticBeatId ? { sectionId } : {}),
			...(p.semanticBeatId ? { semanticBeatId: p.semanticBeatId } : {}),
			...(p.locked ? { locked: true } : {}),
			title: p.title,
			narration: p.narration,
			visualPrompt: p.visualPrompt,
			visualPrompts,
			...(refKeys.length ? { refKeys } : {}),
			...(visualRefKeys.some((keys) => keys.length > 0) ? { visualRefKeys } : {}),
			...(shotCues.some(Boolean) ? { shotCues } : {}),
			...(p.povStage ? { povStage: p.povStage } : {}),
			// The section's job in the plan's arc, carried from the skeleton so a
			// rehydrated plan knows what each section was FOR, not just what it says.
			...(p.chapterFunction ? { chapterFunction: p.chapterFunction } : {}),
			...(p.chapterObligation ? { chapterObligation: p.chapterObligation } : {}),
			...(p.needsDrafting ? { needsDrafting: true } : {}),
			...(povShots.length ? { povShots } : {}),
			notes: p.notes,
			sourceNotes: p.sourceNotes,
			factual,
			sourceEvidence,
			sourceUrls: [...new Set(sourceEvidence.map((x) => x.url))],
			citationStatus: factual
				? sourceEvidence.length
					? "verified"
					: "unsupported"
				: "not_required",
			motionGraphic: p.motionGraphic,
			...(p.editorial ? { editorial: p.editorial } : {}),
			...(p.requiredReferences?.length ? { requiredReferences: p.requiredReferences } : {}),
			...(p.teachingMove ? { teachingMove: p.teachingMove } : {}),
			// Absent when the planner omitted it or gave an unknown label; music
			// resolution then falls back to the template's default cue.
			...(p.emotion ? { emotion: p.emotion } : {}),
			status: "draft" as const,
			estimatedDurationSec:
				estimateDurationFromWords(p.narration) || Math.round((budgets?.[i] ?? 1) / 2.6),
		};
	});
}

// ── Verification scoring ────────────────────────────────────────────────────

/** How much of a plan's factual claims carry a verified citation. Empty when the
 *  plan has no factual sections, which is not the same as none verified. */
export interface PlanVerification {
	status?: VerificationStatus;
	coverage?: { verified: number; total: number };
}

export function planVerification(sections: StorySection[]): PlanVerification {
	const factual = sections.filter((s) => s.factual === true);
	if (!factual.length) return {};
	const verified = factual.filter((s) => s.citationStatus === "verified").length;
	const status: VerificationStatus =
		verified === factual.length ? "verified" : verified > 0 ? "partial" : "unverified";
	return { status, coverage: { verified, total: factual.length } };
}
