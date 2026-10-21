import { describe, expect, it } from "vite-plus/test";
import { describeRenderState, shouldPollRenderJob } from "./launcher.tsx";

describe("create-content launcher queue helpers", () => {
	it("polls only active queue states", () => {
		expect(shouldPollRenderJob("queued")).toBe(true);
		expect(shouldPollRenderJob("running")).toBe(true);
		expect(shouldPollRenderJob("done")).toBe(false);
		expect(shouldPollRenderJob("error")).toBe(false);
	});

	it("prefers phase detail when present", () => {
		expect(
			describeRenderState({
				id: "job-1",
				status: "running",
				phase: "rendering",
				phase_detail: "Compositing scene 3 of 8",
				progress: 0.42,
			}),
		).toBe("Compositing scene 3 of 8");
	});

	it("names the actual degradation cause from phase_detail (not a hardcoded 'silent')", () => {
		// Placeholder-only degradation must NOT claim silent audio.
		expect(
			describeRenderState({
				id: "job-2",
				status: "done_with_fallback",
				phase_detail: "2 frames used placeholder art",
				progress: 1,
			}),
		).toBe("Render complete — 2 frames used placeholder art");
	});

	it("combines multiple degradation causes from phase_detail", () => {
		expect(
			describeRenderState({
				id: "job-3",
				status: "done_with_fallback",
				phase_detail: "rendered silent (TTS unavailable); 1 frame used placeholder art",
				progress: 1,
			}),
		).toBe("Render complete — rendered silent (TTS unavailable); 1 frame used placeholder art");
	});

	it("falls back to a generic degraded label when phase_detail is absent", () => {
		expect(
			describeRenderState({
				id: "job-4",
				status: "done_with_fallback",
				progress: 1,
			}),
		).toBe("Render complete (degraded)");
	});
});
