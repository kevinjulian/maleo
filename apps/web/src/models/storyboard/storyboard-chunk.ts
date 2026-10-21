/* Maleo — Content-First Create · storyboard chunking for video generation.
 *
 * Image-to-video models accept one storyboard image and animate a short clip
 * from it (typically up to ~10 seconds). Long storyboards therefore have to be
 * split into sequential parts: each part is exported as its own storyboard
 * image, sent to the generator as an independent clip, and the clips are
 * concatenated in order afterwards. Visual continuity between parts is kept by
 * repeating the same consistency rules and references on every exported image.
 */
import type { Scene } from "@maleo/shared";

/** Max clip length a single storyboard image should describe. */
export const MAX_CHUNK_DURATION_SEC = 10;
/** Max scenes per storyboard image — more rows than this get unreadable. */
const MAX_CHUNK_SCENES = 5;

export interface SceneTiming {
	startSec: number;
	endSec: number;
}

export interface StoryboardChunk {
	/** 1-based part number. */
	part: number;
	scenes: Scene[];
	/** Global (whole-storyboard) start/end of this part. */
	startSec: number;
	endSec: number;
	/** Per-scene global timings, parallel to `scenes`. */
	timings: SceneTiming[];
}

export interface ChunkOptions {
	maxDurationSec?: number;
	maxScenes?: number;
}

export function totalDurationSec(scenes: Scene[]): number {
	return scenes.reduce((sum, scene) => sum + Math.max(1, scene.dur || 0), 0);
}

/** Cumulative start/end seconds for every scene across the full storyboard. */
export function sceneTimings(scenes: Scene[]): SceneTiming[] {
	let cursor = 0;
	return scenes.map((scene) => {
		const dur = Math.max(1, scene.dur || 0);
		const timing = { startSec: cursor, endSec: cursor + dur };
		cursor += dur;
		return timing;
	});
}

/** Greedy split: a scene joins the current chunk unless that would push the
 *  chunk past the duration cap or the scene-count cap. A single scene longer
 *  than the cap still gets its own chunk (it cannot be split further here —
 *  the video generator decides how to handle an over-length clip). */
export function chunkScenes(scenes: Scene[], options: ChunkOptions = {}): StoryboardChunk[] {
	const maxDuration = options.maxDurationSec ?? MAX_CHUNK_DURATION_SEC;
	const maxScenes = options.maxScenes ?? MAX_CHUNK_SCENES;
	const timings = sceneTimings(scenes);

	const chunks: StoryboardChunk[] = [];
	let current: { scenes: Scene[]; timings: SceneTiming[]; dur: number } | null = null;

	const flush = (): void => {
		if (!current || current.scenes.length === 0) return;
		chunks.push({
			part: chunks.length + 1,
			scenes: current.scenes,
			startSec: current.timings[0].startSec,
			endSec: current.timings[current.timings.length - 1].endSec,
			timings: current.timings,
		});
		current = null;
	};

	scenes.forEach((scene, i) => {
		const dur = Math.max(1, scene.dur || 0);
		const wouldOverflow =
			current !== null && (current.dur + dur > maxDuration || current.scenes.length >= maxScenes);
		if (wouldOverflow) flush();
		if (!current) current = { scenes: [], timings: [], dur: 0 };
		current.scenes.push(scene);
		current.timings.push(timings[i]);
		current.dur += dur;
	});
	flush();
	return chunks;
}

/* ── Consistency rules printed on every exported storyboard image ──
 * These mirror what an image-to-video generator needs to keep multi-part
 * output coherent: same talent, same wardrobe, same set, smooth motion. */
export const STORYBOARD_RULES = [
	"Outfit must not change at any point.",
	"Character face and identity stay the same.",
	"Environment stays the same across every scene.",
	"Lighting stays consistent (soft, even, fixed direction).",
	"Motion stays natural and realistic.",
	"Transitions between scenes must be smooth.",
];

export const STORYBOARD_AVOID = [
	"Extra fingers or extra body parts.",
	"Face morphing or uncanny faces.",
	"Animation or cartoon styles.",
	"Overacting or exaggerated expressions.",
	"Unrealistic or fake-looking product texture.",
	"Background changes or other people appearing.",
];

/** Continuity note added to part 2+ so each clip picks up where the last ended. */
export function continuityNote(part: number, partCount: number): string | null {
	if (partCount <= 1 || part === 1) return null;
	return (
		`Part ${part} of ${partCount} — continues directly from part ${part - 1}. ` +
		"Keep the exact same character, outfit, environment, and lighting as the previous part. " +
		"The first frame of this part should match the final frame of the previous part."
	);
}
