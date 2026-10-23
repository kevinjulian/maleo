/* Saving a storyboard preserves what the saver does not own.
 *
 * The editor's autosave serializes clips and markers; it has no `artifacts` key
 * because it does not own one. The agent does — a longform plan, a research
 * bundle, a style bible all live there. So an autosave landing between planning
 * and approval must not clear them, or the approve path re-plans instead of
 * generating assets.
 *
 * That used to be a special case in the route: an `if` over an untyped blob
 * re-attaching one hand-named key. It is now the document contract's ordinary
 * mechanism — a writer that lacks a field reads it from the prior document and
 * supplies it. These pin the behaviour either way, because the behaviour is what
 * the user notices. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { toTimelineDoc, readStoryboardDocument, fromTimelineDoc } from "@maleo/shared";
import { closeMaleoDb } from "@maleo/db/connection";
import { createContentProject, getContentProject } from "@maleo/db/project-detail";
import { addContentStoryboard } from "@maleo/db/storyboards";
import { registerStoryboardRoutes } from "./storyboards.ts";
import { registerProjectRoutes } from "./projects.ts";

const dbPath = join(tmpdir(), "maleo-storyboard-save.test.db");
const priorDbPath = process.env.MALEO_DB_PATH;

async function resetDb(): Promise<void> {
	await closeMaleoDb();
	for (const suffix of ["", "-shm", "-wal"]) rmSync(`${dbPath}${suffix}`, { force: true });
}

beforeEach(async () => {
	process.env.MALEO_DB_PATH = dbPath;
	await resetDb();
});
afterEach(async () => {
	await resetDb();
	if (priorDbPath === undefined) process.env.MALEO_DB_PATH = "";
	else process.env.MALEO_DB_PATH = priorDbPath;
});

const json = { "content-type": "application/json" };

function app(): Hono {
	const instance = new Hono();
	registerStoryboardRoutes(instance);
	return instance;
}

/** What the editor's autosave actually posts: clips and markers, no artifacts. */
const autosavePayload = {
	schemaVersion: 2,
	clips: [{ id: "scene:1", type: "image", startSec: 0, durationSec: 5, track: 0, markerId: 1 }],
	markers: [
		{
			id: 1,
			title: "Beat",
			startSec: 0,
			endSec: 5,
			clipIds: ["scene:1"],
			storyBeatId: "beat-opaque",
			sourceRevisionId: "approved-1",
		},
	],
};

async function seedWithPlan(): Promise<string> {
	const id = (await createContentProject({ title: "Planned", type: "video" })).project.id;
	await addContentStoryboard({
		project_id: id,
		source_prompt: null,
		reference_notes: null,
		status: "storyboard",
		storyboard_json: {
			schemaVersion: 2,
			clips: [],
			markers: [],
			artifacts: [
				{
					kind: "story_plan",
					sections: 3,
					generationState: {
						planId: "plan-opaque",
						draft: { revisionId: "draft-2" },
						approvedSnapshot: { revisionId: "approved-1" },
					},
				},
			],
			unit_lifecycle: { planned: true },
		},
	});
	return id;
}

/* The raw persisted payload, NOT the decoded document. These tests assert on the
 * bytes the save emits — which keys are present and, for `artifacts`, which are
 * absent — so they deliberately read around `readStoryboardDocument`, whose whole
 * job is to make an absent key indistinguishable from a defaulted one. */
const latestOf = async (projectId: string): Promise<unknown> => {
	const raw = (await getContentProject(projectId))!.storyboards[0]!.storyboard_json;
	if (!raw || typeof raw !== "object") throw new Error("expected a stored storyboard object");
	return raw;
};
/** One persisted key off the emitted payload, read without naming a dictionary
 *  type for it — the payload has no value contract, which is the whole reason
 *  `readStoryboardDocument` exists. */
const keyOf = async (projectId: string, key: string): Promise<unknown> =>
	Object.getOwnPropertyDescriptor(await latestOf(projectId), key)?.value;
const hasKey = async (projectId: string, key: string): Promise<boolean> =>
	Object.getOwnPropertyDescriptor(await latestOf(projectId), key) !== undefined;

describe("an autosave does not clear what the agent owns", () => {
	test("a longform plan survives an autosave between planning and approval", async () => {
		const projectId = await seedWithPlan();

		const res = await app().request(`/projects/${projectId}/storyboards`, {
			method: "POST",
			headers: json,
			body: JSON.stringify({ storyboard_json: autosavePayload }),
		});
		expect(res.status).toBe(201);

		expect(await keyOf(projectId, "artifacts")).toEqual([
			{
				kind: "story_plan",
				sections: 3,
				generationState: {
					planId: "plan-opaque",
					draft: { revisionId: "draft-2" },
					approvedSnapshot: { revisionId: "approved-1" },
				},
			},
		]);
		// The editor's own content still landed.
		expect(await keyOf(projectId, "clips")).toHaveLength(1);
		expect(await keyOf(projectId, "markers")).toEqual(autosavePayload.markers);
	});

	test("the unit lifecycle survives too, not just artifacts", async () => {
		const projectId = await seedWithPlan();

		await app().request(`/projects/${projectId}/storyboards`, {
			method: "POST",
			headers: json,
			body: JSON.stringify({ storyboard_json: autosavePayload }),
		});

		expect(await keyOf(projectId, "unit_lifecycle")).toEqual({ planned: true });
	});

	test("a saver that DOES own artifacts replaces them rather than merging", async () => {
		const projectId = await seedWithPlan();

		await app().request(`/projects/${projectId}/storyboards`, {
			method: "POST",
			headers: json,
			body: JSON.stringify({
				storyboard_json: { ...autosavePayload, artifacts: [{ kind: "style_bible" }] },
			}),
		});

		expect(await keyOf(projectId, "artifacts")).toEqual([{ kind: "style_bible" }]);
	});

	test("a first save with nothing prior writes cleanly", async () => {
		const projectId = (await createContentProject({ title: "Fresh", type: "video" })).project.id;

		const res = await app().request(`/projects/${projectId}/storyboards`, {
			method: "POST",
			headers: json,
			body: JSON.stringify({ storyboard_json: autosavePayload }),
		});

		expect(res.status).toBe(201);
		expect(await hasKey(projectId, "artifacts")).toBe(false);
	});
});

/* The editor autosaves a carousel as `{ slides }` and a thread as `{ posts }`.
 * The save route read only the timeline document, so every such autosave wrote a
 * version without them, and the next reload showed an empty project. Found while
 * proving the agent cutover in the browser (adopt-mastra-internal-agent 3.1). */
describe("an image or text autosave keeps its content", () => {
	test("a carousel's slides survive the save, with their keys, images and references", async () => {
		const id = (await createContentProject({ title: "Carousel", type: "image" })).project.id;
		const slides = [
			{
				key: "slide_a",
				name: null,
				caption: "Feed it daily",
				visual: "a jar",
				image: "/api/media/one",
				reference_ids: ["ref-1"],
				note_ids: [],
			},
			{
				key: "slide_b",
				name: "Rest",
				caption: "Let it rest",
				visual: "a calendar",
				image: null,
				reference_ids: [],
				note_ids: ["n-1"],
			},
		];
		const res = await app().request(`/projects/${id}/storyboards`, {
			method: "POST",
			headers: json,
			body: JSON.stringify({ storyboard_json: { slides } }),
		});
		expect(res.status).toBe(201);
		const saved = (await getContentProject(id))!.storyboards[0]!.storyboard_json as {
			slides?: unknown;
		};
		expect(saved.slides).toEqual([
			{
				key: "slide_a",
				name: null,
				caption: "Feed it daily",
				visual: "a jar",
				image: "/api/media/one",
				reference_ids: ["ref-1"],
				note_ids: [],
			},
			{
				key: "slide_b",
				name: "Rest",
				caption: "Let it rest",
				visual: "a calendar",
				image: null,
				reference_ids: [],
				note_ids: ["n-1"],
			},
		]);
	});

	test("a thread's posts survive the save", async () => {
		const id = (await createContentProject({ title: "Thread", type: "text" })).project.id;
		const res = await app().request(`/projects/${id}/storyboards`, {
			method: "POST",
			headers: json,
			body: JSON.stringify({
				storyboard_json: { posts: [{ key: "post_a", body: "Keep it warm." }] },
			}),
		});
		expect(res.status).toBe(201);
		const saved = (await getContentProject(id))!.storyboards[0]!.storyboard_json as {
			posts?: unknown;
		};
		expect(saved.posts).toEqual([
			{ key: "post_a", body: "Keep it warm.", has_image: false, image: null },
		]);
	});
});

test("storyboard save retains authored animation and rejects invalid keys without appending a version", async () => {
	const id = await seedWithPlan();
	const animation = {
		tracks: {
			volume: [
				{ t: 0, v: 0.2 },
				{ t: 4, v: 0.8 },
			],
		},
	};
	const doc = toTimelineDoc(
		[],
		[
			{
				id: 2,
				kind: "video",
				url: "/api/media/video",
				start: 0,
				dur: 4,
				layout: { xPct: 0, yPct: 0, widthPct: 100, fit: "cover", animation },
			},
		],
		[],
		[{ id: 3, kind: "music", content: "Bed", start: 0, dur: 4, animation }],
	);
	const save = (payload: unknown) =>
		app().request(`/projects/${id}/storyboards`, {
			method: "POST",
			headers: json,
			body: JSON.stringify({ storyboard_json: payload }),
		});
	expect((await save(doc)).status).toBe(201);
	const loaded = fromTimelineDoc({
		...doc,
		clips: readStoryboardDocument(await latestOf(id)).doc.clips,
	});
	expect(loaded.videoOverlays[0]?.layout?.animation).toEqual(animation);
	expect(loaded.audioOverlays[0]?.animation).toEqual(animation);
	const before = await getContentProject(id);
	for (const [time, gain] of [
		[5, 0.8],
		[4, 2],
	]) {
		const bad = structuredClone(doc);
		bad.clips.find((c) => c.audio)!.audio!.animation!.tracks.volume![1] = { t: time!, v: gain! };
		const response = await save(bad);
		expect(response.status).toBe(400);
		expect((await response.json()).error).toBe("invalid_clip_animation");
		expect((await getContentProject(id))!.storyboards).toEqual(before!.storyboards);
	}
});

test("save retains compositing and explicit mask removal; invalid geometry appends no version", async () => {
	const id = await seedWithPlan();
	const mask = {
		shape: "ellipse" as const,
		xPct: 25,
		yPct: 25,
		widthPct: 50,
		heightPct: 50,
		rotationDeg: 30,
		featherPct: 12,
		inverted: true,
	};
	const layout = {
		xPct: 0,
		yPct: 0,
		widthPct: 100,
		fit: "cover" as const,
		mask,
		blendMode: "screen" as const,
		color: { brightness: 0.5, contrast: 1.2, saturation: 1.5 },
	};
	const doc = toTimelineDoc(
		[],
		[
			{ id: 2, kind: "image", url: "/frame.png", start: 0, dur: 4, layout },
			{
				id: 3,
				kind: "image",
				url: "/frame.png",
				start: 0,
				dur: 4,
				layout: { ...layout, mask: null },
			},
		],
	);
	const save = (payload: unknown) =>
		app().request(`/projects/${id}/storyboards`, {
			method: "POST",
			headers: json,
			body: JSON.stringify({ storyboard_json: payload }),
		});
	expect((await save(doc)).status).toBe(201);
	const loaded = fromTimelineDoc({
		...doc,
		clips: readStoryboardDocument(await latestOf(id)).doc.clips,
	});
	expect(loaded.videoOverlays[0]?.layout).toMatchObject(layout);
	expect(loaded.videoOverlays[1]?.layout?.mask).toBeNull();
	const before = (await getContentProject(id))!.storyboards;
	const bad = structuredClone(doc);
	bad.clips[0]!.video!.layout!.mask!.widthPct = 90;
	const response = await save(bad);
	expect(response.status).toBe(400);
	expect((await response.json()).issues.join(" ")).toContain("invalid mask");
	expect((await getContentProject(id))!.storyboards).toEqual(before);
});

test("saves refuse browser-local media URLs, naming the field, without appending a version", async () => {
	const id = await seedWithPlan();
	const save = (payload: unknown) =>
		app().request(`/projects/${id}/storyboards`, {
			method: "POST",
			headers: json,
			body: JSON.stringify({ storyboard_json: payload }),
		});
	const before = (await getContentProject(id))!.storyboards;
	const clip = toTimelineDoc(
		[],
		[{ id: 2, kind: "video", url: "blob:http://localhost/1", start: 0, dur: 4 }],
	);
	const scene = toTimelineDoc([
		{
			id: 1,
			dur: 4,
			name: "Open",
			shot: "",
			move: "",
			vis: "",
			vo: "",
			img: true,
			src: "data:video/mp4;base64,AAAA",
		} as never,
	]);
	for (const [doc, field] of [
		[clip, ".url is a browser-local blob: URL"],
		[scene, "is a data: URL that is not an image"],
	] as const) {
		const response = await save(doc);
		expect(response.status).toBe(400);
		const body = await response.json();
		expect(body.error).toBe("local_media_url");
		expect(body.issues.join(" ")).toContain(field);
		expect((await getContentProject(id))!.storyboards).toEqual(before);
	}
	expect(
		(
			await save(
				toTimelineDoc(
					[],
					[
						{
							id: 2,
							kind: "video",
							url: "/api/media/11111111-1111-7111-8111-111111111111",
							start: 0,
							dur: 4,
							thumb: "data:image/jpeg;base64,AAAA",
						},
					],
				),
			)
		).status,
	).toBe(201);

	const projects = new Hono();
	registerProjectRoutes(projects);
	const state = (editor_state: unknown) =>
		projects.request(`/projects/${id}/editor-state`, {
			method: "PUT",
			headers: json,
			body: JSON.stringify({ editor_state }),
		});
	const prior = (await getContentProject(id))!.project.editor_state_json;
	const refused = await state({
		media_assets: [{ id: "a", url: "blob:http://localhost/2", kind: "video" }],
	});
	expect(refused.status).toBe(400);
	expect((await refused.json()).issues).toEqual([
		"media_assets[0].url is a browser-local blob: URL",
	]);
	expect((await getContentProject(id))!.project.editor_state_json).toEqual(prior);
	expect(
		(
			await state({
				media_assets: [
					{ id: "k1", url: "/api/media/11111111-1111-7111-8111-111111111111", kind: "video" },
				],
			})
		).status,
	).toBe(200);
});

describe("an autosave is never mistaken for an agent run's save", () => {
	/* An edit-only agent run marks each version it writes with `agentEdit` (how many
	 * of its commands the version holds), and its next save trusts that marker
	 * (`edit-rebase.ts`). An editor save is not the run's: carrying the marker into
	 * it would make the run skip the user's document instead of fencing against it. */
	test("the marker on the version before does not survive an editor save", async () => {
		const id = (await createContentProject({ title: "Marked", type: "video" })).project.id;
		await addContentStoryboard({
			project_id: id,
			storyboard_json: { ...autosavePayload, agentEdit: { runId: "agent-1", applied: 2 } },
		});
		expect(await hasKey(id, "agentEdit")).toBe(true);
		const res = await app().request(`/projects/${id}/storyboards`, {
			method: "POST",
			headers: json,
			body: JSON.stringify({ storyboard_json: autosavePayload, status: "storyboard" }),
		});
		expect(res.status).toBe(201);
		expect(await hasKey(id, "agentEdit")).toBe(false);
	});
});
