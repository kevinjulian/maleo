/* adopt-mastra-internal-agent 2.10: a generation keeps one identity across retries.
 *
 * A durable step re-entered after its process died runs its generations again in
 * the same scope. The retry polls the job the dead attempt submitted rather than
 * submitting another, and the workspace is charged once. A worker failure gives
 * the key up, so the retry generates again and is still charged once. */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { MediaClient } from "@maleo/media/api";
import { putMedia } from "@maleo/storage";
import { closeMaleoDb, openDb } from "@maleo/db/connection";
import { grantCredits } from "../credit-service.ts";
import { setMediaClientForTests } from "../image-gen-client.ts";
import { generatePromptImage } from "../../modules/agents/core/visual-gen.ts";
import { savedVideoRun } from "../../modules/agents/core/runtime/__tests__/support/video-fixture.ts";
import { loadRun } from "../../modules/agents/core/run-repository.ts";
import { clearAgentJobsForTests } from "../../modules/agents/core/session-store.ts";
import { runValidatedTool } from "../../modules/agents/core/tool-executor.ts";
import { withGenerationScope } from "./generation-scope.ts";

const WORKSPACE = "default";

type MediaJob = Awaited<ReturnType<MediaClient["poll"]>>;
const priorEnforce = process.env.MALEO_CREDITS_ENFORCE;
const priorBackend = process.env.MALEO_MEDIA_STORAGE_BACKEND;
const priorWorker = process.env.MALEO_GEN_WORKER_URL;

/** A media worker whose jobs answer what the test says, and that counts submits. */
function worker() {
	const submitted: string[] = [];
	const answers = new Map<string, () => Promise<Partial<MediaJob>>>();
	let stored: MediaJob["stored"] = null;
	const job = (id: string, over: Partial<MediaJob>): MediaJob => ({
		id,
		kind: "image",
		status: "queued",
		imageUrl: null,
		audioUrl: null,
		stored: null,
		fromCache: false,
		providerId: "test",
		providerSource: "default",
		model: null,
		cost: null,
		latencyMs: null,
		error: null,
		...over,
	});
	const client: MediaClient = {
		async submitImage() {
			const id = `job-${submitted.length + 1}`;
			submitted.push(id);
			return id;
		},
		async submitVideo() {
			throw new Error("unused");
		},
		async videoReadiness() {
			return {};
		},
		async submitTts() {
			throw new Error("unused");
		},
		async poll(id) {
			return job(id, await (answers.get(id) ?? (async () => ({ status: "processing" })))());
		},
		async download() {
			throw new Error("unused");
		},
		fileUrl(path) {
			return path;
		},
	};
	return {
		client,
		submitted,
		/** The next poll of `id` answers this. */
		answer: (id: string, next: () => Promise<Partial<MediaJob>>) => answers.set(id, next),
		done: async () => {
			stored ??= await (async () => {
				const put = await putMedia({
					workspace: WORKSPACE,
					kind: "image",
					body: new Blob(["png"]),
					contentType: "image/png",
				});
				return { key: put.key, hash: put.hash, size: put.size, contentType: put.contentType };
			})();
			return { status: "done" as const, stored };
		},
	};
}

/** A promise that never settles: the process running this attempt died. */
const dies = () => new Promise<never>(() => {});

async function ledgerRows() {
	return await openDb().all<{ status: string; job_id: string | null }>(
		"SELECT status, job_id FROM image_ledger ORDER BY created_at",
	);
}
async function captures() {
	return (
		await openDb().all<{ id: string }>("SELECT id FROM credit_transactions WHERE type = 'capture'")
	).length;
}

const generate = () =>
	generatePromptImage("a jar of sourdough starter", "1:1", [], {
		workspace: WORKSPACE,
		projectId: null,
	});

beforeEach(async () => {
	process.env.MALEO_CREDITS_ENFORCE = "1";
	process.env.MALEO_MEDIA_STORAGE_BACKEND = "local";
	process.env.MALEO_GEN_WORKER_URL = "http://media-worker.test";
	await grantCredits({
		scopeType: "workspace",
		scopeId: WORKSPACE,
		credits: 1000,
		idempotencyKey: `grant-${Date.now()}-${Math.random()}`,
	});
});
afterEach(async () => {
	setMediaClientForTests(undefined);
	if (priorEnforce === undefined) delete process.env.MALEO_CREDITS_ENFORCE;
	else process.env.MALEO_CREDITS_ENFORCE = priorEnforce;
	if (priorBackend === undefined) delete process.env.MALEO_MEDIA_STORAGE_BACKEND;
	else process.env.MALEO_MEDIA_STORAGE_BACKEND = priorBackend;
	if (priorWorker === undefined) delete process.env.MALEO_GEN_WORKER_URL;
	else process.env.MALEO_GEN_WORKER_URL = priorWorker;
	await closeMaleoDb();
});
afterAll(async () => {
	await closeMaleoDb();
});

describe("a generation retried in its scope", () => {
	test("success: one job, one charge", async () => {
		const media = worker();
		setMediaClientForTests(media.client);
		media.answer("job-1", media.done);
		const url = await withGenerationScope("run-1:tool:call-1", generate);
		expect(url).toMatch(/^\/api\/media\//);
		expect(media.submitted).toEqual(["job-1"]);
		expect(await ledgerRows()).toEqual([{ status: "completed", job_id: "job-1" }]);
		expect(await captures()).toBe(1);
	});

	for (const state of ["queued", "processing"] as const) {
		test(`a crash while the job is ${state}: the retry polls the same job, and the workspace is charged once`, async () => {
			const media = worker();
			setMediaClientForTests(media.client);
			let polls = 0;
			media.answer("job-1", async () => (++polls === 1 ? { status: state } : dies()));
			void withGenerationScope("run-1:tool:call-1", generate);
			while (polls < 2) await Bun.sleep(20);

			// The durable host re-enters the step in a new process.
			media.answer("job-1", media.done);
			await withGenerationScope("run-1:tool:call-1", generate);
			expect(media.submitted).toEqual(["job-1"]);
			expect(await ledgerRows()).toEqual([{ status: "completed", job_id: "job-1" }]);
			expect(await captures()).toBe(1);
		}, 15_000);
	}

	test("a worker failure releases the charge; the retry generates again and is charged once", async () => {
		const media = worker();
		setMediaClientForTests(media.client);
		media.answer("job-1", async () => ({ status: "failed", error: "provider refused" }));
		await expect(withGenerationScope("run-1:tool:call-1", generate)).rejects.toThrow(
			"provider refused",
		);
		expect(await captures()).toBe(0);

		media.answer("job-2", media.done);
		await withGenerationScope("run-1:tool:call-1", generate);
		expect(media.submitted).toEqual(["job-1", "job-2"]);
		expect(await ledgerRows()).toEqual([
			{ status: "failed", job_id: "job-1" },
			{ status: "completed", job_id: "job-2" },
		]);
		expect(await captures()).toBe(1);
	}, 15_000);

	test("the same generation in another scope is new work", async () => {
		const media = worker();
		setMediaClientForTests(media.client);
		media.answer("job-1", media.done);
		media.answer("job-2", media.done);
		await withGenerationScope("run-1:tool:call-1", generate);
		await withGenerationScope("run-1:tool:call-2", generate);
		expect(media.submitted).toEqual(["job-1", "job-2"]);
		expect(await captures()).toBe(2);
	}, 15_000);

	test("an agent tool re-entered for the same call after a crash resumes its job instead of being refused", async () => {
		const media = worker();
		setMediaClientForTests(media.client);
		const job = await savedVideoRun("Identity");
		let polls = 0;
		media.answer("job-1", async () => (++polls === 1 ? { status: "processing" } : dies()));
		void withGenerationScope(`${job.id}:tool:call-1`, () =>
			runValidatedTool(job, "generate_frame", { index: 0 }, "trace-1"),
		);
		while (polls < 2) await Bun.sleep(20);

		clearAgentJobsForTests();
		media.answer("job-1", media.done);
		const retried = (await loadRun(job.id))!;
		await withGenerationScope(`${job.id}:tool:call-1`, () =>
			runValidatedTool(retried, "generate_frame", { index: 0 }, "trace-2"),
		);
		expect(media.submitted).toEqual(["job-1"]);
		expect((await loadRun(job.id))!.scenes[0]?.image).toMatch(/^\/api\/media\//);
		expect(await captures()).toBe(1);
	}, 15_000);
});
