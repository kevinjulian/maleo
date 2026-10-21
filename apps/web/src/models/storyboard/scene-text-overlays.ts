/* Scene-metadata text overlays for a loaded video project.
 *
 * A document written before scene text became clips carries its headline,
 * explainer and transition text on the scenes; this derives the text clips once,
 * at load, and drops the auto-derived ones a migrated document already holds. */
import { presentationFor, SCENE_TEXT_CLIP_MIGRATION_VERSION } from "@maleo/shared";
import type { Scene, TextOverlay } from "@maleo/shared";
import { resolveFreeTrack, type TrackSpan } from "@models/timeline/timeline-clips.ts";

const AUTO_SCENE_TEXT_ID_MIN = 40_000_000;
const AUTO_EXPLAINER_TEXT_ID_MIN = 41_000_000;
const AUTO_SCENE_TEXT_ID_MAX = 50_000_000;

function sceneMetadataTextOverlays(
	scenes: Scene[],
	existing: TextOverlay[],
	migrationVersion: number | null,
): TextOverlay[] {
	if (migrationVersion === SCENE_TEXT_CLIP_MIGRATION_VERSION) return [];
	const existingIds = new Set(existing.map((o) => o.id));
	const out: TextOverlay[] = [];
	const occupied: TrackSpan[] = existing.map((o) => ({
		start: o.start,
		dur: o.dur,
		track: o.track ?? 0,
	}));
	const pushAuto = (clip: TextOverlay, preferredTrack: number): void => {
		const track = resolveFreeTrack(occupied, clip, preferredTrack);
		const placed = { ...clip, track };
		out.push(placed);
		occupied.push({ start: placed.start, dur: placed.dur, track });
	};
	let cursor = 0;
	scenes.forEach((scene, index) => {
		const start = scene.start ?? cursor;
		const dur = Math.max(1, scene.dur || 0);
		const presentation = presentationFor(scene);
		const text = scene.onScreenText?.trim();
		const textId = AUTO_SCENE_TEXT_ID_MIN + index * 2;
		if (text && presentation.category === "headline" && !existingIds.has(textId)) {
			pushAuto(
				{
					id: textId,
					content: text,
					start: start + Math.min(0.25, dur / 4),
					dur: Math.min(dur, 2.4),
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
		const explainerId = AUTO_EXPLAINER_TEXT_ID_MIN + index;
		if (explainerText && presentation.category === "explainer" && !existingIds.has(explainerId)) {
			pushAuto(
				{
					id: explainerId,
					content: explainerText,
					start: start + Math.min(0.6, dur / 3),
					dur: Math.min(dur, 2.6),
					preset: "explainer-card",
					track: 2,
				},
				2,
			);
		}
		const transitionText = scene.sectionTransition?.text?.trim();
		const transitionId = AUTO_SCENE_TEXT_ID_MIN + index * 2 + 1;
		if (
			transitionText &&
			presentation.category === "transition" &&
			!existingIds.has(transitionId)
		) {
			pushAuto(
				{
					id: transitionId,
					content: transitionText,
					start,
					dur: Math.min(dur, Math.max(0.5, scene.sectionTransition?.durationSec ?? 0.9)),
					preset: "section-card",
					track: 3,
				},
				3,
			);
		}
		cursor = start + dur;
	});
	return out;
}

function isAutoSceneTextOverlay(overlay: TextOverlay): boolean {
	return overlay.id >= AUTO_SCENE_TEXT_ID_MIN && overlay.id < AUTO_SCENE_TEXT_ID_MAX;
}

export function migrateSceneTextOverlays(
	scenes: Scene[],
	existing: TextOverlay[],
	migrationVersion: number | null,
): TextOverlay[] {
	if (migrationVersion === SCENE_TEXT_CLIP_MIGRATION_VERSION) return existing;
	const userText = existing.filter((o) => !isAutoSceneTextOverlay(o));
	return [...userText, ...sceneMetadataTextOverlays(scenes, userText, migrationVersion)];
}
