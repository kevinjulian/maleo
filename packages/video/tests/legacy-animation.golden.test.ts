/* Parity check for unify-keyframe-model. `fixtures/legacy-animation.golden.json`
 * is frozen: every rendered frame of the legacy fixture, sampled by the
 * pre-unification renderer (normalized `anim` over floor(dur * 30) frames, read
 * through OverlayAnimBox / TemplateFrame / sampleClipTransform at HEAD). It is
 * not regenerated; a deliberate render change edits this test instead.
 *
 * The fixture now goes through the current storyboard read, which converts
 * legacy text `anim` into seconds `layout.animation`. Timing must stay
 * frame-exact; size, style and blur must match exactly, rgb colours to one channel step; legacy content
 * motion folds into box properties (design decision 4), so position, scale,
 * rotation and opacity must equal that mapping of the golden values. */
import { describe, expect, it } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readStoryboardDocument, sampleClipTransform, RENDER_FPS, type Clip } from "@maleo/shared";
import { sampleTextAnimation } from "../src/lib/text-animation";

const fixture = JSON.parse(
	readFileSync(join(import.meta.dirname, "fixtures/legacy-animation.storyboard.json"), "utf8"),
);
const golden: Record<string, Record<string, number | string>[]> = JSON.parse(
	readFileSync(join(import.meta.dirname, "fixtures/legacy-animation.golden.json"), "utf8"),
);
const close = (got: number | undefined, want: number) =>
	expect(Math.abs((got ?? NaN) - want)).toBeLessThan(1e-9);
/** rgb() channels may differ by 1: seconds-scaled progress can land an ulp across a .5 rounding boundary. */
function expectColor(got: string | undefined, want: string) {
	const channels = (c: string | undefined) =>
		c
			?.match(/^rgb\((\d+), (\d+), (\d+)\)$/)
			?.slice(1)
			.map(Number);
	const [g, w] = [channels(got), channels(want)];
	if (!w) {
		expect(got).toBe(want);
		return;
	}
	expect(g).toHaveLength(3);
	g!.forEach((value, i) => expect(Math.abs(value - w[i]!)).toBeLessThanOrEqual(1));
}

describe("legacy animation parity", () => {
	const read = readStoryboardDocument(fixture);
	const byId = new Map(read.doc.clips.map((c) => [c.id, c] as const));
	const legacyLayout = (id: string) =>
		fixture.clips.find((c: { id: string }) => c.id === id).text.layout as Record<
			string,
			number | undefined
		>;

	it("reads the legacy fixture with nothing uninterpreted and no legacy field left", () => {
		expect(read.diagnostic).toEqual({ unknownKeys: [], defaulted: [], legacy: false });
		for (const clip of read.doc.clips) if (clip.text) expect(clip.text).not.toHaveProperty("anim");
	});

	it("keeps ordinary clip keys exact at every frame", () => {
		const clip = byId.get("image:1")!;
		golden["image:1"]!.forEach((want, f) => {
			const got = sampleClipTransform(clip.video!.layout, f / RENDER_FPS) as Record<string, number>;
			for (const [key, value] of Object.entries(want)) close(got[key], value as number);
		});
	});

	for (const id of ["text:1", "text:2", "text:3"])
		it(`keeps ${id} timing, size, style and colour exact and maps content motion onto the box`, () => {
			const clip: Clip = byId.get(id)!,
				text = clip.text!,
				base = legacyLayout(id);
			const frames = golden[id]!;
			expect(frames).toHaveLength(Math.max(1, Math.floor(clip.durationSec * RENDER_FPS)));
			frames.forEach((want, f) => {
				const { box, blur, style } = sampleTextAnimation(
					text.layout!.animation!,
					base,
					text.style,
					f / RENDER_FPS,
				);
				close(box.widthPct, want.widthPct as number);
				close(box.heightPct ?? 100, want.heightPct as number);
				close(box.bgOpacity, want.bgOpacity as number);
				close(blur, want.blur as number);
				for (const key of ["fontSize", "letterSpacing", "lineHeight"] as const)
					if (key in want) close(style[key], want[key] as number);
				for (const key of ["fill", "bodyFill", "accent", "background"] as const)
					if (key in want) expectColor(style[key], want[key] as string);
				close(box.xPct, (base.xPct ?? 0) + ((want.x as number) * (want.widthPct as number)) / 100);
				close(box.yPct, (base.yPct ?? 0) + ((want.y as number) * (want.heightPct as number)) / 100);
				close(box.scale, want.scale as number);
				close(box.rotationDeg, (base.rotationDeg ?? 0) + (want.rotate as number));
				close(box.opacity, (base.opacity ?? 1) * (want.opacity as number));
			});
		});
});
