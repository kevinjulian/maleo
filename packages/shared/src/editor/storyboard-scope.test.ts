import { describe, expect, test } from "vite-plus/test";
import { readStoryboardDocument } from "../storyboard-document.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	SCOPE_OWNED_KEYS,
	storedMediaLibrary,
	storyboardHead,
	storyboardScope,
	storyboardWithScope,
} from "./storyboard-scope.ts";

const head = {
	schemaVersion: 2,
	clips: [{ id: "text:1", type: "text", startSec: 0, durationSec: 1, track: 0 }],
	markers: [],
	pacingDevices: { chapterPills: true },
	presentation: { aspect: "9:16" },
	artifacts: [{ kind: "story_plan" }],
	unit_lifecycle: { planned: true },
	slides: [
		{
			key: "s1",
			name: null,
			caption: "c",
			visual: "v",
			image: "/api/media/1",
			reference_ids: [],
			note_ids: [],
		},
	],
};

describe("a stored storyboard as the editable scope", () => {
	test("reads the scope's fields and carries no media", () => {
		const scope = storyboardScope(head);
		expect(scope.doc.clips.map((clip) => clip.id)).toEqual(["text:1"]);
		expect(scope.slides).toEqual([
			{
				key: "s1",
				id: 1,
				cap: "c",
				vis: "v",
				img: true,
				src: "/api/media/1",
				refIds: [],
				noteIds: [],
			},
		]);
		expect(scope.mediaAssets).toEqual([]);
	});

	test("writing the scope back keeps what the scope does not own", () => {
		const scope = storyboardScope(head);
		const moved = {
			...scope,
			doc: { ...scope.doc, clips: [{ ...scope.doc.clips[0]!, startSec: 3 }] },
		};
		const written = storyboardWithScope(head, moved);
		const doc = readStoryboardDocument(written).doc;
		expect(doc.clips[0]!.startSec).toBe(3);
		expect(doc.pacingDevices).toEqual(head.pacingDevices);
		expect(doc.artifacts).toEqual(head.artifacts);
		expect(doc.unitLifecycle).toEqual(head.unit_lifecycle);
		expect(written.slides).toEqual(head.slides);
		expect(storyboardScope(written)).toEqual(moved);
	});
});

describe("the scope's optional parts", () => {
	test("a thread's posts round-trip, and absent document fields stay absent", () => {
		const thread = {
			posts: [
				{ key: "p1", body: "one", has_image: false, image: null },
				{ key: "p2", body: "two", has_image: true, image: "/api/media/2" },
			],
		};
		const scope = storyboardScope(thread);
		expect(scope.posts).toEqual([
			{ key: "p1", id: 1, body: "one", img: false },
			{ key: "p2", id: 2, body: "two", img: true, src: "/api/media/2" },
		]);
		expect(scope.doc).not.toHaveProperty("chapters");
		expect(scope.doc).not.toHaveProperty("captionSet");
		const written = storyboardWithScope(thread, scope);
		expect(written.posts).toEqual(thread.posts);
		expect(written).not.toHaveProperty("slides");
		expect(written).not.toHaveProperty("chapters");
	});

	test("present document fields are carried both ways", () => {
		const doc = {
			schemaVersion: 2,
			clips: [],
			markers: [],
			chapters: [],
			bookmarks: [{ id: "b1", timeSec: 2, label: "Here" }],
			captions: { enabled: true },
			trackFlags: { "0": { hidden: true } },
			slides: [
				{
					key: "s1",
					name: "Cover",
					caption: "c",
					visual: "v",
					image: null,
					reference_ids: ["r"],
					note_ids: [],
				},
			],
		};
		const scope = storyboardScope(doc);
		expect(scope.doc.chapters).toEqual([]);
		expect(scope.doc.bookmarks).toEqual(doc.bookmarks);
		expect(scope.doc.captions).toEqual(doc.captions);
		expect(scope.doc.trackFlags).toEqual(doc.trackFlags);
		expect(scope.slides[0]).toEqual({
			key: "s1",
			id: 1,
			name: "Cover",
			cap: "c",
			vis: "v",
			img: false,
			refIds: ["r"],
			noteIds: [],
		});
		const written = storyboardWithScope(doc, scope);
		expect(written.chapters).toEqual([]);
		expect(written.bookmarks).toEqual(doc.bookmarks);
		expect(written.slides).toEqual(doc.slides);
	});

	test("a scope without references or materials keeps the head's", () => {
		const head = {
			schemaVersion: 2,
			clips: [],
			markers: [],
			projectReferences: { prompt: "@A", entityIds: ["a"] },
		};
		const scope = storyboardScope(head);
		const bare = {
			...scope,
			doc: { schemaVersion: 2 as const, clips: [], markers: [] },
			slides: [{ key: "s", id: 1, cap: "", vis: "", img: false }],
		};
		const written = storyboardWithScope(head, bare);
		expect(written.projectReferences).toEqual(head.projectReferences);
		expect(written.slides).toEqual([
			{
				key: "s",
				name: null,
				caption: "",
				visual: "",
				image: null,
				reference_ids: [],
				note_ids: [],
			},
		]);
	});
});

describe("a project's stored media list", () => {
	const asset = (id: string, url: string) => ({
		id,
		label: id,
		url,
		kind: "image",
		source: "upload",
	});

	test("merges the editor state's list and the document's by URL, editor state first", () => {
		const library = storedMediaLibrary(
			{ media_assets: [asset("a", "/u/1"), asset("b", "/u/2")] },
			{ media_assets: [asset("c", "/u/2"), asset("d", "/u/3")] },
		);
		expect(library.map((item) => item.id)).toEqual(["a", "b", "d"]);
	});

	test("drops entries without a URL and names an unnamed one by its URL", () => {
		const library = storedMediaLibrary(
			{
				media_assets: [{ label: "x" }, { url: "/u/9", label: "y", kind: "image", source: "stock" }],
			},
			null,
		);
		expect(library.map((item) => item.id)).toEqual(["/u/9"]);
	});

	test("is empty when nothing was stored", () => {
		expect(storedMediaLibrary(null, {})).toEqual([]);
	});
});

describe("an envelope head", () => {
	// SAFETY: the committed persisted-form corpus (`fixtures/README.md`).
	const persisted = JSON.parse(
		readFileSync(
			join(import.meta.dirname, "../../../../fixtures/persisted-storyboards.json"),
			"utf8",
		),
	) as Record<string, unknown>;
	const stored = { ...persisted, head };

	test("holds every stored field outside the scope and none inside it", () => {
		expect(storyboardHead(head)).toEqual({
			sceneTextClipMigrationVersion: null,
			pacingDevices: { chapterPills: true },
			presentation: { aspect: "9:16" },
			artifacts: [{ kind: "story_plan" }],
			unit_lifecycle: { planned: true },
		});
	});

	test.each(Object.entries(stored))(
		"%s rebuilds from head and scope as from the stored document",
		(_, raw) => {
			const scope = storyboardScope(raw);
			const fromHead = storyboardHead(raw);
			for (const key of SCOPE_OWNED_KEYS) expect(fromHead).not.toHaveProperty(key);
			expect(storyboardWithScope(fromHead, scope)).toEqual(storyboardWithScope(raw, scope));
		},
	);
});
