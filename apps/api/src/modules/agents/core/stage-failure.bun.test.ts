/* Stage failure codes and their one consumer (standardize-pipeline-artifact-
 * contracts 5.2): a retryable failure is re-entered by the durable host, any
 * other ends the run needing attention. */
import { describe, expect, test } from "bun:test";
import type { AgentJob } from "./model.ts";
import {
	RetryableStageError,
	STAGE_FAILURE_CODES,
	settleStageFailure,
	stageFailure,
	type StageFailureCode,
} from "./stage-failure.ts";

function job(): AgentJob {
	return {
		id: "run-f",
		projectId: "p",
		contentType: "video",
		status: "running",
		events: [],
		scenes: [],
		textOverlays: [],
		infographicOverlays: [],
		videoOverlays: [],
		audioOverlays: [],
		characters: [],
		artifacts: [],
		aspect: "9:16",
		brief: "b",
		startedAt: 0,
	};
}

describe("every failure code names its consumer", () => {
	test("each code says who raises it and who acts on it", () => {
		for (const definition of Object.values(STAGE_FAILURE_CODES)) {
			expect(definition.raisedBy.length).toBeGreaterThan(0);
			expect(definition.consumer.length).toBeGreaterThan(0);
		}
	});

	test("retryability comes from the code, not the call site", () => {
		for (const code of Object.keys(STAGE_FAILURE_CODES) as StageFailureCode[]) {
			expect(stageFailure(code, "m").retryable).toBe(STAGE_FAILURE_CODES[code].retryable);
		}
	});
});

describe("settling a failure", () => {
	test("a non-retryable failure ends the run needing attention, with its message", () => {
		const current = job();
		settleStageFailure(current, stageFailure("approval_refused", "Story direction needs review."));
		expect(current.status).toBe("needs_attention");
		expect(current.events.at(-1)).toEqual({ kind: "final", text: "Story direction needs review." });
	});

	test("a retryable failure is thrown for the durable host, leaving the run as it was", () => {
		const current = job();
		expect(() =>
			settleStageFailure(current, stageFailure("generation_failed", "TTS unavailable")),
		).toThrow(RetryableStageError);
		expect(current.status).toBe("running");
	});
});
