/* What the canvas paints at a given time.
 *
 * The scene under the playhead, where that scene starts, and — inside a
 * multi-image beat — which visual clip is live. All three were inline in the
 * editor's root, which is why the editor had to know the current time and
 * therefore re-rendered at frame rate. They are pure functions of the scene
 * list and a second, so the surface that draws the frame can derive them from
 * its own subscription and the editor can stop holding time at all.
 *
 * The two answers the timeline also needs (`sceneAtTime`, `sceneStartOf`) live
 * here rather than being copied: the preview and the timeline disagreeing about
 * which scene covers a moment is the bug this consolidation prevents.
 */
import type { Scene } from "@maleo/shared";
import type { TimeSpan } from "./time-segments.ts";

/** A scene's timeline start: its explicit start once moved, else its sequential
 *  position by order. This is what lets scenes be gapped like clips. */
export function sceneStartOf(scenes: Scene[], id: number): number {
	let acc = 0;
	for (const s of scenes) {
		if (s.id === id) return s.start ?? acc;
		acc += Math.max(1, s.dur);
	}
	return 0;
}

/** The scene covering `t`, or undefined in a gap — which the canvas renders
 *  blank, mirroring the export. With explicit positions, the topmost track and
 *  the latest start win. */
export function sceneAtTime(scenes: Scene[], t: number): Scene | undefined {
	let best: Scene | undefined;
	let bestStart = -1;
	let acc = 0;
	for (const s of scenes) {
		const start = s.start ?? acc;
		acc += Math.max(1, s.dur);
		if (
			t >= start &&
			t < start + Math.max(1, s.dur) &&
			(start >= bestStart || (s.track ?? 0) > (best?.track ?? 0))
		) {
			best = s;
			bestStart = start;
		}
	}
	return best;
}

/** The image the canvas shows for `scene` at time `t`.
 *
 *  A single-image beat is just the scene's own source. A multi-image beat plays
 *  its visual clips in sequence, and the LAST match wins — mirroring the
 *  renderer, where later visual clips paint on top. */
export function visualUrlAt(scenes: Scene[], scene: Scene, t: number): string | undefined {
	const clips = scene.visualClips ?? [];
	if (clips.length <= 1) return scene.src;
	const local = t - sceneStartOf(scenes, scene.id);
	const live = [...clips]
		.reverse()
		.find(
			(v) => local >= (v.startSec ?? 0) && local < (v.startSec ?? 0) + (v.durationSec ?? scene.dur),
		);
	return (live ?? clips.find((v) => v.primary) ?? clips[0])?.url ?? scene.src;
}

/** Every instant at which the painted frame can change: a scene starting or
 *  ending, and inside a multi-image beat, one of its visual clips doing the
 *  same.
 *
 *  One pass rather than `sceneStartOf` per scene, which would be quadratic —
 *  and this feeds the segment search the preview subscribes to instead of
 *  subscribing to the time (see `time-segments.ts`). */
export function sceneSpans(scenes: Scene[]): TimeSpan[] {
	const spans: TimeSpan[] = [];
	let acc = 0;
	for (const scene of scenes) {
		const start = scene.start ?? acc;
		const dur = Math.max(1, scene.dur);
		acc = start + dur;
		spans.push({ start, end: start + dur });
		for (const clip of scene.visualClips ?? []) {
			const clipStart = start + (clip.startSec ?? 0);
			spans.push({ start: clipStart, end: clipStart + (clip.durationSec ?? dur) });
		}
	}
	return spans;
}

/** The whole frame in one call: the scene under `t` and the image it shows. */
/** What the preview shows at one instant. Both fields are optional because a
 *  time can fall outside every scene, and a scene can have no visual yet. */
export interface PreviewFrame {
	scene?: Scene;
	visualUrl?: string;
}

export function previewFrameAt(scenes: Scene[], t: number): PreviewFrame {
	const scene = sceneAtTime(scenes, t);
	return { scene, visualUrl: scene ? visualUrlAt(scenes, scene, t) : undefined };
}
