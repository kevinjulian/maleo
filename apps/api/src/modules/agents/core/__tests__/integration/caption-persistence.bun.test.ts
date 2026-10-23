import { afterAll, expect, test } from "bun:test";
import { Hono } from "hono";
import {
	readStoryboardDocument,
	captionStateFingerprint,
	DEFAULT_CAPTIONS,
	type CaptionSet,
	type Clip,
} from "@maleo/shared";
import { closeMaleoDb } from "@maleo/db/connection";
import { createContentProject, getContentProject } from "@maleo/db/project-detail";
import { addContentStoryboard, StoryboardRevisionConflict } from "@maleo/db/storyboards";
import { commandEntriesBetween } from "@maleo/db/project-commands";
import { buildAgentJob } from "../../run-bracket.ts";
import { runDocument, executeEdit } from "../../edit-document.ts";
import { updateClip, moveClip } from "@maleo/shared/editor";
import { persist } from "../../persistence.ts";
import { registerStoryboardRoutes } from "../../../../../routes/operations/storyboards.ts";

afterAll(closeMaleoDb);
const captionSet: CaptionSet = {
	initialized: true,
	language: "id",
	revision: 1,
	deletedRanges: [],
	appliedRunIds: ["run-1"],
};
const caption: Clip = {
	id: "caption:1",
	type: "caption",
	startSec: 0,
	durationSec: 2,
	track: 1,
	caption: {
		text: "Corrected",
		words: [],
		provenance: { origin: "manual", wordTimingOrigin: "estimated" },
		sources: [],
		protection: { text: true, timing: false, segmentation: false, style: false },
		revision: 1,
		groupId: "g1",
		status: "current",
	},
};
const text: Clip = {
	id: "text:1",
	type: "text",
	startSec: 0,
	durationSec: 2,
	track: 0,
	text: { id: 1, content: "Title", start: 0, dur: 2, preset: "title" },
};
const doc = (revision = 1, clips: Clip[] = [text, caption]) => ({
	schemaVersion: 2,
	clips,
	markers: [],
	captionSet: { ...captionSet, revision },
});
async function seed() {
	const { project } = await createContentProject({ title: "Caption preservation", type: "video" });
	const row = await addContentStoryboard({ project_id: project.id, storyboard_json: doc() });
	return { id: project.id, row: row! };
}
async function latest(id: string) {
	return readStoryboardDocument((await getContentProject(id))?.storyboards[0]?.storyboard_json).doc;
}

test("saved and unsaved caption state enters agent command execution", async () => {
	const { id } = await seed();
	for (const unsaved of [false, true]) {
		const live = doc(2, [
			text,
			{ ...caption, caption: { ...caption.caption!, text: "Unsaved correction", revision: 2 } },
		]);
		const job = await buildAgentJob({
			projectId: id,
			instruction: "",
			...(unsaved ? { seedClips: live.clips, captionSet: live.captionSet } : {}),
		});
		expect(runDocument(job).captionSet?.revision).toBe(unsaved ? 2 : 1);
		expect(
			executeEdit(job, updateClip(text.id, { text: { ...text.text!, content: "Agent title" } })),
		).toEqual({ ok: true });
		expect(runDocument(job).clips.find((clip) => clip.type === "caption")?.caption?.text).toBe(
			unsaved ? "Unsaved correction" : "Corrected",
		);
	}
});

test("newer hand corrections and explicit deletions survive generation snapshots", async () => {
	for (const deleted of [false, true]) {
		const { id } = await seed();
		const job = await buildAgentJob({ projectId: id, instruction: "" });
		const next = doc(
			2,
			deleted
				? [text]
				: [
						text,
						{ ...caption, caption: { ...caption.caption!, text: "New correction", revision: 2 } },
					],
		);
		await addContentStoryboard({ project_id: id, storyboard_json: next });
		await persist(job);
		const saved = await latest(id);
		expect(saved.captionSet).toEqual(next.captionSet);
		expect(saved.clips.filter((clip) => clip.type === "caption")).toEqual(
			next.clips.filter((clip) => clip.type === "caption"),
		);
	}
});

test("fresh narration creates canonical cues and later agent placement moves retain corrections", async () => {
	const { project } = await createContentProject({
		title: "Fresh caption narration",
		type: "video",
	});
	await addContentStoryboard({
		project_id: project.id,
		storyboard_json: { schemaVersion: 2, clips: [], markers: [] },
	});
	const job = await buildAgentJob({ projectId: project.id, instruction: "" });
	const url = "/api/media/00000000-0000-4000-8000-000000000077";
	job.audioOverlays = [
		{
			id: 1000,
			kind: "voiceover",
			origin: "tts",
			content: "Hello world",
			url,
			startSec: 1,
			durationSec: 2,
			track: 0,
			originalDur: 2,
			words: [
				{ text: "Hello", startSec: 1, endSec: 1.8 },
				{ text: "world", startSec: 2, endSec: 3 },
			],
		},
	];
	job.generatedCaptionSources = {
		[url]: {
			language: "en",
			provenance: {
				origin: "script-assisted",
				wordTimingOrigin: "script-assisted",
				engine: "whisper.cpp",
				model: "base",
			},
		},
	};
	await persist(job);
	const first = await latest(project.id);
	const cue = first.clips.find((clip) => clip.type === "caption")!;
	expect(cue?.caption?.text).toBe("Hello world");
	expect(first.captionSet?.language).toBe("en");
	expect(first.trackFlags?.[cue.track]?.group).toBe("caption");
	const corrected = {
		...first,
		clips: first.clips.map((clip) =>
			clip.id === cue.id
				? {
						...clip,
						caption: {
							...clip.caption!,
							text: "Corrected",
							words: [],
							revision: 1,
							protection: { ...clip.caption!.protection, text: true },
						},
					}
				: clip,
		),
	};
	await addContentStoryboard({ project_id: project.id, storyboard_json: corrected });
	job.audioOverlays[0]!.startSec = 5;
	job.audioOverlays[0]!.words = [
		{ text: "Hello", startSec: 5, endSec: 5.8 },
		{ text: "world", startSec: 6, endSec: 7 },
	];
	await persist(job);
	const moved = await latest(project.id);
	const after = moved.clips.find((clip) => clip.id === cue.id)!;
	expect(after.caption?.text).toBe("Corrected");
	expect(after.startSec).toBe(5);
	expect(moved.clips.filter((clip) => clip.type === "caption")).toHaveLength(1);
});

test("edit-only rebasing preserves caption edits made while run was active", async () => {
	const { id } = await seed();
	const job = await buildAgentJob({ projectId: id, instruction: "" });
	expect(
		executeEdit(job, updateClip(text.id, { text: { ...text.text!, content: "Agent title" } })),
	).toEqual({ ok: true });
	const next = doc(2);
	await addContentStoryboard({ project_id: id, storyboard_json: next });
	await persist(job);
	const saved = await latest(id);
	expect(saved.captionSet).toEqual(next.captionSet);
	expect(saved.clips.find((clip) => clip.id === caption.id)).toEqual(caption);
	expect(saved.clips.find((clip) => clip.id === text.id)?.text?.content).toBe("Agent title");
});

test("two writes from one saved revision cannot overwrite each other", async () => {
	const { id, row } = await seed();
	const attempts = await Promise.allSettled(
		[2, 3].map((revision) =>
			addContentStoryboard({
				project_id: id,
				expectedRevisionId: row.id,
				storyboard_json: doc(revision),
			}),
		),
	);
	expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
	const rejected = attempts.find((attempt) => attempt.status === "rejected");
	expect(
		rejected?.status === "rejected" && rejected.reason instanceof StoryboardRevisionConflict,
	).toBe(true);
	expect([2, 3]).toContain((await latest(id)).captionSet?.revision ?? -1);
});

test("autosave preserves omitted captions and fences stale state while allowing exact undo", async () => {
	const { id } = await seed();
	const app = new Hono();
	registerStoryboardRoutes(app);
	const save = (
		storyboard_json: unknown,
		expectedCaptionState = captionStateFingerprint(readStoryboardDocument(doc()).doc),
	) =>
		app.request(`/projects/${id}/storyboards`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ storyboard_json, expectedCaptionState }),
		});
	expect((await save({ schemaVersion: 2, clips: [text], markers: [] })).status).toBe(201);
	expect((await latest(id)).clips.find((clip) => clip.id === caption.id)).toEqual(caption);
	expect((await save(doc(2, [text]))).status).toBe(201);
	expect((await save(doc(1))).status).toBe(409);
	expect((await latest(id)).clips.filter((clip) => clip.type === "caption")).toEqual([]);
	const base = captionStateFingerprint(await latest(id));
	expect((await save(doc(1), base)).status).toBe(201);
	expect((await latest(id)).captionSet?.revision).toBe(1);
	expect((await save(doc(5, [text]), base)).status).toBe(409);
	expect((await save({ ...doc(3), clips: [{ ...caption, durationSec: 0 }] })).status).toBe(400);
});

test("writers that omit caption ownership preserve global caption style too", async () => {
	const { id } = await seed();
	await addContentStoryboard({
		project_id: id,
		storyboard_json: { ...doc(), captions: { ...DEFAULT_CAPTIONS, style: "Word pop" } },
	});
	const app = new Hono();
	registerStoryboardRoutes(app);
	const response = await app.request(`/projects/${id}/storyboards`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			storyboard_json: { schemaVersion: 2, clips: [text], markers: [], captions: DEFAULT_CAPTIONS },
		}),
	});
	expect(response.status).toBe(201);
	expect((await latest(id)).captions?.style).toBe("Word pop");
});

test("source commands hold when linked caption is corrected or deleted during run", async () => {
	for (const deleted of [false, true]) {
		const { id } = await seed();
		const source: Clip = {
			id: "video:7",
			type: "video",
			startSec: 0,
			durationSec: 4,
			track: 0,
			video: {
				id: 7,
				kind: "video",
				url: "/api/media/11111111-1111-4111-8111-111111111111",
				mediaAssetId: "media-1",
				start: 0,
				dur: 4,
				mediaStartSec: 0,
				volume: 1,
			},
		};
		const linked: Clip = {
			...caption,
			caption: {
				...caption.caption!,
				sources: [
					{
						clipId: source.id,
						mediaId: "media-1",
						mediaRevision: "r1",
						sourceStartSec: 0,
						sourceEndSec: 2,
					},
				],
			},
		};
		await addContentStoryboard({ project_id: id, storyboard_json: doc(2, [source, linked]) });
		const job = await buildAgentJob({ projectId: id, instruction: "" });
		expect(executeEdit(job, moveClip(source.id, { startSec: 2 }))).toEqual({ ok: true });
		expect(runDocument(job).clips.find((clip) => clip.id === caption.id)?.startSec).toBe(2);
		const latestCues = deleted
			? []
			: [{ ...linked, caption: { ...linked.caption!, text: "Later correction", revision: 3 } }];
		await addContentStoryboard({
			project_id: id,
			storyboard_json: doc(3, [source, ...latestCues]),
		});
		await persist(job);
		const saved = await latest(id);
		expect(saved.clips.find((clip) => clip.id === source.id)?.startSec).toBe(0);
		expect(saved.clips.filter((clip) => clip.type === "caption")).toEqual(latestCues);
	}
});

test("an agent write enters the command log as one scope.replace", async () => {
	const { id, row } = await seed();
	const job = await buildAgentJob({ projectId: id, instruction: "" });
	expect(executeEdit(job, { type: "clip.move", id: "text:1", patch: { startSec: 1 } })).toEqual({
		ok: true,
	});
	await persist(job);
	const head = (await getContentProject(id))!.storyboards[0]!;
	expect(head.version).toBeGreaterThan(row.version);
	const entries = await commandEntriesBetween(id, row.version, head.version);
	const last = entries!.at(-1)!;
	expect(last.version).toBe(head.version);
	expect(last.commands.map((command) => command.type)).toEqual(["scope.replace"]);
	const [command] = last.commands;
	if (command?.type !== "scope.replace") throw new Error("expected a scope.replace");
	expect(command.scope.doc.clips.find((clip) => clip.id === "text:1")?.startSec).toBe(1);
});
