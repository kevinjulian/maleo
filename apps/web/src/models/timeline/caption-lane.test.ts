import { expect, test } from "vite-plus/test";
import { laneGroupHue } from "./timeline-clips.ts";
import { LANE_HEIGHT_FALLBACK_PX, laneHeightFallbackPx } from "./content-cross-axis.ts";

test("caption lanes have their own hue, apart from text", () => {
	expect(laneGroupHue("caption")).toBe("var(--clip-caption)");
	expect(laneGroupHue("caption")).not.toBe(laneGroupHue("text"));
});

test("caption lanes fit one line of text: audio height, never taller, above text", () => {
	expect(laneHeightFallbackPx("caption")).toBe(LANE_HEIGHT_FALLBACK_PX.audio);
	expect(laneHeightFallbackPx("caption")).toBeLessThanOrEqual(laneHeightFallbackPx("audio"));
	expect(laneHeightFallbackPx("caption")).toBeGreaterThan(laneHeightFallbackPx("text"));
});
