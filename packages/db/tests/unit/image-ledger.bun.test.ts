/* The image ledger, which replaced prompt_library.
 *
 * prompt_library was UNIQUE(workspace, prompt) with image_url merged on conflict,
 * so a regenerated prompt overwrote its own previous image and the second
 * generation was unrepresentable. It carried no project_id, and only one of four
 * producers wrote to it. Both properties are asserted here directly, because both
 * are the reason it went.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { openTestDb, type TestDb } from "../../src/db/handle-testing.ts";
import type { Db } from "../../src/db/handle.ts";
import {
	attachJobId,
	countImages,
	findByJobId,
	listImages,
	openGeneration,
	promptUseCount,
	resolveCompleted,
	resolveSpeechCompleted,
	listSpeech,
	listAttempts,
	countSpeech,
	speechFacets,
	resolveFailed,
	imageFacets,
	softDeleteImage,
	toggleStar,
} from "../../src/db/image-ledger.ts";

let db: Db;
let t: TestDb;

const gen = async (over: Partial<Parameters<typeof openGeneration>[0]> = {}): Promise<string> =>
	await openGeneration({ workspace: "acme", source: "lab", prompt: "a red coat", ...over }, db);

const complete = async (id: string, url: string): Promise<void> => {
	await resolveCompleted(id, url, db);
};

beforeEach(async () => {
	t = await openTestDb("postgres");
	db = t.db;
});
afterEach(() => t.close());

describe("one row per image, never per prompt", () => {
	it("keeps both images when a prompt is regenerated", async () => {
		await complete(await gen(), "/img/1.png");
		await complete(await gen(), "/img/2.png");

		const rows = await listImages({ workspace: "acme" }, db);
		expect(rows).toHaveLength(2);
		expect(rows.map((r) => r.asset_url).sort((a, b) => (a ?? "").localeCompare(b ?? ""))).toEqual([
			"/img/1.png",
			"/img/2.png",
		]);
	});

	it("derives prompt reuse from completed rows only", async () => {
		await complete(await gen(), "/img/1.png");
		await complete(await gen(), "/img/2.png");
		await resolveFailed(await gen(), db);

		expect(await promptUseCount("acme", "a red coat", db)).toBe(2);
	});
});

describe("lifecycle", () => {
	it("does not present a pending attempt as an image", async () => {
		await gen();
		expect(await listImages({}, db)).toHaveLength(0);
	});

	it("does not present a failed attempt as an image", async () => {
		await resolveFailed(await gen(), db);
		expect(await listImages({}, db)).toHaveLength(0);
	});

	it("resolves a completed attempt exactly once", async () => {
		const id = await gen();
		expect(await resolveCompleted(id, "/img/1.png", db)).toBe(true);
		// The doubly-polled completion. Previously guarded by an in-memory Set that a
		// restart discarded.
		expect(await resolveCompleted(id, "/img/other.png", db)).toBe(false);

		const rows = await listImages({}, db);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.asset_url).toBe("/img/1.png");
	});

	it("cannot fail an attempt that already completed", async () => {
		const id = await gen();
		await complete(id, "/img/1.png");
		expect(await resolveFailed(id, db)).toBe(false);
		expect(await listImages({}, db)).toHaveLength(1);
	});

	it("keeps an unresolved attempt identifiable rather than dropping it", async () => {
		const id = await gen({ jobId: "job-1" });
		const row = await findByJobId("job-1", db);
		expect(row?.id).toBe(id);
		expect(row?.status).toBe("pending");
	});

	it("attaches a job id discovered after submit", async () => {
		const id = await gen();
		await attachJobId(id, "job-late", db);
		expect((await findByJobId("job-late", db))?.id).toBe(id);
	});
});

describe("attribution", () => {
	it("carries the project for a clip generation", async () => {
		await complete(await gen({ source: "clip", projectId: "p1" }), "/img/clip.png");
		const [row] = await listImages({ projectId: "p1" }, db);
		expect(row?.source).toBe("clip");
		expect(row?.workspace).toBe("acme");
	});

	it("treats an absent project as no project, not as unknown", async () => {
		await complete(await gen({ source: "lab" }), "/img/lab.png");
		await complete(await gen({ source: "clip", projectId: "p1" }), "/img/clip.png");

		expect((await listImages({ projectId: null }, db)).map((r) => r.asset_url)).toEqual([
			"/img/lab.png",
		]);
		expect((await listImages({ projectId: "p1" }, db)).map((r) => r.asset_url)).toEqual([
			"/img/clip.png",
		]);
	});

	it("filters by producing source", async () => {
		await complete(await gen({ source: "lab" }), "/img/lab.png");
		await complete(await gen({ source: "agent", projectId: "p1" }), "/img/agent.png");
		await complete(await gen({ source: "reference" }), "/img/ref.png");

		expect(await listImages({ source: "agent" }, db)).toHaveLength(1);
		expect(await listImages({ source: "reference" }, db)).toHaveLength(1);
		expect(await listImages({}, db)).toHaveLength(3);
	});

	it("scopes to a workspace", async () => {
		await complete(await gen({ workspace: "acme" }), "/img/a.png");
		await complete(await gen({ workspace: "other" }), "/img/b.png");
		expect((await listImages({ workspace: "other" }, db)).map((r) => r.asset_url)).toEqual([
			"/img/b.png",
		]);
	});
});

describe("delete hides, it does not erase", () => {
	it("removes the image from reads while keeping the record", async () => {
		const id = await gen({ source: "clip", projectId: "p1" });
		await complete(id, "/img/clip.png");

		expect(await softDeleteImage(id, db)).toBe(true);
		expect(await listImages({}, db)).toHaveLength(0);
		expect(await countImages({}, db)).toBe(0);

		// The generation was billed. Its record must survive the tidy-up.
		const row = await db.get<{ workspace: string; project_id: string; status: string }>(
			`SELECT * FROM image_ledger WHERE id = ?`,
			[id],
		);
		expect(row?.workspace).toBe("acme");
		expect(row?.project_id).toBe("p1");
		expect(row?.status).toBe("completed");
	});

	it("is idempotent", async () => {
		const id = await gen();
		await complete(id, "/img/1.png");
		expect(await softDeleteImage(id, db)).toBe(true);
		expect(await softDeleteImage(id, db)).toBe(false);
	});
});

describe("star is per image", () => {
	it("marks one of several images from the same prompt", async () => {
		const first = await gen();
		const second = await gen();
		await complete(first, "/img/1.png");
		await complete(second, "/img/2.png");

		expect(await toggleStar(first, db)).toBe(true);

		const rows = await listImages({}, db);
		expect(rows.find((r) => r.id === first)?.starred).toBe(1);
		expect(rows.find((r) => r.id === second)?.starred).toBe(0);
	});

	it("toggles back off", async () => {
		const id = await gen();
		await complete(id, "/img/1.png");
		await toggleStar(id, db);
		await toggleStar(id, db);
		expect((await listImages({}, db))[0]?.starred).toBe(0);
	});
});

describe("paging", () => {
	it("returns newest first and pages without repeating a row", async () => {
		for (let i = 0; i < 5; i++) {
			await complete(await gen({ createdAt: 1000 + i }), `/img/${i}.png`);
		}
		const page1 = await listImages({ limit: 2 }, db);
		const page2 = await listImages({ limit: 2, offset: 2 }, db);

		expect(page1.map((r) => r.asset_url)).toEqual(["/img/4.png", "/img/3.png"]);
		expect(page2.map((r) => r.asset_url)).toEqual(["/img/2.png", "/img/1.png"]);
		expect(await countImages({}, db)).toBe(5);
	});
});

describe("filter options", () => {
	async function seedProject(id: string, workspace: string, title: string): Promise<void> {
		await db.run(
			`INSERT INTO content_projects (id, workspace, title, type, status, created_at, updated_at)
			 VALUES (?, ?, ?, 'video', 'draft', 1000, 1000)`,
			[id, workspace, title],
		);
	}

	it("offers only projects that actually have images", async () => {
		await seedProject("p1", "acme", "Spring spot");
		await seedProject("p2", "acme", "Never generated");
		await complete(await gen({ workspace: "acme", projectId: "p1", source: "clip" }), "/img/1.png");
		await complete(await gen({ workspace: "other", source: "lab" }), "/img/2.png");

		const facets = await imageFacets(undefined, db);

		// p2 has no images, so it is not a useful choice.
		expect(facets.projects).toEqual([{ id: "p1", title: "Spring spot" }]);
	});

	/* There is no `workspaces` facet any more. The gallery shows the ACTIVE
	   workspace and offers no control to leave it, so a list of the others was
	   only ever the raw material for a filter that no longer exists. */
	it("offers no workspace facet", async () => {
		await complete(await gen({ workspace: "acme", source: "lab" }), "/img/1.png");

		expect(await imageFacets(undefined, db)).toEqual({ projects: [], sources: ["lab"] });
	});

	/* An unscoped facet offers another tenant's project TITLES in the dropdown —
	   a disclosure that survives every filter applied afterwards, because picking
	   one just returns nothing. */
	it("scopes its projects to one workspace when given one", async () => {
		await seedProject("mine", "acme", "Spring spot");
		await seedProject("theirs", "other", "Their secret campaign");
		await complete(
			await gen({ workspace: "acme", projectId: "mine", source: "clip" }),
			"/img/1.png",
		);
		await complete(
			await gen({ workspace: "other", projectId: "theirs", source: "clip" }),
			"/img/2.png",
		);

		expect((await imageFacets("acme", db)).projects).toEqual([
			{ id: "mine", title: "Spring spot" },
		]);
	});

	it("ignores hidden and unresolved images", async () => {
		await seedProject("p1", "acme", "Spring spot");
		const hidden = await gen({ workspace: "acme", projectId: "p1", source: "clip" });
		await complete(hidden, "/img/1.png");
		await softDeleteImage(hidden, db);
		await gen({ workspace: "pending-only", source: "lab" });

		expect((await imageFacets(undefined, db)).projects).toEqual([]);
	});
});

/* The ledger records more than images now, and the medium predicate lives inside
   the module rather than at each call site. These assert the leak that a
   forgotten WHERE would cause — which is not a type error anywhere, so nothing
   else would catch it. */
describe("media are scoped, and cannot leak into each other", () => {
	const speech = async (
		over: Partial<Parameters<typeof openGeneration>[0]> = {},
	): Promise<string> =>
		await openGeneration(
			{
				workspace: "acme",
				medium: "speech",
				source: "lab",
				prompt: "hello there",
				voice: "af_heart",
				provider: "kokoro",
				...over,
			},
			db,
		);

	beforeEach(async () => {
		await complete(await gen({ prompt: "a red coat" }), "/img/coat.png");
		await resolveSpeechCompleted(await speech(), "/uploads/hello.mp3", 2.5, db);
	});

	it("lists only images for an image read", async () => {
		const rows = await listImages({ workspace: "acme" }, db);

		expect(rows.map((r) => r.asset_url)).toEqual(["/img/coat.png"]);
		expect(rows.every((r) => r.medium === "image")).toBe(true);
	});

	it("lists only speech for a speech read", async () => {
		const rows = await listSpeech({ workspace: "acme" }, db);

		expect(rows.map((r) => r.asset_url)).toEqual(["/uploads/hello.mp3"]);
		expect(rows.every((r) => r.medium === "speech")).toBe(true);
	});

	it("counts each medium apart", async () => {
		expect(await countImages({ workspace: "acme" }, db)).toBe(1);
		expect(await countSpeech({ workspace: "acme" }, db)).toBe(1);
	});

	/* A facet list is what populates a filter control, so an unscoped one offers
	   the operator a value that returns nothing the moment they pick it. */
	it("offers each medium only its own sources", async () => {
		await complete(await gen({ source: "reference" }), "/img/ref.png");
		await resolveSpeechCompleted(
			await speech({ source: "scene", projectId: null }),
			"/uploads/scene.mp3",
			1,
			db,
		);

		expect((await imageFacets("acme", db)).sources.sort()).toEqual(["lab", "reference"]);
		expect((await speechFacets("acme", db)).sources.sort()).toEqual(["lab", "scene"]);
	});

	/* prompt is shared by both media — an image prompt and a line of narration can
	   be the same words, and the count is of images. */
	it("does not count speech saying the same words as an image prompt", async () => {
		await resolveSpeechCompleted(
			await speech({ prompt: "a red coat" }),
			"/uploads/coat.mp3",
			1,
			db,
		);

		expect(await promptUseCount("acme", "a red coat", db)).toBe(1);
	});
});

/* Speech is synchronous, but the attempt still has a lifecycle: metering happens
   before the response is written, so a single write-on-success would let billed
   spend leave no artifact row at all. */
describe("a speech attempt is recorded before it is attempted", () => {
	it("carries voice, provider and duration once resolved", async () => {
		const id = await openGeneration(
			{
				workspace: "acme",
				medium: "speech",
				source: "lab",
				prompt: "hello",
				voice: "F1",
				provider: "canvas",
			},
			db,
		);

		expect(await listSpeech({ workspace: "acme" }, db)).toEqual([]); // pending is not an artifact

		await resolveSpeechCompleted(id, "/uploads/hello.mp3", 3.25, db);
		const row = (await listSpeech({ workspace: "acme" }, db))[0];

		expect(row?.voice).toBe("F1");
		expect(row?.provider).toBe("canvas");
		expect(row?.duration_sec).toBe(3.25);
	});

	it("leaves a failed attempt out of the gallery but in the ledger", async () => {
		const id = await openGeneration(
			{ workspace: "acme", medium: "speech", source: "lab", prompt: "hello" },
			db,
		);

		await resolveFailed(id, db);

		expect(await listSpeech({ workspace: "acme" }, db)).toEqual([]);
		expect(
			(await listAttempts({ workspace: "acme", status: "failed" }, db)).map((r) => r.id),
		).toEqual([id]);
	});

	it("gives a speech row an id that names its medium", async () => {
		const id = await openGeneration({ workspace: "acme", medium: "speech", source: "lab" }, db);

		expect(id.startsWith("spk-")).toBe(true);
	});
});
