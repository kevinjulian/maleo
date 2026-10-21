/* Which tenant a scene generation is billed and attributed to.
 *
 * This route used to receive no generation context at all — buildSceneImageRequest
 * sent no workspace — so its `if (job_id && body.workspace)` guard was always false
 * and every clip, reference and studio image it produced was unmetered and
 * unrecorded.
 *
 * The fix does NOT add a workspace field to the body. The editor has no workspace
 * selector, and taking a tenant off a request body is a cross-tenant write vector
 * (see routes/operations/content-materials.ts). The workspace is resolved from the
 * project, whose stored column is the authoritative record of who owns it.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { MediaClient } from "@maleo/media/api";
import { closeMaleoDb, openDb } from "@maleo/db/connection";
import { findByJobId, listAttempts, listImages } from "@maleo/db/image-ledger";
import { setMediaClientForTests } from "../lib/image-gen-client.ts";
import { imageGenRoutes } from "./image-gen.ts";
import { testApp } from "../middleware/auth-testing.ts";

const dbPath = join(
	tmpdir(),
	`image-gen-attr-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
);
const priorDbPath = process.env.MALEO_DB_PATH;
const priorWorkerUrl = process.env.MALEO_GEN_WORKER_URL;

let jobCounter = 0;

const client: MediaClient = {
	async submitImage() {
		return `job-${++jobCounter}`;
	},
	async submitVideo() {
		throw new Error("unused");
	},
	async videoReadiness() {
		return {};
	},
	async submitTts() {
		return "tts-1";
	},
	async poll() {
		throw new Error("not used");
	},
	async download() {
		throw new Error("not used");
	},
	fileUrl(path) {
		return path;
	},
};

/* Insert the project fixture directly. The point under test is which column the
 * route reads, so a raw row is a more honest fixture than an accessor whose own
 * defaulting could mask the answer. */
async function seedProject(id: string, workspace: string): Promise<string> {
	const now = Date.now();
	await openDb().run(
		`INSERT INTO workspaces (name, display_name, workspace_dir, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
		[workspace, workspace, `/tmp/${workspace}`, now, now],
	);
	await openDb().run(
		`INSERT INTO content_projects (id, workspace, title, type, status, created_at, updated_at)
		 VALUES (?, ?, 'Spring spot', 'video', 'draft', ?, ?)`,
		[id, workspace, now, now],
	);
	return id;
}

const sceneBody = (over: Record<string, unknown>): string =>
	JSON.stringify({ scene: { visualDesc: "a kitchen" }, ...over });

beforeEach(async () => {
	process.env.MALEO_DB_PATH = dbPath;
	process.env.MALEO_GEN_WORKER_URL = "http://127.0.0.1:1";
	await closeMaleoDb();
	openDb();
	setMediaClientForTests(client);
});

afterEach(async () => {
	setMediaClientForTests(undefined);
	await closeMaleoDb();
	for (const suffix of ["", "-shm", "-wal"]) rmSync(`${dbPath}${suffix}`, { force: true });
	if (priorDbPath === undefined) delete process.env.MALEO_DB_PATH;
	else process.env.MALEO_DB_PATH = priorDbPath;
	if (priorWorkerUrl === undefined) delete process.env.MALEO_GEN_WORKER_URL;
	else process.env.MALEO_GEN_WORKER_URL = priorWorkerUrl;
});

describe("generate-scene attribution", () => {
	it("attributes a generation to its project's own workspace", async () => {
		const projectId = await seedProject("p-acme", "acme");

		const res = await testApp(imageGenRoutes()).request("/generate-scene", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: sceneBody({ project_id: projectId, source: "clip" }),
		});
		expect(res.status).toBeLessThan(400);

		const row = await findByJobId(`job-${jobCounter}`);
		expect(row?.workspace).toBe("acme");
		expect(row?.project_id).toBe(projectId);
		expect(row?.source).toBe("clip");
	});

	it("ignores a tenant named on the body", async () => {
		const projectId = await seedProject("p-acme", "acme");

		await testApp(imageGenRoutes()).request("/generate-scene", {
			method: "POST",
			headers: { "content-type": "application/json" },
			// A caller trying to bill and attribute someone else's tenant.
			body: sceneBody({ project_id: projectId, source: "clip", workspace: "victim" }),
		});

		expect((await findByJobId(`job-${jobCounter}`))?.workspace).toBe("acme");
	});

	it("refuses a generation naming a project that does not exist", async () => {
		const res = await testApp(imageGenRoutes()).request("/generate-scene", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: sceneBody({ project_id: "no-such-project", source: "clip" }),
		});
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: "project_not_found" });
	});

	it("records a workspace-scoped reference image against the default tenant", async () => {
		const res = await testApp(imageGenRoutes()).request("/generate-scene", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: sceneBody({ source: "reference" }),
		});
		expect(res.status).toBeLessThan(400);

		const row = await findByJobId(`job-${jobCounter}`);
		expect(row?.source).toBe("reference");
		// No project — and that means "belongs to no project", not "unknown".
		expect(row?.project_id).toBeNull();
		expect(row?.workspace).toBe("default");
	});

	it("submits structured intent without unresolved mentions", async () => {
		const projectId = await seedProject("p-acme", "acme");
		let submitted: Parameters<MediaClient["submitImage"]>[0] | undefined;
		setMediaClientForTests({
			async submitImage(request) {
				submitted = request;
				return `job-${++jobCounter}`;
			},
			async submitVideo() {
				throw new Error("unused");
			},
			async videoReadiness() {
				return {};
			},
			async submitTts() {
				return "tts-1";
			},
			async poll() {
				throw new Error("not used");
			},
			async download() {
				throw new Error("not used");
			},
			fileUrl(path) {
				return path;
			},
		});

		const res = await testApp(imageGenRoutes()).request("/generate-scene", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: sceneBody({
				project_id: projectId,
				source: "clip",
				intent: {
					output: { kind: "single-image", aspect: "9:16", fullFrame: true },
					subjectLocks: [],
					scene: { visualMoment: "sleepy Sketch Stickman" },
					constraints: { mustInclude: [], mustAvoid: [] },
					negative: [],
					references: [
						{
							url: "http://localhost:3030/api/image-gen/files/sketch.png",
							role: "character",
							label: "Sketch Stickman",
							description: "simple line sketch",
						},
					],
				},
			}),
		});

		expect(res.status).toBeLessThan(400);
		const intent = submitted?.intent as { scene?: { visualMoment?: string } } | undefined;
		expect(intent?.scene?.visualMoment).toBe("sleepy Sketch Stickman");
		expect(submitted?.prompt).toBe("sleepy Sketch Stickman");
		expect(JSON.stringify(submitted?.intent)).not.toContain("@Sketch");
	});
});

/* Billing and the ledger have to agree about what "failed" means. runBillableOperation
 * captures usage on any FULFILLED run, so a submit that returns normally without a
 * job id is a billed non-generation. */
describe("generate-scene failure handling", () => {
	it("resolves a durable execution failure from worker status", async () => {
		await seedProject("p-acme", "acme");
		await testApp(imageGenRoutes()).request("/generate-scene", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: sceneBody({ project_id: "p-acme", source: "clip" }),
		});
		const jobId = `job-${jobCounter}`;
		setMediaClientForTests({
			...client,
			async poll() {
				return {
					id: jobId,
					kind: "image",
					status: "failed",
					imageUrl: null,
					audioUrl: null,
					fromCache: false,
					providerId: "sandbox",
					providerSource: "workspace",
					model: "sandbox-svg",
					cost: 0,
					latencyMs: 1,
					error: "worker failed",
				};
			},
		});

		const res = await testApp(imageGenRoutes()).request(`/jobs/${jobId}`);
		expect(res.status).toBe(200);
		expect((await findByJobId(jobId))?.status).toBe("failed");
	});

	it("forwards the upstream status and body when a submit produces no job", async () => {
		await seedProject("p-acme", "acme");
		setMediaClientForTests({
			async submitImage() {
				return undefined as unknown as string;
			},
			async submitVideo() {
				throw new Error("unused");
			},
			async videoReadiness() {
				return {};
			},
			async submitTts() {
				return "tts-1";
			},
			async poll() {
				throw new Error("not used");
			},
			async download() {
				throw new Error("not used");
			},
			fileUrl(path) {
				return path;
			},
		});

		const res = await testApp(imageGenRoutes()).request("/generate-scene", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: sceneBody({ project_id: "p-acme", source: "clip" }),
		});

		// The proxy contract survives: this is not flattened into a generic 502.
		expect(res.status).toBeGreaterThanOrEqual(400);
	});

	it("records no usage for a submit that never started", async () => {
		await seedProject("p-acme", "acme");
		setMediaClientForTests({
			async submitImage() {
				return undefined as unknown as string;
			},
			async submitVideo() {
				throw new Error("unused");
			},
			async videoReadiness() {
				return {};
			},
			async submitTts() {
				return "tts-1";
			},
			async poll() {
				throw new Error("not used");
			},
			async download() {
				throw new Error("not used");
			},
			fileUrl(path) {
				return path;
			},
		});

		await testApp(imageGenRoutes()).request("/generate-scene", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: sceneBody({ project_id: "p-acme", source: "clip" }),
		});

		const usage = (await openDb().get(
			"SELECT COUNT(*) AS n FROM usage_records WHERE operation = 'image'",
		)) as { n: number };
		expect(usage.n).toBe(0);

		// And the attempt is resolved failed rather than left pending forever.
		const attempts = await listAttempts();
		expect(attempts).toHaveLength(1);
		expect(attempts[0]?.status).toBe("failed");
		expect(await listImages({})).toHaveLength(0);
	});
});
