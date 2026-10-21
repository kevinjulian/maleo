import { describe, expect, it } from "vite-plus/test";
import { classifyRenderError } from "../src/lib/error-codes";
import { describePreset, presetAspect, PRESETS } from "../src/lib/presets";

describe("classifyRenderError", () => {
	it("classifies validation failures as permanent (non-retryable)", () => {
		const c = classifyRenderError("invalid storyboard: expected number");
		expect(c.code).toBe("VALIDATION_ERROR");
		expect(c.retryable).toBe(false);
	});

	it("classifies image-service failures as IMAGE_GEN_TIMEOUT (retryable)", () => {
		const c = classifyRenderError("image-service generate fetch failed");
		expect(c.code).toBe("IMAGE_GEN_TIMEOUT");
		expect(c.retryable).toBe(true);
	});

	it("classifies TTS failures as TTS_PROVIDER_DOWN", () => {
		expect(classifyRenderError("kokoro unreachable").code).toBe("TTS_PROVIDER_DOWN");
	});

	it("classifies lease-expiry as WORKER_CRASHED", () => {
		expect(classifyRenderError("worker lease expired (presumed crashed)").code).toBe(
			"WORKER_CRASHED",
		);
	});

	it("falls back to UNKNOWN for unrecognized messages", () => {
		expect(classifyRenderError("???").code).toBe("UNKNOWN");
	});
});

describe("describePreset", () => {
	it("derives aspect from composition id", () => {
		expect(presetAspect("StoryboardReel")).toBe("vertical");
		expect(presetAspect("ProductSquare")).toBe("square");
		expect(presetAspect("ProductWide")).toBe("horizontal");
	});

	it("adds a human label + duration hint", () => {
		const d = describePreset(PRESETS["storyboard-tiktok"]!);
		expect(d.label).toBe("Storyboard · TikTok");
		expect(d.aspectRatio).toBe("9:16");
		expect(d.hint).toBe("9:16 · up to 60s");
	});

	it("formats long durations in minutes", () => {
		const d = describePreset(PRESETS["yt-long"]!);
		expect(d.hint).toContain("min");
	});
});
