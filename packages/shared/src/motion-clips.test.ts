import { describe, expect, it } from "vite-plus/test";
import { textAnimationSchema } from "./clip-animation.ts";
import { evaluateValueTrack } from "./keyframe-evaluation.ts";
import { compileMotionClips, expandComposition, type MotionClip } from "./motion-clips.ts";
import { compileMotion } from "./motion-compile.ts";
import { MOTION_EXAMPLES } from "./motion-examples.ts";
import { overlayGeometryAt } from "./motion-geometry.ts";

/** A clip's absolute geometry at moment time `t`, read from its stored keys. */
function clipGeometryAt(clip: MotionClip, t: number) {
	const tracks = clip.layout.animation?.tracks ?? {};
	const local = t - clip.startSec;
	const l = clip.layout;
	return {
		left: evaluateValueTrack(tracks.xPct, local, l.xPct),
		top: evaluateValueTrack(tracks.yPct, local, l.yPct),
		width: evaluateValueTrack(tracks.widthPct, local, l.widthPct),
		height: evaluateValueTrack(tracks.heightPct, local, l.heightPct),
		opacity: evaluateValueTrack(tracks.opacity, local, 1),
		scale: evaluateValueTrack(tracks.scale, local, 1),
	};
}

describe("compileMotionClips", () => {
	it("compiles the same intent to equal clips", () => {
		for (const e of MOTION_EXAMPLES)
			expect(compileMotionClips(e.intent, { spanSec: e.spanSec })).toEqual(
				compileMotionClips(e.intent, { spanSec: e.spanSec }),
			);
	});

	it("gives every layer its own clip and lane, in paint order", () => {
		const e = MOTION_EXAMPLES.find((x) => x.presentation === "headline")!;
		const clips = compileMotionClips(e.intent, { spanSec: e.spanSec });
		expect(clips.map((c) => [c.layerId, c.lane, c.preset])).toEqual([
			["bar", 0, "shape-rect"],
			["title", 1, "plain"],
			["spark", 2, "shape-circle"],
		]);
		expect(clips.find((c) => c.layerId === "title")!.content).toBe("Ship faster");
	});

	it("writes keys the timeline's text animation model accepts, in clip-local seconds", () => {
		for (const e of MOTION_EXAMPLES)
			for (const clip of compileMotionClips(e.intent, { spanSec: e.spanSec })) {
				const animation = clip.layout.animation;
				if (!animation) continue;
				expect(textAnimationSchema.safeParse(animation).success).toBe(true);
				for (const keys of Object.values(animation.tracks))
					for (const key of keys ?? []) {
						expect(key.t).toBeGreaterThanOrEqual(0);
						expect(key.t).toBeLessThanOrEqual(clip.durationSec + 1e-9);
					}
			}
	});

	it("draws what the composition draws", () => {
		for (const e of MOTION_EXAMPLES) {
			const clips = compileMotionClips(e.intent, { spanSec: e.spanSec });
			const config = compileMotion(e.intent, { spanSec: e.spanSec });
			clips.forEach((clip, i) => {
				const overlay = config.overlays[i]!;
				expect(clip.startSec).toBeCloseTo(overlay.relStart, 9);
				expect(clip.durationSec).toBeCloseTo(overlay.dur, 9);
				for (let k = 0; k <= 20; k++) {
					const t = clip.startSec + (clip.durationSec * k) / 20;
					const a = clipGeometryAt(clip, t),
						b = overlayGeometryAt(overlay, t)!;
					expect(Math.abs(a.left - b.left)).toBeLessThan(1);
					expect(Math.abs(a.top - b.top)).toBeLessThan(1);
					expect(Math.abs(a.width - b.width)).toBeLessThan(1);
					expect(Math.abs(a.opacity - b.opacity)).toBeLessThan(0.02);
				}
			});
		}
	});
});

describe("expandComposition", () => {
	it("expands a placed composition into clips that draw what it drew", () => {
		for (const e of MOTION_EXAMPLES) {
			const config = compileMotion(e.intent, { spanSec: e.spanSec });
			for (const stretch of [1, 2]) {
				const clips = expandComposition(config, e.spanSec * stretch);
				expect(clips).toHaveLength(config.overlays.length);
				clips.forEach((clip, i) => {
					const overlay = config.overlays[i]!;
					for (const k of [0, 0.15, 0.5, 0.85, 1]) {
						const t = clip.startSec + clip.durationSec * k;
						const a = clipGeometryAt(clip, t),
							b = overlayGeometryAt(overlay, t / stretch)!;
						expect(Math.abs(a.left - b.left)).toBeLessThan(1.5);
						expect(Math.abs(a.top - b.top)).toBeLessThan(1.5);
						expect(Math.abs(a.opacity - b.opacity)).toBeLessThan(0.05);
					}
				});
			}
		}
	});
});
