/* Overlays leaf — pure builders for the auto-generated text layer of a
 * storyboard timeline. Owns the reserved auto-id ranges so auto overlays can
 * be replaced in place without clobbering user/tool-added ones. Depends only on
 * shared motion helpers; domain types are imported
 * type-only from the orchestrator (no runtime cycle), so both the orchestrator
 * and the flow services can import these builders directly. */
import type { AgentJob, AgentScene, AgentTextOverlay } from "./model.ts";
import { autoTransitionForScenes, presentationFor } from "@maleo/shared";

// Reserved auto-id ranges. Auto overlays carry ids inside these bands so a rebuild
// replaces the stale auto layer in place; manual overlays (ids outside the bands)
// are never touched.
const AUTO_SCENE_TEXT_ID_MIN = 40_000_000;
const AUTO_EXPLAINER_TEXT_ID_MIN = 41_000_000;
const AUTO_SCENE_TEXT_ID_MAX = 50_000_000;

// ── Text overlays ───────────────────────────────────────────────────────────

export function isAutoSceneTextId(id: number | undefined): boolean {
	return typeof id === "number" && id >= AUTO_SCENE_TEXT_ID_MIN && id < AUTO_SCENE_TEXT_ID_MAX;
}
function textSpanOverlaps(
	a: { startSec: number; durationSec: number },
	b: { startSec: number; durationSec: number },
): boolean {
	return b.startSec < a.startSec + a.durationSec && b.startSec + b.durationSec > a.startSec;
}
function resolveTextTrack(
	occupied: ReadonlyArray<AgentTextOverlay>,
	span: { startSec: number; durationSec: number },
	preferredTrack = 0,
): number {
	let track = Math.max(0, Math.round(preferredTrack));
	while (occupied.some((clip) => (clip.track ?? 0) === track && textSpanOverlaps(span, clip)))
		track++;
	return track;
}
export function buildSceneTextOverlays(
	scenes: AgentScene[],
	existing: AgentTextOverlay[] = [],
): AgentTextOverlay[] {
	const overlays: AgentTextOverlay[] = [];
	const occupied = [...existing];
	const pushAuto = (clip: AgentTextOverlay, preferredTrack: number): void => {
		const track = resolveTextTrack(occupied, clip, preferredTrack);
		const placed = { ...clip, track };
		overlays.push(placed);
		occupied.push(placed);
	};
	let cursor = 0;
	scenes.forEach((scene, index) => {
		const start = cursor;
		const dur = Math.max(1, scene.durationSec || 0);
		const presentation = presentationFor(scene);
		const text = scene.onScreenText?.trim();
		if (text && presentation.category === "headline") {
			pushAuto(
				{
					id: AUTO_SCENE_TEXT_ID_MIN + index * 2,
					content: text,
					startSec: start + Math.min(0.25, dur / 4),
					durationSec: Math.min(dur, 2.4),
					preset: "title",
					track: 1,
				},
				1,
			);
		}
		const explainerText = [
			scene.claim?.trim() || scene.question?.trim(),
			scene.evidence?.trim() || scene.analogy?.trim(),
		]
			.filter(Boolean)
			.join("\n");
		if (explainerText && presentation.category === "explainer") {
			pushAuto(
				{
					id: AUTO_EXPLAINER_TEXT_ID_MIN + index,
					content: explainerText,
					startSec: start + Math.min(0.6, dur / 3),
					durationSec: Math.min(dur, 2.6),
					preset: "explainer-card",
					track: 2,
				},
				2,
			);
		}
		const transitionText = scene.sectionTransition?.text?.trim();
		if (transitionText && presentation.category === "transition") {
			pushAuto(
				{
					id: AUTO_SCENE_TEXT_ID_MIN + index * 2 + 1,
					content: transitionText,
					startSec: start,
					durationSec: Math.min(dur, Math.max(0.5, scene.sectionTransition?.durationSec ?? 0.9)),
					preset: "section-card",
					track: 3,
				},
				3,
			);
		}
		cursor += dur;
	});
	return overlays;
}
export function syncSceneTextOverlays(job: AgentJob): void {
	const userText = job.textOverlays.filter((t) => !isAutoSceneTextId(t.id));
	const generated = buildSceneTextOverlays(job.scenes, userText);
	job.textOverlays = [...userText, ...generated];
}

// Auto-vary each scene's outgoing transition from its beat + the next scene's
// emotion, so any storyboard (manual, longform, or blueprint) reads with an
// intentional cut rhythm instead of a static default. Scenes whose transition
// was explicitly set (transitionLocked) are left untouched.
export function syncSceneTransitions(job: AgentJob): void {
	if (job.scenes.length < 2) return;
	const resolved = autoTransitionForScenes(job.scenes, job.styleKnobs);
	job.scenes.forEach((scene, i) => {
		if (scene.transitionLocked) return;
		const next = resolved[i];
		if (next) scene.transition = next;
	});
}
