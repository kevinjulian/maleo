import { fixtureArtifact } from "@models/agent/artifact-fixture.ts";
import { describe, expect, test } from "vite-plus/test";
import {
	chatFrontier,
	frontierDecision,
	groupChatRuns,
	runIndicator,
	runProgress,
} from "./chat-feed.ts";
import type { ChatLogMessage, StorySectionMsg } from "./chat-log.ts";

const user = (id: number, text: string): ChatLogMessage => ({ id, role: "user", text });
const section = (id: string, status: StorySectionMsg["status"]): StorySectionMsg => ({
	id,
	title: id,
	narration: "",
	visualPrompt: "",
	estimatedDurationSec: 5,
	status,
});
const plan = (id: number, statuses: StorySectionMsg["status"][]): ChatLogMessage => ({
	id,
	role: "assistant",
	jobId: "j1",
	artifact: fixtureArtifact("story_plan", {
		targetSec: 60,
		sections: statuses.map((status, i) => section(`s${i}`, status)),
	}),
});

describe("groupChatRuns", () => {
	test("activity is grouped under its run, not the conversation", () => {
		const runs = groupChatRuns([
			user(1, "make it punchier"),
			{
				id: 2,
				role: "assistant",
				jobId: "j1",
				note: { title: "Step 1", body: "Reading", elapsedSec: 1 },
			},
			{ id: 3, role: "assistant", jobId: "j1", tool: { name: "patch_scene", status: "done" } },
			{
				id: 4,
				role: "assistant",
				jobId: "j1",
				workflow: { id: "w", title: "Edit", route: "edit_scene", readonly: true, items: [] },
			},
			{ id: 5, role: "assistant", jobId: "j1", text: "Tightened the hook." },
		]);
		expect(runs).toHaveLength(1);
		expect(runs[0]!.jobId).toBe("j1");
		expect(runs[0]!.activity.map((m) => m.id)).toEqual([2, 3, 4]);
		expect(runs[0]!.answers.map((m) => m.id)).toEqual([5]);
		expect(runs[0]!.outputs).toEqual([]);
	});

	test("decisions, outputs, results and stops are sorted apart", () => {
		const [run] = groupChatRuns([
			user(1, "plan it"),
			{ id: 2, role: "assistant", jobId: "j1", question: { question: "Approve?", jobId: "j1" } },
			plan(3, ["draft"]),
			{
				id: 4,
				role: "assistant",
				jobId: "j1",
				result: { status: "applied", touched: [{ kind: "slide", id: "k1" }] },
			},
			{ id: 5, role: "assistant", text: "Stopped.", stopped: true },
		]);
		expect(run!.decisions.map((m) => m.id)).toEqual([2]);
		expect(run!.outputs.map((m) => m.id)).toEqual([3]);
		expect(run!.result?.touched).toEqual([{ kind: "slide", id: "k1" }]);
		expect(run!.stopped).toBe(true);
	});

	test("output before any instruction gets a lead run", () => {
		const runs = groupChatRuns([{ id: 1, role: "assistant", text: "Welcome" }, user(2, "go")]);
		expect(runs.map((run) => run.key)).toEqual(["run-lead", "run-2"]);
	});
});

describe("runProgress", () => {
	test("section generation reports stage and count, not just running", () => {
		const [run] = groupChatRuns([
			user(1, "generate"),
			plan(2, ["ready", "ready", "voicing", "pending", "draft", "draft", "draft", "draft"]),
		]);
		const progress = runProgress(run!, { active: true });
		expect(progress.phase).toBe("running");
		expect(progress.stage).toBe("Generating section 3 of 8");
		expect(progress.count).toEqual({ done: 2, total: 8, unit: "sections" });
	});

	test("falls back to the workflow's running step, then to a generic label", () => {
		const [run] = groupChatRuns([
			user(1, "edit"),
			{
				id: 2,
				role: "assistant",
				jobId: "j1",
				workflow: {
					id: "w",
					title: "Edit scene",
					route: "edit_scene",
					readonly: true,
					items: [
						{ id: "a", label: "Read scene", status: "done" },
						{ id: "b", label: "Rewrite narration", status: "running" },
						{ id: "c", label: "Apply", status: "pending" },
					],
				},
			},
		]);
		expect(runProgress(run!, { active: true })).toMatchObject({
			stage: "Rewrite narration",
			count: { done: 1, total: 3, unit: "steps" },
		});
		const [bare] = groupChatRuns([user(1, "edit")]);
		expect(runProgress(bare!, { active: true }).stage).toBe("Working");
	});

	test("completed and failed sections together are a partial result", () => {
		const [run] = groupChatRuns([user(1, "generate"), plan(2, ["ready", "failed", "ready"])]);
		expect(runProgress(run!, { active: false })).toMatchObject({
			phase: "partial",
			readySections: 2,
			failedSections: 1,
		});
		expect(runProgress(run!, { active: false, creditBlocked: true }).phase).toBe("credit");
	});

	test("an error with nothing kept is a failure", () => {
		const [run] = groupChatRuns([
			user(1, "go"),
			{
				id: 2,
				role: "assistant",
				jobId: "j1",
				error: { kind: "unknown", code: "x", title: "Failed", message: "boom", retryable: true },
			},
		]);
		expect(runProgress(run!, { active: false }).phase).toBe("failed");
	});

	test("interrupted, stopped, held and awaiting are distinct", () => {
		const [interrupted] = groupChatRuns([
			user(1, "go"),
			{ id: 2, role: "assistant", jobId: "j9", text: "x" },
		]);
		expect(runProgress(interrupted!, { active: false, interruptedJobId: "j9" }).phase).toBe(
			"interrupted",
		);
		const [stopped] = groupChatRuns([
			user(1, "go"),
			{ id: 2, role: "assistant", text: "Stopped.", stopped: true },
		]);
		expect(runProgress(stopped!, { active: false }).phase).toBe("stopped");
		const [held] = groupChatRuns([
			user(1, "go"),
			{
				id: 2,
				role: "assistant",
				result: { status: "held", touched: [], reason: "changed", conflicts: [] },
			},
		]);
		expect(runProgress(held!, { active: false }).phase).toBe("held");
		const [awaiting] = groupChatRuns([
			user(1, "go"),
			{ id: 2, role: "assistant", question: { question: "?", jobId: "j" } },
		]);
		expect(runProgress(awaiting!, { active: false }).phase).toBe("awaiting");
	});
});

describe("chatFrontier", () => {
	const err = {
		kind: "unknown" as const,
		code: "x",
		title: "Failed",
		message: "boom",
		retryable: true,
	};
	const frontierOf = (
		messages: ChatLogMessage[],
		ctx: Parameters<typeof runProgress>[1] = { active: false },
	) => {
		const runs = groupChatRuns(messages);
		const last = runs[runs.length - 1];
		return chatFrontier(runs, last ? runProgress(last, ctx) : null);
	};

	test("maps each state of the newest run to its one action", () => {
		expect(frontierOf([user(1, "go")], { active: true })).toEqual({
			runKey: "run-1",
			action: "stop",
			outputs: false,
		});
		expect(
			frontierOf([
				user(1, "go"),
				{ id: 2, role: "assistant", question: { question: "?", jobId: "j" } },
			])?.action,
		).toBe("decide");
		expect(
			frontierOf([user(1, "go"), { id: 2, role: "assistant", jobId: "j1", error: err }])?.action,
		).toBe("retry");
		expect(frontierOf([user(1, "go"), plan(2, ["ready", "failed"])])?.action).toBe("retry_failed");
		expect(
			frontierOf([user(1, "go"), { id: 2, role: "assistant", jobId: "j9", text: "x" }], {
				active: false,
				interruptedJobId: "j9",
			})?.action,
		).toBe("resume");
		expect(
			frontierOf([user(1, "go"), plan(2, ["ready", "failed"])], {
				active: false,
				creditBlocked: true,
			})?.action,
		).toBe("credits");
		expect(
			frontierOf([
				user(1, "go"),
				{
					id: 2,
					role: "assistant",
					result: { status: "applied", touched: [{ kind: "clip", id: "scene:1" }] },
				},
			])?.action,
		).toBe("result");
		expect(
			frontierOf([
				user(1, "go"),
				{ id: 2, role: "assistant", result: { status: "applied", touched: [], undoable: true } },
			])?.action,
		).toBe("result");
		// Applied with nothing touched and nothing to undo: no result action, outputs free.
		expect(
			frontierOf([
				user(1, "go"),
				{ id: 2, role: "assistant", result: { status: "applied", touched: [], undoable: false } },
			]),
		).toEqual({ runKey: "run-1", action: null, outputs: true });
		expect(
			frontierOf([
				user(1, "go"),
				{ id: 2, role: "assistant", result: { status: "held", touched: [] } },
			])?.action,
		).toBe("held");
	});

	test("a settled run with nothing to act on keeps the frontier but offers nothing", () => {
		expect(frontierOf([user(1, "go"), { id: 2, role: "assistant", text: "Done." }])).toEqual({
			runKey: "run-1",
			action: null,
			outputs: true,
		});
		expect(
			frontierOf([user(1, "go"), { id: 2, role: "assistant", text: "Stopped.", stopped: true }])
				?.action,
		).toBeNull();
		expect(
			frontierOf([user(1, "go"), { id: 2, role: "assistant", error: { ...err, retryable: false } }])
				?.action,
		).toBeNull();
	});

	test("a newer instruction ends the previous frontier", () => {
		const f = frontierOf([
			user(1, "first"),
			{ id: 2, role: "assistant", jobId: "j1", error: err },
			{
				id: 3,
				role: "assistant",
				result: { status: "applied", touched: [{ kind: "clip", id: "scene:1" }] },
			},
			user(4, "second"),
		]);
		expect(f).toEqual({ runKey: "run-4", action: null, outputs: true });
	});

	test("an empty log has no frontier", () => {
		expect(chatFrontier([], null)).toBeNull();
	});
});

describe("frontier decision and output actions", () => {
	const question = (id: number, text: string, answered = false): ChatLogMessage => ({
		id,
		role: "assistant",
		jobId: "j1",
		question: { question: text, jobId: "j1", answered },
	});

	test("only the newest run's unanswered question is pending", () => {
		expect(frontierDecision(groupChatRuns([user(1, "plan"), question(2, "approve?")]))?.id).toBe(2);
		// A newer instruction supersedes it: nothing is pending any more.
		expect(
			frontierDecision(
				groupChatRuns([user(1, "plan"), question(2, "approve?"), user(3, "something else")]),
			),
		).toBeNull();
		expect(
			frontierDecision(groupChatRuns([user(1, "plan"), question(2, "old"), question(3, "new")]))
				?.id,
		).toBe(3);
		expect(
			frontierDecision(groupChatRuns([user(1, "plan"), question(2, "done", true)])),
		).toBeNull();
		expect(frontierDecision([])).toBeNull();
	});

	test("outputs may act only when the settled run has nothing else to offer", () => {
		const of = (
			messages: ChatLogMessage[],
			ctx: Parameters<typeof runProgress>[1] = { active: false },
		) => {
			const runs = groupChatRuns(messages);
			return chatFrontier(runs, runProgress(runs[runs.length - 1]!, ctx))?.outputs;
		};
		expect(
			of([user(1, "critique"), { id: 2, role: "assistant", jobId: "j1", text: "Done." }]),
		).toBe(true);
		expect(of([user(1, "go")], { active: true })).toBe(false);
		expect(of([user(1, "go"), question(2, "?")])).toBe(false);
		expect(of([user(1, "go"), plan(2, ["ready", "failed"])])).toBe(false);
		expect(
			of([
				user(1, "go"),
				{
					id: 2,
					role: "assistant",
					result: { status: "applied", touched: [{ kind: "clip", id: "scene:1" }] },
				},
			]),
		).toBe(false);
		expect(
			of([user(1, "go"), { id: 2, role: "assistant", result: { status: "held", touched: [] } }]),
		).toBe(false);
		expect(of([user(1, "go"), { id: 2, role: "assistant", text: "Stopped.", stopped: true }])).toBe(
			false,
		);
	});
});

describe("replies", () => {
	test("an answer stays in the run it answers and does not supersede its decision", () => {
		const messages: ChatLogMessage[] = [
			user(1, "plan"),
			{ id: 2, role: "assistant", jobId: "j1", question: { question: "Approve?", jobId: "j1" } },
			{ id: 3, role: "user", text: "approve", reply: true },
		];
		const runs = groupChatRuns(messages);
		expect(runs).toHaveLength(1);
		expect(runs[0]!.replies.map((m) => m.id)).toEqual([3]);
		// Unanswered until the server accepts: the decision is still the frontier's.
		expect(frontierDecision(runs)?.id).toBe(2);
	});
});

describe("runIndicator", () => {
	const ask = (id: number, answered = false): ChatLogMessage => ({
		id,
		role: "assistant",
		jobId: "j1",
		question: { question: "Approve?", jobId: "j1", answered },
	});
	const failure = (id: number): ChatLogMessage => ({
		id,
		role: "assistant",
		jobId: "j1",
		error: {
			kind: "unknown",
			code: "provider_failed",
			title: "Failed",
			message: "Provider failed",
			retryable: true,
		},
	});

	test("an empty conversation reports nothing", () => {
		expect(runIndicator([], { running: false })).toBeNull();
	});

	test("a run in flight reports running", () => {
		expect(runIndicator([user(1, "go")], { running: true })).toBe("running");
	});

	test("a parked decision outranks running, because it needs the user", () => {
		expect(runIndicator([user(1, "plan it"), ask(2)], { running: true })).toBe("input");
		expect(runIndicator([user(1, "plan it"), ask(2)], { running: false })).toBe("input");
	});

	test("an answered decision is not input", () => {
		expect(runIndicator([user(1, "plan it"), ask(2, true)], { running: false })).toBeNull();
	});

	test("a failed, partial or interrupted run reports failed", () => {
		expect(runIndicator([user(1, "go"), failure(2)], { running: false })).toBe("failed");
		expect(runIndicator([user(1, "go"), plan(2, ["ready", "failed"])], { running: false })).toBe(
			"failed",
		);
		expect(
			runIndicator([user(1, "go"), { id: 2, role: "assistant", jobId: "j1", text: "Working" }], {
				running: false,
				interruptedJobId: "j1",
			}),
		).toBe("failed");
	});

	test("a settled run reports nothing, and a newer instruction ends an older failure", () => {
		expect(
			runIndicator([user(1, "go"), { id: 2, role: "assistant", jobId: "j1", text: "Done." }], {
				running: false,
			}),
		).toBeNull();
		expect(
			runIndicator([user(1, "go"), failure(2), user(3, "again")], { running: false }),
		).toBeNull();
	});
});
