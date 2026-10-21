import { describe, expect, test } from "vite-plus/test";
import { parseScriptMarkdown, planScriptImport } from "./script-markdown-parse.ts";
import { scriptChapters, toScriptMarkdown } from "./script-markdown.ts";
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
	{ id: "s-a", title: "Intro", brief: "Sets the cost of silence." },
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

const exported = (revision = 47): string =>
	toScriptMarkdown(scriptChapters(SCENES, CHAPTERS), {
		title: "Ships Break Quietly",
		project: "p-1",
		revision,
	});

describe("a round trip preserves what the file states", () => {
	test("every scene comes back with its identity, name, duration and prose", () => {
		const parsed = parseScriptMarkdown(exported());
		const all = parsed.chapters.flatMap((c) => c.scenes);
		expect(all.map((s) => s.id)).toEqual([7, 3, 9]);
		expect(all[0]).toMatchObject({
			name: "The Unread Log",
			durSec: 4,
			auto: false,
			label: "1.1",
			vo: "Ships break when nobody is watching.",
			sfx: "server hum",
			vis: "Terminal light on a dark desk.",
			shot: "close-up",
			move: "push-in",
		});
		expect(all[1]).toMatchObject({ id: 3, auto: true });
		expect(all[1]!.durSec).toBeUndefined();
		expect(all[2]).toMatchObject({ id: 9, cue: "NOVA" });
	});

	test("chapters and their briefs come back", () => {
		const parsed = parseScriptMarkdown(exported());
		expect(parsed.chapters.map((c) => c.title)).toEqual(["Intro", "The Turn"]);
		expect(parsed.chapters[0]!.brief).toBe("Sets the cost of silence.");
		expect(parsed.chapters[1]!.brief).toBeUndefined();
	});

	test("frontmatter comes back", () => {
		expect(parseScriptMarkdown(exported()).frontmatter).toMatchObject({
			project: "p-1",
			revision: "47",
		});
	});

	test("a clean export parses with nothing left over", () => {
		expect(parseScriptMarkdown(exported()).unparsed).toEqual([]);
	});
});

describe("computed values are never read back", () => {
	test("a hand-edited chapter footer cannot contradict the scenes", () => {
		const tampered = exported().replace(/Segment Words \d+/, "Segment Words 9999");
		const parsed = parseScriptMarkdown(tampered);
		// The footer is not a field, so there is nothing for it to have changed.
		expect(parsed.chapters[0]!.scenes).toHaveLength(2);
		expect(parsed.unparsed).toEqual([]);
	});
});

describe("import matches identity, never the label", () => {
	test("a known identity updates that scene", () => {
		const plan = planScriptImport(parseScriptMarkdown(exported()), { sceneIds: [7, 3, 9] });
		expect(plan.updates.map((u) => u.id)).toEqual([7, 3, 9]);
		expect(plan.creates).toEqual([]);
		expect(plan.removals).toEqual([]);
	});

	test("a label pointing at a different scene still updates by identity", () => {
		/* The file says `1.1 … {#s7}`. In the project, scene 7 now sits elsewhere.
		 * Matching the label would overwrite whichever scene is first today. */
		const plan = planScriptImport(parseScriptMarkdown(exported()), { sceneIds: [9, 3, 7] });
		expect(plan.updates.find((u) => u.scene.label === "1.1")?.id).toBe(7);
	});

	test("a row with no identity creates a scene", () => {
		const md = exported().replace(" {#s3}", "");
		const plan = planScriptImport(parseScriptMarkdown(md), { sceneIds: [7, 3, 9] });
		expect(plan.creates.map((s) => s.name)).toEqual(["Someone Reads It"]);
		expect(plan.updates.map((u) => u.id)).toEqual([7, 9]);
	});

	test("an identity this project does not have creates a scene", () => {
		const plan = planScriptImport(parseScriptMarkdown(exported()), { sceneIds: [7, 9] });
		expect(plan.creates.map((s) => s.id)).toEqual([3]);
	});

	test("a scene missing from the file is reported, never removed", () => {
		// A stale paste must not be able to delete an afternoon's work.
		const plan = planScriptImport(parseScriptMarkdown(exported()), { sceneIds: [7, 3, 9, 12] });
		expect(plan.removals).toEqual([12]);
	});
});

describe("divergence is reported, not merged", () => {
	test("a file exported at an older revision is flagged", () => {
		expect(
			planScriptImport(parseScriptMarkdown(exported(47)), { sceneIds: [7], revision: 52 }).diverged,
		).toBe(true);
	});

	test("a matching revision is not flagged", () => {
		expect(
			planScriptImport(parseScriptMarkdown(exported(52)), { sceneIds: [7], revision: 52 }).diverged,
		).toBe(false);
	});

	test("a file with no revision is not treated as current", () => {
		// Saying nothing about when it was written is not the same as being current,
		// so it does not get flagged as diverged either — the caller decides.
		const md = exported().replace(/revision: \d+\n/, "");
		expect(
			planScriptImport(parseScriptMarkdown(md), { sceneIds: [7], revision: 52 }).diverged,
		).toBe(false);
	});
});

describe("a foreign document loads, and says what it could not read", () => {
	test("a script that never came from here still yields scenes", () => {
		const foreign = [
			"# Act One",
			"",
			"## The Cold Open",
			"**AUDIO**",
			"We open on nothing.",
			"",
			"**VIDEO** — wide",
			"Black.",
		].join("\n");
		const parsed = parseScriptMarkdown(foreign);
		expect(parsed.chapters[0]!.title).toBe("Act One");
		expect(parsed.chapters[0]!.scenes[0]).toMatchObject({
			name: "The Cold Open",
			vo: "We open on nothing.",
			vis: "Black.",
			shot: "wide",
		});
		expect(parsed.chapters[0]!.scenes[0]!.id).toBeUndefined();
	});

	test("such a script creates scenes and removes nothing", () => {
		const plan = planScriptImport(parseScriptMarkdown("## Row one\n**AUDIO**\nWords."), {
			sceneIds: [],
		});
		expect(plan.creates).toHaveLength(1);
		expect(plan.removals).toEqual([]);
	});

	test("content it cannot place is reported rather than dropped", () => {
		const parsed = parseScriptMarkdown(
			"### A heading level we do not model\n\n| a | b |\n| - | - |",
		);
		expect(parsed.unparsed.map((u) => u.text.trim())).toEqual([
			"### A heading level we do not model",
			"| a | b |",
			"| - | - |",
		]);
	});

	test("an empty document is not an error", () => {
		expect(parseScriptMarkdown("")).toEqual({ frontmatter: {}, chapters: [], unparsed: [] });
	});

	test("scenes before any chapter are kept under an Unassigned one", () => {
		const parsed = parseScriptMarkdown("## Orphan\n**AUDIO**\nWords.");
		expect(parsed.chapters[0]).toMatchObject({ title: "Unassigned" });
	});
});

describe("export, restructure elsewhere, re-import", () => {
	test("reordering scenes in the file moves nothing but the labels", () => {
		/* The whole point of separating label from identity. Someone opens the
		 * export in a word processor, drags a scene to another chapter, and sends it
		 * back: the labels are all different and every scene must still land on
		 * itself. */
		const md = exported();
		const parsed = parseScriptMarkdown(md);
		const before = parsed.chapters.flatMap((c) => c.scenes).map((s) => ({ id: s.id, vo: s.vo }));

		// Move `{#s3}` out of chapter one and into chapter two, by hand, as a
		// person editing the file would.
		const moved = md
			.replace(/## 1\.2 Someone Reads It \{#s3\}[\s\S]*?(?=<!-- End of Chapter)/, "")
			.replace(
				"## 2.1 Everything Changes",
				"## 2.1 Someone Reads It {#s3} · auto\n**AUDIO**\nThen someone reads the log.\n\n**VISUAL**\nA hand stops the scroll.\n\n## 2.2 Everything Changes",
			);

		const reparsed = parseScriptMarkdown(moved);
		const after = reparsed.chapters.flatMap((c) => c.scenes);
		expect(after.map((s) => s.id)).toEqual([7, 3, 9]);
		expect(after.map((s) => s.label)).toEqual(["1.1", "2.1", "2.2"]);
		expect(after.find((s) => s.id === 3)!.vo).toBe(before.find((s) => s.id === 3)!.vo);

		const plan = planScriptImport(reparsed, { sceneIds: [7, 3, 9] });
		expect(plan.updates.map((u) => u.id).sort((a, b) => a - b)).toEqual([3, 7, 9]);
		expect(plan.creates).toEqual([]);
		expect(plan.removals).toEqual([]);
	});

	test("ids stay non-sequential across the trip", () => {
		// 7, 3, 9 is what the project has; the file never renumbers them.
		const ids = parseScriptMarkdown(exported())
			.chapters.flatMap((c) => c.scenes)
			.map((s) => s.id);
		expect(ids).toEqual([7, 3, 9]);
	});

	test("prose edited abroad comes back on the right scene", () => {
		const md = exported().replace("Then someone reads the log.", "Then somebody finally reads it.");
		const plan = planScriptImport(parseScriptMarkdown(md), { sceneIds: [7, 3, 9] });
		expect(plan.updates.find((u) => u.id === 3)!.scene.vo).toBe("Then somebody finally reads it.");
		expect(plan.updates.find((u) => u.id === 7)!.scene.vo).toBe(
			"Ships break when nobody is watching.",
		);
	});
});
