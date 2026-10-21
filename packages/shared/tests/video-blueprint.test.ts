import { describe, expect, test } from "vite-plus/test";
import { inferBeat, motionGraphicSchema, motionGraphicSfxCue } from "../src/video-blueprint.ts";

describe("inferBeat", () => {
	test("first is hook, last is cta", () => {
		expect(inferBeat(0, 5)).toBe("hook");
		expect(inferBeat(4, 5)).toBe("cta");
	});
});

describe("motion graphic price_tag", () => {
	test("schema accepts price_tag kind with compareAt", () => {
		const parsed = motionGraphicSchema.parse({
			needed: true,
			kind: "price_tag",
			purpose: "emphasize",
			reason: "price hook",
			title: "Mixer X",
			value: "Rp 1.2jt",
			compareAt: "Rp 1.8jt",
		});
		expect(parsed.kind).toBe("price_tag");
		expect(parsed.compareAt).toBe("Rp 1.8jt");
	});
	test("every non-none motion graphic kind has an entry sfx cue", () => {
		for (const kind of ["stat_reveal", "bar_chart", "table_build", "price_tag"]) {
			expect(motionGraphicSfxCue(kind)).toBeTruthy();
		}
		expect(motionGraphicSfxCue("none")).toBeNull();
	});
});
