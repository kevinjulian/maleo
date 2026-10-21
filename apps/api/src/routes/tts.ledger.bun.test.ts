/* Speech synthesis is recorded, and it is recorded as an ATTEMPT.
 *
 * The route returns the clip in the same response — there is no job queue and
 * nothing to poll. That is deliberate, and it is also why the ledger lifecycle
 * matters here rather than being redundant: `meter()` records the spend inside
 * `synthesizeBilledTts`, BEFORE this handler writes its response. A single
 * write-on-success would let a process that dies mid-request leave billed spend
 * with no artifact row at all — invisible rather than merely failed.
 *
 * The workspace is resolved from the project, never from the body, for the same
 * reason as the scene-image route: content_projects.workspace is the record of
 * who owns the project, and a body field would let a caller pick a tenant by
 * sending different JSON.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeMaleoDb, openDb } from "@maleo/db/connection";
import { listAttempts, listSpeech } from "@maleo/db/image-ledger";
import { listUsageRecords } from "../lib/credit-service.ts";
import { setTtsSynthesizerForTests } from "../lib/tts-synth.ts";
import { ttsRoutes, MAX_SYNTHESIS_CHARS } from "./tts.ts";
import { testApp } from "../middleware/auth-testing.ts";

const dbPath = join(tmpdir(), `tts-ledger-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
const priorDbPath = process.env.MALEO_DB_PATH;

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

async function post(body: Record<string, unknown>): Promise<Response> {
	return await testApp(ttsRoutes()).request("/generate", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

beforeEach(async () => {
	process.env.MALEO_DB_PATH = dbPath;
	await closeMaleoDb();
	openDb();
	setTtsSynthesizerForTests(async () => ({ bytes: new Uint8Array([1, 2, 3]), ext: "mp3" }));
});

afterEach(async () => {
	setTtsSynthesizerForTests(null);
	await closeMaleoDb();
	// The -wal and -shm siblings too: removing only the main file leaves a journal
	// that the next open reads as a corrupt database ("disk I/O error").
	for (const suffix of ["", "-shm", "-wal"]) rmSync(`${dbPath}${suffix}`, { force: true });
	if (priorDbPath === undefined) delete process.env.MALEO_DB_PATH;
	else process.env.MALEO_DB_PATH = priorDbPath;
});

describe("a synthesis is recorded", () => {
	it("records one completed row carrying what was said and how", async () => {
		const res = await post({ text: "hello there", voice: "af_heart", provider: "kokoro" });
		expect(res.status).toBe(200);

		const rows = await listSpeech({});
		expect(rows).toHaveLength(1);
		expect(rows[0]?.prompt).toBe("hello there");
		expect(rows[0]?.voice).toBe("af_heart");
		expect(rows[0]?.provider).toBe("kokoro");
		expect(rows[0]?.asset_url).toMatch(/^\/api\/media\/[0-9a-f-]{36}$/);
		expect(rows[0]?.medium).toBe("speech");
	});

	/* The provider is unreachable or unconfigured. The spend may already have been
	   reserved, so the attempt has to remain visible as a failure. */
	it("resolves a failed attempt without presenting a clip", async () => {
		setTtsSynthesizerForTests(async () => {
			throw new Error("upstream exploded");
		});

		const res = await post({ text: "hello there" });
		expect(res.status).toBe(502);

		expect(await listSpeech({})).toHaveLength(0);
		const failed = await listAttempts({ status: "failed" });
		expect(failed).toHaveLength(1);
		expect(failed[0]?.prompt).toBe("hello there");
	});

	it("does not present an unresolved attempt as a clip", async () => {
		setTtsSynthesizerForTests(async () => {
			throw new Error("upstream exploded");
		});
		await post({ text: "hello there" });

		expect(await listSpeech({})).toHaveLength(0);
	});
});

describe("attribution comes from the project, not the body", () => {
	it("bills a scene synthesis to the project's own tenant", async () => {
		await seedProject("p1", "acme");

		await post({ text: "narration", project_id: "p1", source: "scene" });

		const rows = await listSpeech({});
		expect(rows[0]?.workspace).toBe("acme");
		expect(rows[0]?.project_id).toBe("p1");
		expect(rows[0]?.source).toBe("scene");
	});

	/* The body carries no workspace field at all, which is the point: there is
	   nothing to send that could redirect the row to another tenant. */
	it("ignores a workspace named in the body", async () => {
		await seedProject("p1", "acme");

		await post({ text: "narration", project_id: "p1", workspace: "someone-else" });

		expect((await listSpeech({}))[0]?.workspace).toBe("acme");
	});

	it("refuses a project that does not exist rather than inventing a tenant", async () => {
		const res = await post({ text: "narration", project_id: "ghost" });

		expect(res.status).toBe(400);
		expect(await listAttempts({})).toHaveLength(0);
	});

	it("treats a lab synthesis as belonging to no project", async () => {
		await post({ text: "just trying a voice" });

		const rows = await listSpeech({});
		expect(rows[0]?.project_id).toBeNull();
		expect(rows[0]?.source).toBe("lab");
	});
});

describe("over-long text is refused before it is billed", () => {
	it("names the limit and records nothing", async () => {
		const res = await post({ text: "a".repeat(MAX_SYNTHESIS_CHARS + 1) });

		expect(res.status).toBe(413);
		expect(await res.json()).toMatchObject({ error: "text_too_long", limit: MAX_SYNTHESIS_CHARS });
		// Neither a ledger attempt nor a usage record: the refusal precedes both.
		expect(await listAttempts({})).toHaveLength(0);
		expect((await listUsageRecords()).filter((r) => r.operation === "audio")).toHaveLength(0);
	});

	it("accepts text exactly at the limit", async () => {
		const res = await post({ text: "a".repeat(MAX_SYNTHESIS_CHARS) });

		expect(res.status).toBe(200);
		expect(await listSpeech({})).toHaveLength(1);
	});
});

/* The gallery's reads. Shaped like the image gallery's so the same query behaves
   the same way on both surfaces. */
describe("the speech gallery reads", () => {
	async function seedClips(): Promise<void> {
		await seedProject("p1", "default");
		await post({ text: "narration one", project_id: "p1", source: "scene", voice: "M1" });
		await post({ text: "lab doodle", voice: "F1" });
	}

	it("lists a workspace's clips, newest first", async () => {
		await seedClips();

		const res = await testApp(ttsRoutes()).request("/clips?workspace=default");
		const body = (await res.json()) as {
			items: Array<{ prompt: string; duration_sec: number | null }>;
		};

		expect(res.status).toBe(200);
		expect(body.items.map((i) => i.prompt)).toEqual(["lab doodle", "narration one"]);
	});

	it("filters by source and by project", async () => {
		await seedClips();

		const scene = (await (
			await testApp(ttsRoutes()).request("/clips?workspace=default&source=scene")
		).json()) as { items: unknown[] };
		const noProject = (await (
			await testApp(ttsRoutes()).request("/clips?workspace=default&project=none")
		).json()) as { items: Array<{ prompt: string }> };

		expect(scene.items).toHaveLength(1);
		expect(noProject.items.map((i) => i.prompt)).toEqual(["lab doodle"]);
	});

	/* An image-only source is not a value speech can carry. Treated as absent
	   rather than passed through, so the operator sees the unfiltered list rather
	   than an empty page that reads as "no clips". */
	it("treats an image-only source as no filter", async () => {
		await seedClips();

		const res = (await (
			await testApp(ttsRoutes()).request("/clips?workspace=default&source=reference")
		).json()) as { items: unknown[] };

		expect(res.items).toHaveLength(2);
	});

	it("offers only the sources and projects that exist", async () => {
		await seedClips();

		const facets = (await (
			await testApp(ttsRoutes()).request("/clips/facets?workspace=default")
		).json()) as {
			projects: Array<{ id: string }>;
			sources: string[];
		};

		expect(facets.sources.sort()).toEqual(["lab", "scene"]);
		expect(facets.projects.map((p) => p.id)).toEqual(["p1"]);
	});

	it("stars and hides one clip without erasing its record", async () => {
		await post({ text: "narration one" });
		const id = (await listSpeech({}))[0]!.id;

		expect(
			await (await testApp(ttsRoutes()).request(`/clips/${id}/star`, { method: "POST" })).json(),
		).toEqual({ ok: true });
		expect((await listSpeech({}))[0]?.starred).toBe(1);

		expect(
			await (await testApp(ttsRoutes()).request(`/clips/${id}`, { method: "DELETE" })).json(),
		).toEqual({ ok: true });
		expect(await listSpeech({})).toHaveLength(0);
		// The synthesis was billed. Its record survives the tidy-up.
		expect((await listAttempts({})).map((r) => r.id)).toEqual([id]);
	});

	/* The same refusal the image gallery gives, in the same shape: two spellings of
	   "unknown workspace" is how a client comes to handle one and not the other. */
	it("refuses an unregistered workspace rather than serving an empty gallery", async () => {
		const res = await testApp(ttsRoutes()).request("/clips?workspace=nope");

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: "unknown_workspace", workspace: "nope" });
	});
});
