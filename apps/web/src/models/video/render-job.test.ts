import { describe, expect, it } from "vite-plus/test";
import { jobAffordances, type Job } from "./render-job.ts";

const job = (over: Partial<Job>): Job => ({
	id: "j1",
	preset: "tiktok",
	status: "queued",
	output_path: null,
	error: null,
	progress: 0,
	created_at: 0,
	finished_at: null,
	...over,
});

describe("jobAffordances", () => {
	it("offers no retry for a validation failure — the storyboard has to change first", () => {
		const a = jobAffordances(job({ status: "error", error_code: "VALIDATION_ERROR" }));
		expect(a.failed).toBe(true);
		expect(a.canRetry).toBe(false);
	});

	it("offers retry for a transient failure", () => {
		expect(jobAffordances(job({ status: "error", error_code: "TTS_PROVIDER_DOWN" })).canRetry).toBe(
			true,
		);
	});

	it("offers retry for a failure with no code at all", () => {
		expect(jobAffordances(job({ status: "cancelled" })).canRetry).toBe(true);
	});

	it("treats silent audio as the audio-only degradation, so images are not re-run", () => {
		expect(
			jobAffordances(job({ status: "done_with_fallback", phase_detail: "silent audio track" }))
				.audioOnly,
		).toBe(true);
	});

	it("treats placeholder art as needing a full re-render", () => {
		expect(
			jobAffordances(job({ status: "done_with_fallback", phase_detail: "placeholder image used" }))
				.audioOnly,
		).toBe(false);
	});

	it("marks queued and running active, finished states not", () => {
		expect(jobAffordances(job({ status: "running" })).active).toBe(true);
		expect(jobAffordances(job({ status: "done" })).active).toBe(false);
		expect(jobAffordances(job({ status: "done" })).ready).toBe(true);
	});
});
