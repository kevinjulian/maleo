/* Engagement chat actions — the deterministic critique pass and the prompt
 * builders behind the chat panel's Engage chips (hook writer, workspace lens,
 * style transfer, targeted scene regen).
 *
 * Critique runs CLIENT-SIDE from the same pacing analysis the timeline insights
 * strip uses, plus a claim-without-proof scan, so it costs nothing and the
 * timestamps are exact. The LLM prompt builders return instructions for the
 * server agent run loop (onRunCommand).
 */
import { lintPacing, type PacingInputs } from "@models/analysis/pacing-analysis.ts";

export interface CritiqueFinding {
	startSec: number;
	endSec: number;
	severity: "high" | "warn" | "info";
	message: string;
}

export interface CritiqueSceneInput {
	start: number;
	dur: number;
	name?: string;
	vo?: string;
}

/** VO sentences that assert a number/price/superlative — claims that convert
 *  better when backed by an on-screen proof overlay. */
const CLAIM_PATTERN =
	/(\d+(?:[.,]\d+)?\s*(?:%|jt|rb|k\b|jam|hari|hours?|days?|stars?|reviews?|sold))|(\$|Rp\s?\d)|(best.?sell|top.?rated|no\.?\s?1|#1|terlaris)/i;

export function critiqueStoryboard(
	pacing: PacingInputs,
	scenes: CritiqueSceneInput[],
	infographicSpans: Array<{ start: number; dur: number }>,
): CritiqueFinding[] {
	const findings: CritiqueFinding[] = lintPacing(pacing).map((f) => ({
		startSec: f.startSec,
		endSec: f.endSec,
		severity: f.severity,
		message: f.message,
	}));
	// Claims without proof: numeric/superlative VO with no data callout on screen
	// anywhere in the scene window.
	for (const s of scenes) {
		if (!s.vo || !CLAIM_PATTERN.test(s.vo)) continue;
		const covered = infographicSpans.some(
			(g) => g.start < s.start + s.dur && g.start + g.dur > s.start,
		);
		if (!covered) {
			findings.push({
				startSec: s.start,
				endSec: s.start + s.dur,
				severity: "warn",
				message: `${s.name || "Scene"} makes a claim in VO ("${s.vo.slice(0, 60)}${s.vo.length > 60 ? "…" : ""}") with no on-screen proof — add a stat/price/social-proof callout.`,
			});
		}
	}
	return findings.sort((a, b) => a.startSec - b.startSec);
}

// ── Prompt builders for the server agent ──

export interface HookArchetype {
	id: string;
	label: string;
	instruction: string;
}

export const HOOK_ARCHETYPES: readonly HookArchetype[] = [
	{
		id: "question",
		label: "Question",
		instruction:
			"Rewrite ONLY the hook (first scene voiceover + its captions) as a direct QUESTION the target viewer can't scroll past. Keep every other scene untouched. Keep the hook under 3 seconds of speech.",
	},
	{
		id: "bold_claim",
		label: "Bold claim",
		instruction:
			"Rewrite ONLY the hook (first scene voiceover + its captions) as one BOLD, specific claim about the product's strongest benefit. Keep every other scene untouched. Keep the hook under 3 seconds of speech.",
	},
	{
		id: "pov",
		label: "POV",
		instruction:
			"Rewrite ONLY the hook (first scene voiceover + its captions) in POV style ('POV: you…') that drops the viewer into the moment the product matters. Keep every other scene untouched. Keep the hook under 3 seconds of speech.",
	},
	{
		id: "stat_shock",
		label: "Stat shock",
		instruction:
			"Rewrite ONLY the hook (first scene voiceover + its captions) to open with the most surprising NUMBER from the product data (rating, sold count, discount, spec). Keep every other scene untouched. Keep the hook under 3 seconds of speech.",
	},
	{
		id: "negativity",
		label: "Negativity",
		instruction:
			"Rewrite ONLY the hook (first scene voiceover + its captions) as a negative pattern-break ('Stop doing X' / 'You're wasting money on…'). Keep every other scene untouched. Keep the hook under 3 seconds of speech.",
	},
] as const;

export interface WorkspaceLens {
	id: string;
	label: string;
	instruction: string;
}

export const WORKSPACE_LENSES: readonly WorkspaceLens[] = [
	{
		id: "skeptic",
		label: "Skeptical buyer",
		instruction:
			"Review the storyboard as a SKEPTICAL BUYER. Do not change anything. Reply with timestamped notes flagging every claim that lacks visible proof (reviews, ratings, before/after, spec source) and every moment that feels like an ad instead of a recommendation.",
	},
	{
		id: "bargain",
		label: "Bargain hunter",
		instruction:
			"Review the storyboard as a BARGAIN HUNTER. Do not change anything. Reply with timestamped notes on where price/value should appear earlier or stronger, and whether the offer framing (discount, urgency) is convincing or missing.",
	},
	{
		id: "scroller",
		label: "Distracted scroller",
		instruction:
			"Review the storyboard as a DISTRACTED SCROLLER on a feed. Do not change anything. Reply with timestamped notes marking every second you would have swiped away and why (slow hook, static shot, nothing new happening).",
	},
] as const;

/** Convert a reference into generic craft traits without copying identity. */
export function styleTransferInstruction(description: string): string {
	return [
		`Analyze this reference: ${description.trim()}.`,
		"Extract only transferable traits: pace, composition, tone, structure, palette, typography, and visual grammar.",
		"Apply those traits without imitating creator/channel identity, copying signature assets, or naming output after source.",
		"Reply with traits extracted and changes made.",
	].join(" ");
}

/** Claim-bank grounding: assert only sourced claims, attach proof overlays. */
export const GROUND_CLAIMS_INSTRUCTION = [
	"Ground every claim: only assert facts that appear in the project's claim notes (notes tagged 'claim', each with a proof source).",
	"Remove or soften any voiceover line asserting something the claim bank does not support.",
	"For each claim that IS supported and spoken, add a matching proof callout (stat, social proof, or price) timed to the words.",
].join(" ");

/** Shot-list ranking: assign reference images to scenes by role, not order. */
export const SHOT_LIST_INSTRUCTION = [
	"Rank the project's reference images by role — best hook frame (strong first impression), best detail shot (texture/close-up), best lifestyle shot (product in use) —",
	"then reassign scene visuals so each scene uses the image whose role fits its beat (hook scene gets the hook frame, feature scenes get detail shots, outcome scenes get lifestyle).",
	"Reply with the ranking and what you reassigned.",
].join(" ");

/** Scoped regen: touch one scene only. */
export function sceneRegenInstruction(sceneNumber: number, focus?: string): string {
	return [
		`Punch up scene ${sceneNumber} ONLY — do not modify any other scene, overlay, or audio outside its time window.`,
		focus?.trim()
			? `Focus: ${focus.trim()}.`
			: "Make it more engaging: tighter VO, stronger visual direction, and add a data callout if the scene makes a claim.",
	].join(" ");
}
