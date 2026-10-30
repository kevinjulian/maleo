import { setConfigSource } from "@maleo/shared/provider-config";
import { setTextProviderSelectionReader } from "../../lib/text-runner.ts";
/* The chat route's context boundary.
 *
 * Three things are checked here rather than in the compiler's own tests, because
 * they are properties of the REQUEST rather than of the compiling: a legacy
 * client still works, an envelope reaches the run frozen, and an envelope naming
 * someone else's project is refused outright instead of quietly rewritten.
 *
 * A recording run host stands in for the durable one, so no server is needed. */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { registerGenerationRoutes } from "./generation.ts";
import { closeMaleoDb } from "@maleo/db/connection";
import { createContentProject } from "@maleo/db/project-detail";
import { clearWorkflowRunsForTests } from "@maleo/db/workflow-run-db";
import { clearAgentJobsForTests } from "../../modules/agents/core/session-store.ts";
import { loadRun } from "../../modules/agents/core/run-repository.ts";
import { EMPTY_CHAT_PROJECT_INDEX, EMPTY_CONVERSATION_MEMORY } from "@maleo/shared";
import { setRunHostForTests } from "../../modules/agents/core/runtime/durable.ts";

const tmpDir = mkdtempSync(join(tmpdir(), "gen-context-"));
process.env.MALEO_DB_PATH = join(tmpDir, "test.db");

/** The runs that reached the host. */
const sent: string[] = [];
const host = {
	start: async (job: { id: string }) => {
		sent.push(job.id);
	},
	resume: async () => {},
};

function app(): Hono {
	const a = new Hono();
	registerGenerationRoutes(a);
	return a;
}

async function post(projectId: string, body: Record<string, unknown>): Promise<Response> {
	return app().request(`/projects/${projectId}/chat`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ instruction: "make it punchier", content_type: "video", ...body }),
	});
}

function envelope(projectId: string, overrides: Record<string, unknown> = {}) {
	return {
		projectId,
		capturedAt: 1_700_000_000_000,
		index: EMPTY_CHAT_PROJECT_INDEX,
		focus: { source: "selection", entities: [{ kind: "clip", id: "scene:1" }] },
		memory: EMPTY_CONVERSATION_MEMORY,
		fingerprints: [{ kind: "clip", id: "scene:1", hash: "deadbeefdeadbeef" }],
		...overrides,
	};
}

beforeEach(async () => {
	setConfigSource({
		resolve: (key) =>
			(
				({
					MALEO_AI_API_KEY: "fixture-key",
					MALEO_AI_API_BASE_URL: "http://127.0.0.1:1/v1",
					MALEO_AI_API_MODELS: "fixture-model",
				}) as Record<string, string>
			)[key],
	});
	setTextProviderSelectionReader(() => ({
		default: { providerId: "api", model: "fixture-model" },
	}));
	sent.length = 0;
	setRunHostForTests(host);
	await clearWorkflowRunsForTests();
	clearAgentJobsForTests();
});
afterEach(() => {
	setRunHostForTests(undefined);
	setConfigSource(null);
	setTextProviderSelectionReader(() => ({}));
});
afterAll(async () => {
	await closeMaleoDb();
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("envelope requests", () => {
	test("the envelope is frozen onto the run", async () => {
		const pid = (await createContentProject({ title: "t", type: "video" })).project.id;
		const res = await post(pid, { envelope: envelope(pid) });
		expect(res.status).toBe(202);

		const { jobId } = (await res.json()) as { jobId: string };
		const stored = await loadRun(jobId);
		expect(stored?.context?.focus.source).toBe("selection");
		expect(stored?.context?.focus.entities).toEqual([{ kind: "clip", id: "scene:1" }]);
		expect(stored?.context?.fingerprints).toHaveLength(1);

		const pollResponse = await app().request(`/projects/${pid}/chat/${jobId}`);
		const polled = (await pollResponse.json()) as { context?: { fingerprints: unknown[] } };
		expect(polled.context?.fingerprints).toHaveLength(1);
		const reattachResponse = await app().request(`/projects/${pid}/chat`);
		const reattached = (await reattachResponse.json()) as {
			context?: { focus: { source: string } };
		};
		expect(reattached.context?.focus.source).toBe("selection");
	});

	test("a malformed envelope still runs, with whole-project context", async () => {
		// Degrading to the whole project is right: the user asked for something, and
		// refusing the command over a context defect they cannot see would be worse
		// than answering it with less context.
		const pid = (await createContentProject({ title: "t", type: "video" })).project.id;
		const res = await post(pid, {
			envelope: envelope(pid, { focus: { source: "guess", entities: [] } }),
		});
		expect(res.status).toBe(202);

		const { jobId } = (await res.json()) as { jobId: string };
		expect((await loadRun(jobId))?.context?.focus.source).toBe("project");
	});

	test("an envelope naming another project is refused, and nothing runs", async () => {
		const mine = (await createContentProject({ title: "mine", type: "video" })).project.id;
		const theirs = (await createContentProject({ title: "theirs", type: "video" })).project.id;

		const res = await post(mine, { envelope: envelope(theirs) });
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: "envelope_project_mismatch" });
		// The important half: no run was started against the wrong project.
		expect(sent).toHaveLength(0);
	});
});

describe("legacy requests", () => {
	test("a request with no envelope still runs", async () => {
		const pid = (await createContentProject({ title: "t", type: "video" })).project.id;
		const res = await post(pid, {});
		expect(res.status).toBe(202);
		for (let i = 0; i < 200 && !sent.length; i++) await Bun.sleep(5);
		expect(sent).toHaveLength(1);
	});

	test("it is given whole-project context rather than none at all", async () => {
		const pid = (await createContentProject({ title: "t", type: "video" })).project.id;
		const { jobId } = (await post(pid, {}).then((r) => r.json())) as { jobId: string };
		const stored = await loadRun(jobId);
		expect(stored?.context?.focus.source).toBe("project");
		expect(stored?.context?.projectId).toBe(pid);
	});

	test("legacy loose fields are still accepted alongside", async () => {
		const pid = (await createContentProject({ title: "t", type: "video" })).project.id;
		const res = await post(pid, { brief: "a short video", aspect: "9:16", scenes: [] });
		expect(res.status).toBe(202);
	});
});
