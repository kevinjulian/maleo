/* Route-level guard for the chat flow on the internal agent runtime: each route
 * fences the run on the product record and hands it to the run host. A
 * recording host stands in for the durable one, so no server is needed. */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { registerGenerationRoutes } from "./generation.ts";
import { closeMaleoDb } from "@maleo/db/connection";
import { createContentProject } from "@maleo/db/project-detail";
import { upsertWorkflowRun, clearWorkflowRunsForTests } from "@maleo/db/workflow-run-db";
import { clearAgentJobsForTests } from "../../modules/agents/core/session-store.ts";
import { loadRun } from "../../modules/agents/core/run-repository.ts";
import { setRunHostForTests } from "../../modules/agents/core/runtime/durable.ts";
import { executionId } from "../../modules/agents/core/runtime/run-state.ts";
import type { RunHost } from "../../modules/agents/core/service.ts";
import { listWorkflowRunIds } from "@maleo/db/workflow-run-db";

/* The database path is read lazily, inside `openDb()`, so setting it before
 * the first call is enough — these imports used to be dynamic only to run before
 * the module graph evaluated. */
const tmpDir = mkdtempSync(join(tmpdir(), "gen-chat-"));
process.env.MALEO_DB_PATH = join(tmpDir, "test.db");

/** What reached the host: a start or a resume, for which run and execution, with what text. */
interface HostCall {
	kind: "start" | "resume";
	runId: string;
	execution: string;
	text: string;
}
const sent: HostCall[] = [];
const host: RunHost = {
	start: async (job, message) => {
		sent.push({ kind: "start", runId: job.id, execution: executionId(job), text: message });
	},
	resume: async (job, answer) => {
		sent.push({ kind: "resume", runId: job.id, execution: executionId(job), text: answer });
	},
};

/** The host is called after the route answers; wait for the call. */
async function reached(count = 1): Promise<void> {
	for (let i = 0; i < 200 && sent.length < count; i++) await Bun.sleep(5);
}

async function seedRun(
	projectId: string,
	id: string,
	status: "running" | "error" | "awaiting_input" | "done",
	runtime: "agent" | "legacy" = "agent",
): Promise<void> {
	await upsertWorkflowRun({
		id,
		project_id: projectId,
		content_type: "video",
		status,
		snapshot: {
			id,
			projectId,
			contentType: "video",
			status,
			events: [],
			scenes: [],
			slides: [],
			posts: [],
			textOverlays: [],
			videoOverlays: [],
			audioOverlays: [],
			characters: [],
			artifacts: [],
			aspect: "9:16",
			brief: "b",
			startedAt: Date.now(),
			run: {
				instruction: "make a video",
				transcript: "t",
				step: 3,
				builtSomething: true,
				finishRejected: false,
				asks: 0,
				...(runtime === "agent"
					? { runtime }
					: {
							pipeline: {
								profile: { name: "storyPlan", stages: ["plan"] },
								cursor: "plan",
								mode: "gated",
								status: "awaiting_approval",
							},
						}),
			},
			error: status === "error" ? "Run interrupted — retry to continue." : undefined,
			pendingActionId: status === "awaiting_input" ? "action-xyz" : undefined,
		},
	});
}

function app(): Hono {
	const a = new Hono();
	registerGenerationRoutes(a);
	return a;
}

async function chat(projectId: string, instruction = "make a video"): Promise<Response> {
	return app().request(`/projects/${projectId}/chat`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ instruction, content_type: "video" }),
	});
}

beforeEach(async () => {
	sent.length = 0;
	setRunHostForTests(host);
	await clearWorkflowRunsForTests();
	clearAgentJobsForTests();
});
afterEach(() => setRunHostForTests(undefined));
afterAll(async () => {
	await closeMaleoDb();
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("POST /projects/:id/chat routing", () => {
	test("starts the built run on the host with the instruction", async () => {
		const pid = (await createContentProject({ title: "t", type: "video" })).project.id;
		const res = await chat(pid);
		expect(res.status).toBe(202);
		const body = (await res.json()) as { jobId: string };
		await reached();
		expect(sent).toEqual([
			{
				kind: "start",
				runId: body.jobId,
				execution: body.jobId,
				text: expect.stringContaining("make a video"),
			},
		]);
	});

	test("a second message while a run is in flight joins that run and starts nothing", async () => {
		const pid = (await createContentProject({ title: "t", type: "video" })).project.id;
		await seedRun(pid, "run-busy", "running");
		const res = await chat(pid, "and another");
		expect(((await res.json()) as { jobId: string }).jobId).toBe("run-busy");
		await Bun.sleep(50);
		expect(sent).toEqual([]);
	});

	test("unknown project 404s, nothing reaches the host", async () => {
		const res = await chat("00000000-0000-0000-0000-000000000000");
		expect(res.status).toBe(404);
		expect(sent).toHaveLength(0);
	});
});

describe("POST /projects/:id/chat/:jobId/resume", () => {
	async function resume(pid: string, jobId: string): Promise<Response> {
		return app().request(`/projects/${pid}/chat/${jobId}/resume`, { method: "POST" });
	}

	test("continues an interrupted run as a fresh execution of the same job", async () => {
		const pid = (await createContentProject({ title: "t", type: "video" })).project.id;
		await seedRun(pid, "run-int", "error");
		const res = await resume(pid, "run-int");
		expect(res.status).toBe(202);
		expect(((await res.json()) as { status: string }).status).toBe("running");
		await reached();
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({
			kind: "start",
			runId: "run-int",
			text: expect.stringContaining("make a video"),
		});
		// The errored execution cannot resume, so the job gets a new one; answers follow it.
		expect(sent[0]?.execution).toMatch(/^run-int:resume:\d+$/);
		const resumed = (await loadRun("run-int"))!;
		expect(resumed.status).toBe("running");
		expect(resumed.error).toBeUndefined();
		expect(resumed.run?.executionId).toBe(sent[0]?.execution);
	});

	test("resuming a done run 409s, nothing reaches the host", async () => {
		const pid = (await createContentProject({ title: "t", type: "video" })).project.id;
		await seedRun(pid, "run-done", "done");
		const res = await resume(pid, "run-done");
		expect(res.status).toBe(409);
		expect(sent).toHaveLength(0);
	});

	test("resuming an awaiting_input run 409s (answer instead)", async () => {
		const pid = (await createContentProject({ title: "t", type: "video" })).project.id;
		await seedRun(pid, "run-await", "awaiting_input");
		const res = await resume(pid, "run-await");
		expect(res.status).toBe(409);
		expect(sent).toHaveLength(0);
	});

	test("resuming a live running run 409s (no double-enqueue)", async () => {
		const pid = (await createContentProject({ title: "t", type: "video" })).project.id;
		await seedRun(pid, "run-live", "running");
		const res = await resume(pid, "run-live");
		expect(res.status).toBe(409);
		expect(sent).toHaveLength(0);
	});

	test("unknown run 404s", async () => {
		const pid = (await createContentProject({ title: "t", type: "video" })).project.id;
		const res = await resume(pid, "nope");
		expect(res.status).toBe(404);
	});
});

describe("POST /projects/:id/chat/:jobId/answer", () => {
	test("resumes the run with the answer to the action it waits on", async () => {
		const pid = (await createContentProject({ title: "t", type: "video" })).project.id;
		await seedRun(pid, "run-ans", "awaiting_input"); // pendingActionId = action-xyz
		const res = await app().request(`/projects/${pid}/chat/run-ans/answer`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ answer: "approve" }),
		});
		expect(res.status).toBe(202);
		await reached();
		expect(sent).toEqual([
			{ kind: "resume", runId: "run-ans", execution: "run-ans", text: "approve" },
		]);
		expect((await loadRun("run-ans"))?.pendingActionId).toBeUndefined();
	});

	test("rejects an answer for a stale actionId", async () => {
		const pid = (await createContentProject({ title: "t", type: "video" })).project.id;
		await seedRun(pid, "run-stale", "awaiting_input"); // pendingActionId = action-xyz
		const res = await app().request(`/projects/${pid}/chat/run-stale/answer`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ answer: "approve", action_id: "old-action" }),
		});
		expect(res.status).toBe(409);
		expect(((await res.json()) as { error: string }).error).toBe("stale_action");
		expect(sent).toHaveLength(0);
	});

	/* The structured pre-research clarification submission. The route is the gate:
	 * it must not release the parked run — and therefore must not resolve the
	 * required action — unless the batch is completely answered. */
	const batch = {
		id: "batch-1",
		stage: "pre_research" as const,
		purpose: "story_brief" as const,
		questions: [
			{
				id: "audience",
				header: "Audience",
				question: "Who is this for?",
				options: [
					{
						id: "leaders",
						label: "Team leaders",
						value: "team leaders",
						description: "Frames tradeoffs.",
						recommended: true,
					},
					{
						id: "newcomers",
						label: "Newcomers",
						value: "newcomers",
						description: "Defines terms first.",
					},
				],
			},
			{
				id: "context",
				header: "Example context",
				question: "Which example?",
				options: [
					{
						id: "harbour",
						label: "A harbour",
						value: "a working harbour",
						description: "Grounds it.",
						recommended: true,
					},
					{
						id: "lab",
						label: "A lab model",
						value: "a lab tide model",
						description: "Keeps it abstract.",
					},
				],
			},
		],
	};

	async function seedClarificationRun(projectId: string, id: string): Promise<void> {
		await upsertWorkflowRun({
			id,
			project_id: projectId,
			content_type: "video",
			status: "awaiting_input",
			snapshot: {
				id,
				projectId,
				contentType: "video",
				status: "awaiting_input",
				events: [],
				scenes: [],
				slides: [],
				posts: [],
				textOverlays: [],
				videoOverlays: [],
				audioOverlays: [],
				characters: [],
				artifacts: [],
				aspect: "9:16",
				brief: "tides",
				startedAt: Date.now(),
				run: {
					instruction: "make a video about tides",
					transcript: "",
					step: 0,
					builtSomething: false,
					finishRejected: false,
					asks: 0,
					runtime: "agent",
					storyClarification: { batch, status: "pending", actionId: "action-xyz" },
				},
				pendingQuestion: { question: "A few decisions first.", options: [], batch },
				pendingActionId: "action-xyz",
			},
		});
	}

	async function answerBatch(
		pid: string,
		id: string,
		body: Record<string, unknown>,
	): Promise<Response> {
		return app().request(`/projects/${pid}/chat/${id}/answer`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	}

	test("a complete batch answer is accepted and carried on the resume event", async () => {
		const pid = (await createContentProject({ title: "t", type: "video" })).project.id;
		await seedClarificationRun(pid, "run-batch");
		const res = await answerBatch(pid, "run-batch", {
			action_id: "action-xyz",
			batch_answer: {
				batchId: "batch-1",
				answers: [
					{ questionId: "audience", optionId: "leaders" },
					{ questionId: "context", otherText: "a tidal power station" },
				],
			},
		});
		expect(res.status).toBe(202);
		await reached();
		expect(sent).toHaveLength(1);
		expect(sent[0]?.kind).toBe("resume");
		expect(sent[0]?.text).toContain("story-clarification:");
		expect(sent[0]?.text).toContain("a tidal power station");
	});

	test("best judgment alone is a complete answer", async () => {
		const pid = (await createContentProject({ title: "t", type: "video" })).project.id;
		await seedClarificationRun(pid, "run-batch-bj");
		const res = await answerBatch(pid, "run-batch-bj", {
			action_id: "action-xyz",
			batch_answer: { batchId: "batch-1", bestJudgment: true },
		});
		expect(res.status).toBe(202);
		await reached();
		expect(sent).toHaveLength(1);
	});

	test("an unanswered question is rejected and names what is missing — nothing is released", async () => {
		const pid = (await createContentProject({ title: "t", type: "video" })).project.id;
		await seedClarificationRun(pid, "run-batch-partial");
		const res = await answerBatch(pid, "run-batch-partial", {
			action_id: "action-xyz",
			batch_answer: {
				batchId: "batch-1",
				answers: [{ questionId: "audience", optionId: "leaders" }],
			},
		});
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: "incomplete", missing: ["context"] });
		expect(sent).toHaveLength(0);
	});

	test("empty Other text is not an answer", async () => {
		const pid = (await createContentProject({ title: "t", type: "video" })).project.id;
		await seedClarificationRun(pid, "run-batch-empty");
		const res = await answerBatch(pid, "run-batch-empty", {
			action_id: "action-xyz",
			batch_answer: {
				batchId: "batch-1",
				answers: [
					{ questionId: "audience", otherText: "  " },
					{ questionId: "context", optionId: "harbour" },
				],
			},
		});
		expect(res.status).toBe(400);
		expect(((await res.json()) as { error: string }).error).toBe("invalid_body");
		expect(sent).toHaveLength(0);
	});

	test("a mismatched batch id and an unknown option are both rejected", async () => {
		const pid = (await createContentProject({ title: "t", type: "video" })).project.id;
		await seedClarificationRun(pid, "run-batch-mismatch");
		const mismatched = await answerBatch(pid, "run-batch-mismatch", {
			action_id: "action-xyz",
			batch_answer: { batchId: "other", bestJudgment: true },
		});
		expect(mismatched.status).toBe(409);
		expect(((await mismatched.json()) as { error: string }).error).toBe("batch_mismatch");
		const unknown = await answerBatch(pid, "run-batch-mismatch", {
			action_id: "action-xyz",
			batch_answer: {
				batchId: "batch-1",
				answers: [
					{ questionId: "audience", optionId: "nope" },
					{ questionId: "context", optionId: "harbour" },
				],
			},
		});
		expect(unknown.status).toBe(400);
		expect(sent).toHaveLength(0);
	});

	test("a superseded action id leaves the current batch pending", async () => {
		const pid = (await createContentProject({ title: "t", type: "video" })).project.id;
		await seedClarificationRun(pid, "run-batch-stale");
		const res = await answerBatch(pid, "run-batch-stale", {
			action_id: "old-action",
			batch_answer: { batchId: "batch-1", bestJudgment: true },
		});
		expect(res.status).toBe(409);
		expect(((await res.json()) as { error: string }).error).toBe("stale_action");
		expect(sent).toHaveLength(0);
	});

	test("a legacy string answer still works on a clarification run", async () => {
		const pid = (await createContentProject({ title: "t", type: "video" })).project.id;
		await seedClarificationRun(pid, "run-batch-legacy");
		const res = await answerBatch(pid, "run-batch-legacy", {
			answer: "team leaders",
			action_id: "action-xyz",
		});
		expect(res.status).toBe(202);
		await reached();
		expect(sent[0]?.text).toBe("team leaders");
	});

	test("answering a non-awaiting run 409s, nothing reaches the host", async () => {
		const pid = (await createContentProject({ title: "t", type: "video" })).project.id;
		await seedRun(pid, "run-run", "running");
		const res = await app().request(`/projects/${pid}/chat/run-run/answer`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ answer: "x" }),
		});
		expect(res.status).toBe(409);
		expect(sent).toHaveLength(0);
	});
});

describe("POST /projects/:id/chat/:jobId/cancel", () => {
	test("stops an awaiting run on the product record at once", async () => {
		const pid = (await createContentProject({ title: "t", type: "video" })).project.id;
		await seedRun(pid, "run-stop", "awaiting_input");
		const res = await app().request(`/projects/${pid}/chat/run-stop/cancel`, { method: "POST" });
		expect(res.status).toBe(202);
		expect(((await res.json()) as { status: string }).status).toBe("error");
		const stopped = (await loadRun("run-stop"))!;
		expect(stopped.error).toBe("Run stopped by user.");
		expect(stopped.pendingActionId).toBeUndefined();
		expect(stopped.events.at(-1)).toEqual({ kind: "final", text: "Stopped." });
		expect(sent).toEqual([]);
	});

	test("done run cancel is idempotent and reaches no host", async () => {
		const pid = (await createContentProject({ title: "t", type: "video" })).project.id;
		await seedRun(pid, "run-done-stop", "done");
		const res = await app().request(`/projects/${pid}/chat/run-done-stop/cancel`, {
			method: "POST",
		});
		expect(res.status).toBe(200);
		expect(sent).toHaveLength(0);
	});
});

/* adopt-mastra-internal-agent 3.2: a run persisted by the replaced loop, parked
 * on a gate with its pipeline cursor, after the cutover. */
describe("the poll carries a run's executed commands (move-agent-tools-to-editor-commands)", () => {
	const commands = [
		{ type: "clip.remove", id: "scene:4" },
		{ type: "clip.update", id: "text:2", patch: { track: 1 } },
	];
	const base = [
		{ kind: "clip", id: "scene:4", hash: "h4" },
		{ kind: "clip", id: "text:2", hash: "h2" },
	];
	async function seedEdits(projectId: string, id: string, jobWrites: boolean): Promise<void> {
		await upsertWorkflowRun({
			id,
			project_id: projectId,
			content_type: "video",
			status: "done",
			snapshot: {
				id,
				projectId,
				contentType: "video",
				status: "done",
				events: [],
				scenes: [],
				slides: [],
				posts: [],
				textOverlays: [],
				videoOverlays: [],
				audioOverlays: [],
				characters: [],
				artifacts: [],
				aspect: "9:16",
				brief: "b",
				startedAt: Date.now(),
				editCommands: commands,
				baseFingerprints: base,
				run: {
					instruction: "tighten it",
					transcript: "t",
					step: 3,
					builtSomething: true,
					finishRejected: false,
					asks: 0,
					runtime: "agent",
					...(jobWrites ? { jobWrites } : {}),
				},
			},
		});
	}
	const poll = async (projectId: string, id: string) =>
		(await app().request(`/projects/${projectId}/chat/${id}`)).json() as Promise<{
			commands?: unknown[];
			commandBase?: unknown[];
		}>;

	test("an edit-only run carries its commands in order", async () => {
		const { project } = await createContentProject({ title: "Edits", type: "video" });
		await seedEdits(project.id, "run-edits", false);
		const body = await poll(project.id, "run-edits");
		expect(body.commands).toEqual(commands);
		expect(body.commandBase).toEqual(base);
	});

	test("a run that also wrote the job carries none", async () => {
		const { project } = await createContentProject({ title: "Mixed", type: "video" });
		await seedEdits(project.id, "run-mixed", true);
		const body = await poll(project.id, "run-mixed");
		expect([body.commands, body.commandBase]).toEqual([undefined, undefined]);
	});

	test("a generation run carries none", async () => {
		const { project } = await createContentProject({ title: "Plan", type: "video" });
		await seedRun(project.id, "run-plan", "done");
		expect((await poll(project.id, "run-plan")).commands).toBeUndefined();
	});
});

/* Image and text projects are retired: the server refuses their AI entry points
 * outright, so an old tab or a script cannot start work against removed tools. */
describe("retired content types", () => {
	for (const type of ["image", "text"] as const) {
		test(`chat on a stored ${type} project is refused before any run exists`, async () => {
			const pid = (await createContentProject({ title: "legacy", type })).project.id;
			const res = await app().request(`/projects/${pid}/chat`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ instruction: "add a slide", content_type: type }),
			});
			expect(res.status).toBe(400);
			expect(await res.json()).toEqual({ error: "unsupported_content_type" });
			await Bun.sleep(20);
			expect(sent).toEqual([]);
			expect(await listWorkflowRunIds(pid)).toEqual([]);
		});
	}
});

/* One-shot generation is gone: it had no caller once image and text were retired. */
test("POST /generate no longer exists", async () => {
	const res = await app().request("/generate", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ type: "video", brief: "seeds" }),
	});
	expect(res.status).toBe(404);
});
