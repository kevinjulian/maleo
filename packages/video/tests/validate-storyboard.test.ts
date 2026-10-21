import { describe, expect, test } from "vite-plus/test";
import { storyboardSchema } from "../src/schema";
import { assertRenderStoryboard, validateRenderStoryboard } from "../src/lib/validate-storyboard";

function storyboard(over: Record<string, unknown> = {}) {
	return storyboardSchema.parse({
		scenes: [{ image: "/files/scene.png", durationSec: 4 }],
		...over,
	});
}

describe("render storyboard validation", () => {
	test("blocks enabled stale caption output with recovery instructions", () => {
		const captionCues = [
			{
				id: "caption:1",
				type: "caption",
				startSec: 0,
				durationSec: 2,
				track: 1,
				caption: {
					text: "Authored",
					words: [],
					sources: [],
					provenance: { origin: "manual", wordTimingOrigin: "estimated" },
					protection: { text: true, timing: false, segmentation: false, style: false },
					revision: 1,
					groupId: "g",
					status: "needs-refresh",
				},
			},
		];
		expect(validateRenderStoryboard(storyboard({ captionCues })).findings).toContainEqual(
			expect.objectContaining({
				id: "captions-need-refresh",
				ref: "caption:1",
				message: expect.stringContaining("Refresh captions or disable captions"),
			}),
		);
		expect(
			validateRenderStoryboard(storyboard({ captionCues, captions: { enabled: false } })).status,
		).toBe("passed");
	});
	test("passes a renderable storyboard", () => {
		expect(validateRenderStoryboard(storyboard()).status).toBe("passed");
	});
	test("renders imported video without authored scenes and refuses empty output", () => {
		expect(
			validateRenderStoryboard(
				storyboard({
					scenes: [],
					videoOverlays: [{ url: "/api/media/video", startSec: 0, durationSec: 3 }],
				}),
			).status,
		).toBe("passed");
		expect(validateRenderStoryboard(storyboard({ scenes: [] })).findings).toContainEqual(
			expect.objectContaining({ id: "visual-content-missing" }),
		);
	});

	test("blocks missing media and fully off-canvas layouts", () => {
		const report = validateRenderStoryboard(
			storyboard({ scenes: [{ image: "", durationSec: 4, layout: { xPct: 110, widthPct: 20 } }] }),
		);
		expect(report.status).toBe("failed");
		expect(report.findings.map((finding) => finding.id)).toEqual(
			expect.arrayContaining(["scene-image-missing", "scene-layout-off-canvas"]),
		);
		expect(() =>
			assertRenderStoryboard(storyboard({ scenes: [{ image: "", durationSec: 4 }] })),
		).toThrow(/Scene 1 has no renderable image/);
	});

	test("validates the authoritative visual timeline instead of hidden base images", () => {
		const report = validateRenderStoryboard(
			storyboard({
				scenes: [{ image: "", durationSec: 4 }],
				visualTimeline: [{ url: "/files/visual.png", startSec: 0, durationSec: 4 }],
			}),
		);
		expect(report.status).toBe("passed");
	});

	test("accepts reveal metadata on every visual render path", () => {
		const parsed = storyboard({
			scenes: [
				{
					image: "/files/scene.png",
					durationSec: 4,
					visualClips: [{ url: "/files/scene.png", reveal: { type: "wipe", direction: "left" } }],
				},
			],
			visualTimeline: [
				{ url: "/files/visual.png", startSec: 0, durationSec: 4, reveal: { type: "fade" } },
			],
			videoOverlays: [
				{
					url: "/files/overlay.png",
					startSec: 0,
					durationSec: 4,
					reveal: {
						type: "spotlight",
						direction: "center",
						phase: "black_then_color",
						texture: "paper",
						colorBuild: "muted_to_full",
					},
				},
			],
		});
		expect(parsed.scenes[0]!.visualClips?.[0]?.reveal).toEqual({ type: "wipe", direction: "left" });
		expect(parsed.visualTimeline?.[0]?.reveal).toEqual({ type: "fade" });
		expect(parsed.videoOverlays[0]!.reveal).toEqual({
			type: "spotlight",
			direction: "center",
			phase: "black_then_color",
			texture: "paper",
			colorBuild: "muted_to_full",
		});
	});

	test("blocks unresolved audio clips before Remotion", () => {
		const report = validateRenderStoryboard(
			storyboard({
				audioOverlays: [{ kind: "music", content: "bed", url: "", startSec: 0, durationSec: 4 }],
			}),
		);
		expect(report.findings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "audio-url-missing", severity: "blocker" }),
			]),
		);
	});
});
