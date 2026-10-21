import { describe, expect, it } from "vite-plus/test";
import { logWithoutReplayedRun, shouldApplySettledAgentJob } from "./use-content-agent.ts";

describe("settled agent apply", () => {
	it("never reapplies a stale failed or cancelled snapshot", () => {
		expect(shouldApplySettledAgentJob("error")).toBe(false);
		expect(shouldApplySettledAgentJob("done")).toBe(true);
		expect(shouldApplySettledAgentJob("needs_attention")).toBe(true);
	});
});

/* Reported live: the clarification card appeared twice, both marked "Answered."
 *
 * A reload replays a still-running job from its first event. The log used to be cut
 * at the last user message before that replay — but answering a question writes a
 * user message, so the question card ahead of it survived the cut and the replay
 * added it again. */
describe("dropping a run's cards before it is replayed", () => {
	const log: Array<{
		id: number;
		role: string;
		text?: string;
		jobId?: string;
		question?: { question: string };
		workflow?: { id: string };
	}> = [
		{ id: 1, role: "user", text: "make a video" },
		{ id: 2, role: "assistant", jobId: "job-a", question: { question: "Which city?" } },
		{ id: 3, role: "user", text: "City Context: Late-medieval London" },
		{ id: 4, role: "assistant", jobId: "job-a", workflow: { id: "active" } },
	];

	it("drops every card the replayed run contributed, wherever it sits", () => {
		const kept = logWithoutReplayedRun(log, "job-a");
		expect(kept.map((m) => m.id)).toEqual([1, 3]);
	});

	it("keeps the question card that a last-user-message cut would have left behind", () => {
		// The old rule kept everything up to message 3, which included the card at 2.
		expect(logWithoutReplayedRun(log, "job-a").some((m) => "question" in m)).toBe(false);
	});

	it("leaves another run's cards alone", () => {
		const kept = logWithoutReplayedRun(
			[...log, { id: 5, role: "assistant", jobId: "job-b", text: "from an earlier run" }],
			"job-a",
		);
		expect(kept.map((m) => m.id)).toEqual([1, 3, 5]);
	});

	it("keeps user messages, which a replay never re-emits", () => {
		expect(logWithoutReplayedRun(log, "job-a").every((m) => m.role === "user")).toBe(true);
	});

	it("is a no-op for a job that contributed nothing", () => {
		expect(logWithoutReplayedRun(log, "job-z")).toHaveLength(4);
	});
});
