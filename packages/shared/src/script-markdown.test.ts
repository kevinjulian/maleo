import { describe, expect, test } from "vite-plus/test";
import { chapterTotals, scriptChapters, toScriptMarkdown, wordCount } from "./script-markdown.ts";
import type { Chapter } from "./timeline-doc.ts";
import type { Scene } from "./timeline-model.ts";

const scene = (over: Partial<Scene> & { id: number }): Scene =>
	({
		dur: 4,
		name: `Scene ${over.id}`,
		shot: "",
		move: "",
		vis: "",
		vo: "",
		img: false,
		...over,
	}) as Scene;

const CHAPTERS: Chapter[] = [
	{ id: "s-a", title: "Intro", brief: "Nobody watches the logs until something breaks." },
	{ id: "s-b", title: "The Turn" },
];

const SCENES: Scene[] = [
	scene({
		id: 7,
		sectionId: "s-a",
		name: "The Unread Log",
		dur: 4,
		durMode: "pinned",
		shot: "close-up",
		move: "push-in",
		vo: "Ships break when nobody is watching.",
		vis: "Terminal light on a dark desk.",
		sfx: "server hum",
	}),
	scene({
		id: 3,
		sectionId: "s-a",
		name: "Someone Reads It",
		durMode: "auto",
		shot: "wide",
		move: "static",
		vo: "Then someone reads the log.",
		vis: "A hand stops the scroll.",
	}),
	scene({
		id: 9,
		sectionId: "s-b",
		name: "Everything Changes",
		dur: 6,
		vo: "Everything changes.",
		vis: "The room lights up.",
		castId: "nova",
	}),
];

const render = (): string =>
	toScriptMarkdown(scriptChapters(SCENES, CHAPTERS), {
		title: "Ships Break Quietly",
		format: "9:16",
		voice: "nova",
		project: "p-1",
		revision: 47,
	});

describe("the file is headings and blocks, never a table", () => {
	test("frontmatter carries the project and the revision it was exported at", () => {
		const md = render();
		expect(
			md.startsWith(
				"---\ntitle: Ships Break Quietly\nformat: 9:16\nvoice: nova\nproject: p-1\nrevision: 47\n---",
			),
		).toBe(true);
	});

	test("no table row is ever emitted", () => {
		// The VIEW is a table; the file must not be. Pipe alignment rots on every
		// edit and multi-line cells need `<br>`.
		expect(render()).not.toMatch(/^\s*\|/m);
	});

	test("a chapter heading is followed by its brief", () => {
		expect(render()).toContain("# 1. Intro\n\nNobody watches the logs until something breaks.");
	});

	test("a chapter with no brief emits no placeholder for one", () => {
		expect(render()).toContain("# 2. The Turn\n\n## 2.1");
	});

	test("each scene has an AUDIO block and a VISUAL block, audio first", () => {
		const md = render();
		expect(md.indexOf("**AUDIO**")).toBeLessThan(md.indexOf("**VISUAL**"));
		expect(md).toContain("**AUDIO**\nShips break when nobody is watching.\nSFX: server hum");
		expect(md).toContain("**VISUAL** — close-up, push-in\nTerminal light on a dark desk.");
	});
});

describe("a label is positional and an identity is not", () => {
	test("labels number scenes within their chapter, and carry the stable id", () => {
		const md = render();
		expect(md).toContain("## 1.1 The Unread Log {#s7} · 4s");
		expect(md).toContain("## 1.2 Someone Reads It {#s3} · auto");
		expect(md).toContain("## 2.1 Everything Changes {#s9} · 6s");
	});

	test("moving a scene to another chapter changes its label, not its identity", () => {
		const moved = SCENES.map((s) => (s.id === 3 ? { ...s, sectionId: "s-b" } : s));
		const md = toScriptMarkdown(scriptChapters(moved, CHAPTERS));
		expect(md).toContain("## 2.1 Someone Reads It {#s3}");
		expect(md).not.toContain("## 1.2 Someone Reads It");
	});

	test("scene ids stay non-sequential — the label carries the order", () => {
		// Ids are 7, 3, 9 and stay that way; only the labels run 1.1, 1.2, 2.1.
		const md = render();
		expect([...md.matchAll(/\{#s(\d+)\}/g)].map((m) => m[1])).toEqual(["7", "3", "9"]);
	});
});

describe("a speaker cue appears only when a speaker was chosen", () => {
	test("the default voice is named once in the frontmatter, not on every scene", () => {
		const md = render();
		expect(md).toContain("voice: nova");
		expect(md).toContain("**AUDIO**\nShips break");
	});

	test("a scene with a chosen speaker carries the cue", () => {
		expect(render()).toContain("**AUDIO** — NOVA\nEverything changes.");
	});
});

describe("computed values are emitted so the file reads alone", () => {
	test("a chapter footer states its own totals and the cumulative ones", () => {
		const md = render();
		expect(md).toContain("End of Chapter: Intro · Segment RT 00:08 · Segment Words 11");
		expect(md).toContain("· Total RT 00:08 · Total Words 11");
		expect(md).toContain("End of Chapter: The Turn · Segment RT 00:06 · Segment Words 2");
		expect(md).toContain("· Total RT 00:14 · Total Words 13");
	});

	test("the footer says it is generated, so nobody hand-edits it expecting an effect", () => {
		expect(render()).toContain("generated, not read on import");
	});

	test("totals accumulate across chapters", () => {
		const totals = chapterTotals(scriptChapters(SCENES, CHAPTERS));
		expect(totals[0]).toMatchObject({
			segmentSec: 8,
			segmentWords: 11,
			totalSec: 8,
			totalWords: 11,
		});
		expect(totals[1]).toMatchObject({
			segmentSec: 6,
			segmentWords: 2,
			totalSec: 14,
			totalWords: 13,
		});
	});
});

describe("grouping scenes into chapters", () => {
	test("a chapter with no scenes still appears", () => {
		// An operator can write into a chapter before putting anything in it.
		const groups = scriptChapters([], CHAPTERS);
		expect(groups.map((g) => g.chapter.id)).toEqual(["s-a", "s-b"]);
		expect(groups.every((g) => g.scenes.length === 0)).toBe(true);
	});

	test("a scene naming no chapter is not dropped from the file", () => {
		const groups = scriptChapters([scene({ id: 1 })], CHAPTERS);
		expect(groups.at(-1)).toMatchObject({ chapter: { title: "Unassigned" } });
		expect(groups.at(-1)!.scenes.map((s) => s.id)).toEqual([1]);
	});

	test("a scene naming a chapter that no longer exists is not dropped either", () => {
		const groups = scriptChapters([scene({ id: 1, sectionId: "gone" })], CHAPTERS);
		expect(groups.at(-1)!.scenes.map((s) => s.id)).toEqual([1]);
	});
});

describe("word count", () => {
	test.each([
		["", 0],
		["   ", 0],
		["one", 1],
		["one two  three", 3],
		["line\nbreak", 2],
	] as const)("%j counts %j", (text, count) => expect(wordCount(text)).toBe(count));
});
