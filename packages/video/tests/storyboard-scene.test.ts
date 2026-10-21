import { describe, expect, it } from "vite-plus/test";
import {
	effectiveRevealDurationFrames,
	revealClipStyle,
	revealColorBuildStyle,
	revealColorPhaseStyle,
	revealDarkPhaseStyle,
	revealTextureStyle,
} from "../src/components/RevealEffect";
import { sceneVisualLayout, visualClipDurationFrames } from "../src/scenes/StoryboardScene";

describe("StoryboardScene visual timing", () => {
	it("holds one scene visual for the full scene after voiceover timing changes", () => {
		expect(
			visualClipDurationFrames({
				clipDurationSec: 5.318,
				clipStartSec: 0,
				durationInFrames: 198,
				fps: 30,
				visualClipCount: 1,
			}),
		).toBe(198);
	});

	it("extends a single scene visual through outgoing transition hold", () => {
		expect(
			visualClipDurationFrames({
				clipDurationSec: 4,
				clipStartSec: 0,
				durationInFrames: 120,
				fps: 30,
				holdInFrames: 24,
				visualClipCount: 1,
			}),
		).toBe(144);
	});

	it("keeps explicit timing for multi-visual beats", () => {
		expect(
			visualClipDurationFrames({
				clipDurationSec: 2,
				clipStartSec: 0,
				durationInFrames: 198,
				fps: 30,
				visualClipCount: 2,
			}),
		).toBe(60);
	});
});

describe("StoryboardScene visual layout", () => {
	it("fills the frame height when a keyed or positioned scene visual has no height, as the static path does", () => {
		const keyed = {
			xPct: 0,
			yPct: 0,
			widthPct: 100,
			fit: "cover" as const,
			animation: {
				tracks: {
					scale: [
						{ t: 0, v: 1 },
						{ t: 2, v: 1.3 },
					],
				},
			},
		};
		expect(sceneVisualLayout(undefined, keyed).heightPct).toBe(100);
		expect(sceneVisualLayout({ widthPct: 60 }, undefined)).toEqual({
			widthPct: 60,
			heightPct: 100,
		});
	});

	it("keeps an explicit height, and the clip's layout wins over the scene's", () => {
		expect(sceneVisualLayout({ widthPct: 60, heightPct: 40 }, { xPct: 10 })).toEqual({
			widthPct: 60,
			heightPct: 40,
			xPct: 10,
		});
		expect(sceneVisualLayout({ heightPct: 40 }, { heightPct: 70 }).heightPct).toBe(70);
	});
});

describe("visual reveal effect", () => {
	it("uses the full clip duration when durationSec is omitted", () => {
		expect(effectiveRevealDurationFrames({ type: "wipe" }, 90, 30)).toBe(90);
	});

	it("clamps manual reveal duration to the clip span", () => {
		expect(effectiveRevealDurationFrames({ type: "fade", durationSec: 10 }, 60, 30)).toBe(60);
	});

	it("computes deterministic reveal styles", () => {
		expect(
			revealClipStyle({ type: "wipe", direction: "left", durationSec: 1 }, 15, 30, 30)?.clipPath,
		).toBe("inset(0 12.5% 0 0)");
		expect(
			revealClipStyle(
				{ type: "wipe", direction: "top_left_to_bottom_right", durationSec: 1 },
				15,
				30,
				30,
			)?.clipPath,
		).toBe("polygon(0 0, 175% 0, 0 175%)");
		expect(
			revealClipStyle(
				{ type: "wipe", direction: "draw_top_left_to_bottom_right", durationSec: 1 },
				15,
				30,
				30,
			)?.clipPath,
		).toBe("polygon(0 0, 175% 0, 141% 100%, 0 100%)");
		expect(revealClipStyle({ type: "fade", durationSec: 1 }, 15, 30, 30)?.opacity).toBeCloseTo(
			0.875,
		);
	});

	it("delays color phase after the dark-pixels reveal starts", () => {
		const reveal = {
			type: "wipe",
			direction: "left",
			durationSec: 2,
			phase: "dark_pixels_first",
		} as const;
		expect(revealClipStyle(reveal, 30, 60, 30)?.clipPath).toBe("inset(0 12.5% 0 0)");
		expect(revealColorPhaseStyle(reveal, 20, 60, 30)?.clipPath).toBe("inset(0 100% 0 0)");
		expect(revealColorPhaseStyle(reveal, 45, 60, 30)?.clipPath).not.toBe("inset(0 100% 0 0)");
	});

	it("slides black in from right to left first, then colors", () => {
		const reveal = {
			type: "wipe",
			direction: "left",
			durationSec: 1,
			phase: "black_then_color",
		} as const;
		expect(revealDarkPhaseStyle(reveal, 0, 30, 30)?.transform).toBe("translateX(100%)");
		expect(revealDarkPhaseStyle(reveal, 7, 30, 30)?.transform).toBe("translateX(12.5%)");
		expect(revealDarkPhaseStyle(reveal, 15, 30, 30)?.transform).toBe("translateX(0%)");
		expect(revealColorPhaseStyle(reveal, 7, 30, 30)?.clipPath).toBe("inset(0 100% 0 0)");
		expect(revealColorPhaseStyle(reveal, 15, 30, 30)?.clipPath).toBe("inset(0 82.3974609375% 0 0)");
	});

	it("uses the selected black slide direction when provided", () => {
		expect(
			revealDarkPhaseStyle(
				{ type: "wipe", blackDirection: "top", durationSec: 1, phase: "black_then_color" },
				7,
				30,
				30,
			)?.transform,
		).toBe("translateY(-12.5%)");
		expect(
			revealDarkPhaseStyle(
				{ type: "wipe", blackDirection: "none", durationSec: 1, phase: "black_then_color" },
				7,
				30,
				30,
			),
		).toBeUndefined();
	});

	it("computes deterministic reveal enhancement styles", () => {
		expect(revealTextureStyle({ type: "wipe", texture: "paper" })?.maskImage).toContain(
			"repeating-linear-gradient",
		);
		expect(revealClipStyle({ type: "wipe", texture: "glitch" }, 15, 30, 30)?.filter).toContain(
			"drop-shadow",
		);
		expect(
			revealColorBuildStyle(
				{ type: "wipe", colorBuild: "muted_to_full", durationSec: 1 },
				15,
				30,
				30,
			)?.filter,
		).toBe("saturate(0.91875) contrast(0.99)");
	});
});
