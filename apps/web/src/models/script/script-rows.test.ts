import { describe, expect, test } from "vite-plus/test";
import {
	audioLines,
	DENSITY_COLUMNS,
	hasOverlap,
	mergeLosesAssets,
	mergeScenes,
	overlapsOf,
	scriptRows,
	showsColumn,
	splitScene,
	timelineAudioOf,
} from "./script-rows.ts";
import { sceneSpeechHash, seedChapters, toScriptMarkdown, toTimelineDoc } from "@maleo/shared";
import type { Chapter, Clip, Scene } from "@maleo/shared";

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
	{ id: "s-a", title: "Intro" },
	{ id: "s-b", title: "The Turn" },
];
const SCENES: Scene[] = [
	scene({ id: 7, sectionId: "s-a", dur: 4, vo: "Ships break when nobody is watching." }),
	scene({ id: 3, sectionId: "s-a", dur: 5, vo: "Then someone reads the log." }),
	scene({ id: 9, sectionId: "s-b", dur: 6, vo: "Everything changes.", castId: "nova" }),
];

const rowsOf = (scenes = SCENES, clips?: Clip[]) =>
	scriptRows({ scenes, chapters: CHAPTERS, clips: clips ?? toTimelineDoc(scenes).clips });

describe("a scene's label is derived from its position", () => {
	test("labels number scenes within their chapter", () => {
		expect(rowsOf().flatMap((c) => c.rows.map((r) => r.label))).toEqual(["1.1", "1.2", "2.1"]);
	});

	test("moving a scene between chapters changes its label, not its identity", () => {
		const moved = SCENES.map((s) => (s.id === 3 ? { ...s, sectionId: "s-b" } : s));
		const rows = rowsOf(moved).flatMap((c) => c.rows);
		expect(rows.find((r) => r.scene.id === 3)!.label).toBe("2.1");
		expect(rows.map((r) => r.scene.id)).toEqual([7, 3, 9]);
	});

	test("inserting a scene shifts the labels after it and no identity", () => {
		const inserted = [SCENES[0]!, scene({ id: 99, sectionId: "s-a" }), SCENES[1]!, SCENES[2]!];
		const rows = rowsOf(inserted).flatMap((c) => c.rows);
		expect(rows.map((r) => r.label)).toEqual(["1.1", "1.2", "1.3", "2.1"]);
		expect(rows.map((r) => r.scene.id)).toEqual([7, 99, 3, 9]);
	});

	test("nothing about a label is stored on the scene", () => {
		expect(Object.keys(SCENES[0]!)).not.toContain("label");
	});
});

describe("a speaker cue appears only when a speaker was chosen", () => {
	test("a scene on the default voice carries no cue", () => {
		expect(
			rowsOf()
				.flatMap((c) => c.rows)
				.find((r) => r.scene.id === 7)!.cue,
		).toBeUndefined();
	});

	test("a scene with a chosen speaker carries one", () => {
		expect(
			rowsOf()
				.flatMap((c) => c.rows)
				.find((r) => r.scene.id === 9)!.cue,
		).toBe("nova");
	});
});

describe("the audio cell lists every audio element on the scene", () => {
	const clip = (
		over: Partial<Scene["audioClips"] extends (infer C)[] | undefined ? C : never> & {
			kind: "voiceover" | "sfx" | "music";
			content: string;
		},
	) => ({ id: `a-${over.kind}`, label: "", startSec: 0, durationSec: 4, ...over });

	test("music, effect and narration render in that order, whatever order they were stored in", () => {
		const s = scene({
			id: 1,
			audioClips: [
				clip({ kind: "voiceover", content: "Arrakis, the city of deadly mercenaries." }),
				clip({ kind: "music", content: "Beethoven's 9th symphony swells." }),
				clip({ kind: "sfx", content: "server hum" }),
			],
		});
		expect(audioLines(s)).toEqual([
			{ kind: "music", title: "Beethoven's 9th symphony swells.", continues: false },
			{ kind: "sfx", title: "server hum", continues: false },
			{
				kind: "vo",
				speaker: "Narrator",
				text: "Arrakis, the city of deadly mercenaries.",
				editable: true,
			},
		]);
	});

	test("a scene carrying narration alone renders no empty cue lines", () => {
		const lines = audioLines(scene({ id: 1, vo: "Everything changes." }));
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatchObject({ kind: "vo", text: "Everything changes." });
	});

	test("a scene with no audioClips falls back to vo and sfx", () => {
		// `scene.sfx` has already joined music and effects together upstream, so this
		// path cannot separate them and labels the result SFX — as the row did before.
		expect(audioLines(scene({ id: 1, vo: "Ships break.", sfx: "server hum" }))).toEqual([
			{ kind: "sfx", title: "server hum", continues: false },
			{ kind: "vo", speaker: "Narrator", text: "Ships break.", editable: true },
		]);
	});

	test("the speaker falls back clip label, then cast, then default voice, then Narrator", () => {
		const named = scene({
			id: 1,
			audioClips: [clip({ kind: "voiceover", content: "x", label: "Duke Leto" })],
		});
		expect(audioLines(named, "nova")).toMatchObject([{ speaker: "Duke Leto" }]);

		// The labels `audioKindLabel` mints describe the KIND, so they must not land
		// where a name belongs.
		const generic = scene({
			id: 1,
			castId: "nova",
			audioClips: [clip({ kind: "voiceover", content: "x", label: "TTS Voiceover" })],
		});
		expect(audioLines(generic, "atlas")).toMatchObject([{ speaker: "nova" }]);

		expect(audioLines(scene({ id: 1, vo: "x" }), "atlas")).toMatchObject([{ speaker: "atlas" }]);
		expect(audioLines(scene({ id: 1, vo: "x" }))).toMatchObject([{ speaker: "Narrator" }]);
	});

	test("only the first voiceover line is editable", () => {
		// Two fields bound to the same `Scene.vo` would let the last blur silently
		// win over the other.
		const two = scene({
			id: 1,
			audioClips: [
				clip({ kind: "voiceover", content: "First." }),
				{ ...clip({ kind: "voiceover", content: "Second." }), id: "a-vo-2" },
			],
		});
		expect(audioLines(two).map((l) => l.kind === "vo" && l.editable)).toEqual([true, false]);
	});

	test("a scene carrying only a music cue still offers somewhere to write narration", () => {
		// The script is the surface narration is written on. A row with no field at
		// all would be one an operator cannot type into.
		const lines = audioLines(
			scene({ id: 1, vo: "", audioClips: [clip({ kind: "music", content: "bed" })] }),
		);
		expect(lines).toEqual([
			{ kind: "music", title: "bed", continues: false },
			{ kind: "vo", speaker: "Narrator", text: "", editable: true },
		]);
	});
});

describe("timeline audio crossing a row is named, not counted", () => {
	const audioClip = (
		id: string,
		kind: "music" | "sfx" | "voiceover" | "accent_hit",
		content: string,
		start: number,
		dur: number,
		origin?: string,
	): Clip =>
		({
			id,
			type: "audio",
			startSec: start,
			durationSec: dur,
			track: 1,
			audio: {
				id: Number(id.split(":")[1]),
				kind,
				content,
				start,
				dur,
				...(origin ? { origin } : {}),
			},
		}) as Clip;

	// A bed over the whole project, an accent on the first scene, and generated
	// speech — the shape a real project carries.
	const timelineClips = (): Clip[] => [
		...toTimelineDoc(SCENES).clips,
		audioClip("audio:900", "music", "Background music: calm ambient", 0, 79.7),
		audioClip("audio:950", "accent_hit", "Section accent", 0, 1.2),
		audioClip("audio:1000", "voiceover", "Ships break when nobody is watching.", 0, 4.2, "tts"),
	];

	test("a bed spanning the project is stated on the row it starts on, and not after", () => {
		// Printed on every row it crosses it would be wallpaper, not disclosure.
		const rows = rowsOf(SCENES, timelineClips()).flatMap((c) => c.rows);
		const music = rows.map(
			(r) =>
				audioLines(r.scene, undefined, r.timelineAudio).filter((l) => l.kind === "music").length,
		);
		expect(music).toEqual([1, 0, 0]);
	});

	test("the bed is marked as running past the row it starts on", () => {
		const first = rowsOf(SCENES, timelineClips())[0]!.rows[0]!;
		const line = audioLines(first.scene, undefined, first.timelineAudio).find(
			(l) => l.kind === "music",
		);
		expect(line).toMatchObject({
			kind: "music",
			title: "Background music: calm ambient",
			continues: true,
		});
	});

	test("an accent hit reads as an effect", () => {
		const first = rowsOf(SCENES, timelineClips())[0]!.rows[0]!;
		expect(audioLines(first.scene, undefined, first.timelineAudio)).toContainEqual({
			kind: "sfx",
			title: "Section accent",
			continues: false,
		});
	});

	test("generated speech is its own line, after the narration, with its measured length", () => {
		const first = rowsOf(SCENES, timelineClips())[0]!.rows[0]!;
		const lines = audioLines(first.scene, undefined, first.timelineAudio);
		expect(lines.at(-1)).toEqual({
			kind: "speech",
			text: "Ships break when nobody is watching.",
			origin: "tts",
			durationSec: 4.2,
		});
		expect(lines.findIndex((l) => l.kind === "vo")).toBeLessThan(lines.length - 1);
	});

	test("a scene's own clips are not timeline audio — they are the scene", () => {
		const rows = rowsOf(SCENES, toTimelineDoc(SCENES).clips).flatMap((c) => c.rows);
		expect(rows.every((r) => r.timelineAudio.length === 0)).toBe(true);
	});

	test("a row nothing crosses carries no timeline audio", () => {
		expect(timelineAudioOf([audioClip("audio:1", "music", "bed", 100, 5)], 0, 4)).toEqual([]);
	});

	test("a cue landing exactly on the next scene's start belongs to that scene, not this one", () => {
		// Scene starts are running sums of float durations, so an exact comparison
		// put a boundary cue inside BOTH rows and the same line printed twice.
		const cue = audioClip("audio:2", "sfx", "paper flip", 16.64, 1.2);
		expect(timelineAudioOf([cue], 15.13, 16.64 - 15.13)).toEqual([]);
		expect(timelineAudioOf([cue], 16.64, 1.5)).toMatchObject([
			{ content: "paper flip", startsHere: true },
		]);
	});
});

describe("chapters carry computed totals", () => {
	test("segment and cumulative totals accumulate", () => {
		const [intro, turn] = rowsOf();
		expect(intro).toMatchObject({ segmentSec: 9, segmentWords: 11, totalSec: 9, totalWords: 11 });
		expect(turn).toMatchObject({ segmentSec: 6, segmentWords: 2, totalSec: 15, totalWords: 13 });
	});

	test("a chapter with no scenes still renders, with zero totals", () => {
		const groups = scriptRows({ scenes: [], chapters: CHAPTERS });
		expect(groups).toHaveLength(2);
		expect(groups[0]).toMatchObject({ segmentSec: 0, segmentWords: 0, rows: [] });
	});
});

describe("density is column visibility, and changes no scene", () => {
	test("outline shows structure, read shows narration, write shows everything", () => {
		expect(DENSITY_COLUMNS.outline).toEqual(["label", "name", "duration"]);
		expect(DENSITY_COLUMNS.read).toEqual(["audio"]);
		expect(showsColumn("write", "image")).toBe(true);
		expect(showsColumn("read", "image")).toBe(false);
		expect(showsColumn("outline", "audio")).toBe(false);
	});

	test("the rows themselves do not depend on density", () => {
		// Changing density must not modify a scene, which is trivially true when
		// density never reaches the row derivation at all.
		expect(scriptRows({ scenes: SCENES, chapters: CHAPTERS })).toEqual(
			scriptRows({ scenes: SCENES, chapters: CHAPTERS }),
		);
	});
});

describe("the script discloses what it does not own", () => {
	const clips = (): Clip[] => [
		...toTimelineDoc(SCENES).clips,
		{
			id: "text:1",
			type: "text",
			startSec: 1,
			durationSec: 2,
			track: 0,
			text: { id: 1, content: "Title", start: 1, dur: 2 },
		} as Clip,
		{
			id: "audio:1",
			type: "audio",
			startSec: 0,
			durationSec: 15,
			track: 1,
			audio: { id: 1, kind: "music", content: "bed", start: 0, dur: 15 },
		} as Clip,
	];

	test("an overlapping overlay and a music bed are reported on the row they cross", () => {
		const first = rowsOf(SCENES, clips())[0]!.rows[0]!;
		expect(first.overlaps).toMatchObject({ overlays: 1, music: 1 });
		expect(hasOverlap(first.overlaps)).toBe(true);
	});

	test("a scene's own clips are not an overlap — they are the scene", () => {
		const rows = rowsOf(SCENES, toTimelineDoc(SCENES).clips);
		expect(rows.flatMap((c) => c.rows).every((r) => !hasOverlap(r.overlaps))).toBe(true);
	});

	test("a row nothing crosses reports nothing", () => {
		const only = [
			{
				id: "text:1",
				type: "text",
				startSec: 100,
				durationSec: 2,
				track: 0,
				text: { id: 1, content: "x", start: 100, dur: 2 },
			} as Clip,
		];
		expect(hasOverlap(overlapsOf(only, 0, 4))).toBe(false);
	});
});

describe("staleness reaches the row", () => {
	test("an edited narration marks the row's speech stale", () => {
		const s = scene({ id: 1, sectionId: "s-a", vo: "Original." });
		const edited = { ...s, speechInputHash: sceneSpeechHash(s), vo: "Rewritten." };
		expect(rowsOf([edited])[0]!.rows[0]!.speechStale).toBe(true);
	});

	test("a scene with no recorded hash is not stale", () => {
		expect(rowsOf()[0]!.rows[0]!.speechStale).toBe(false);
	});

	test("a pinned scene whose speech runs long reports the overflow", () => {
		const s = scene({ id: 1, sectionId: "s-a", dur: 4, contentDur: 5.2, durMode: "pinned" });
		expect(rowsOf([s])[0]!.rows[0]!.overflowSec).toBeCloseTo(1.2);
	});
});

describe("splitting a scene while writing", () => {
	const source = scene({
		id: 7,
		sectionId: "s-a",
		shot: "close-up",
		move: "push-in",
		castId: "nova",
		dur: 6,
		contentDur: 5,
		vo: "Ships break. Then someone reads.",
		src: "a.png",
		img: true,
	});

	test("the narration divides at the cursor", () => {
		const [head, tail] = splitScene(source, "Ships break.".length, 42);
		expect(head.vo).toBe("Ships break.");
		expect(tail.vo).toBe("Then someone reads.");
	});

	test("the new scene takes a fresh id and inherits shot, movement and speaker", () => {
		const [, tail] = splitScene(source, 12, 42);
		expect(tail).toMatchObject({
			id: 42,
			shot: "close-up",
			move: "push-in",
			castId: "nova",
			sectionId: "s-a",
		});
	});

	test("both halves go auto, because neither's old duration describes its new text", () => {
		const [head, tail] = splitScene(source, 12, 42);
		expect(head.durMode).toBe("auto");
		expect(tail.durMode).toBe("auto");
		expect(head.contentDur).toBeUndefined();
	});

	test("the new half carries no generated assets", () => {
		// They belonged to the whole scene; showing them under half the words
		// would be the wrong picture under the wrong narration.
		const [head, tail] = splitScene(source, 12, 42);
		expect(tail).toMatchObject({ src: undefined, img: false, frameInputHash: undefined });
		expect(head.src).toBe("a.png");
	});

	test("splitting at the very start or end still yields two scenes", () => {
		expect(splitScene(source, 0, 42)[0]!.vo).toBe("");
		expect(splitScene(source, 9999, 42)[1]!.vo).toBe("");
	});
});

describe("merging a scene into the one before it", () => {
	const first = scene({ id: 1, dur: 4, vo: "Ships break.", src: "a.png" });
	const second = scene({ id: 2, dur: 3, vo: "Then someone reads." });

	test("one scene remains, carrying both narrations", () => {
		const merged = mergeScenes(first, second);
		expect(merged.id).toBe(1);
		expect(merged.vo).toBe("Ships break. Then someone reads.");
		expect(merged.dur).toBe(7);
	});

	test("the survivor keeps the first scene's assets and loses its stamped speech", () => {
		const merged = mergeScenes({ ...first, speechInputHash: "old" }, second);
		expect(merged.src).toBe("a.png");
		// The speech no longer matches the joined text, so the row must read as
		// needing speech rather than as carrying speech that fits.
		expect(merged.speechInputHash).toBeUndefined();
		expect(merged.durMode).toBe("auto");
	});

	test("merging away a scene with generated work is flagged first", () => {
		expect(mergeLosesAssets(second)).toBe(false);
		expect(mergeLosesAssets({ ...second, src: "b.png" })).toBe(true);
		expect(
			mergeLosesAssets({
				...second,
				audioClips: [
					{ id: "a", kind: "voiceover", label: "VO", content: "x", startSec: 0, durationSec: 1 },
				],
			}),
		).toBe(true);
	});
});

describe("scenes land in their chapters even when the chapters were derived elsewhere", () => {
	/* The load derives chapters and returns them WITHOUT stamping membership onto
	 * the scenes, because the clip-first read has to hand back what it read. Passing
	 * those chapters into the seed made it return them untouched — so no scene had
	 * membership, every scene fell into one "Unassigned" group, and the real
	 * chapters rendered empty. This is that exact shape. */
	const unstamped = [
		scene({ id: 1, beat: "hook", vo: "One." }),
		scene({ id: 2, beat: "hook", vo: "Two." }),
		scene({ id: 3, beat: "setup", vo: "Three." }),
	];

	test("derived chapters place their scenes rather than orphaning them", () => {
		const derived = seedChapters(unstamped, null).chapters;
		const groups = scriptRows({ scenes: unstamped, chapters: [...derived] });
		expect(groups.map((g) => g.rows.length)).toEqual([2, 1]);
		expect(groups.some((g) => g.chapter.title === "Unassigned")).toBe(false);
	});

	test("an authored title survives the derivation", () => {
		const derived = seedChapters(unstamped, null).chapters;
		const renamed = derived.map((c, i) =>
			i === 0 ? { ...c, title: "Cold Open", brief: "Sets it up." } : c,
		);
		const groups = scriptRows({ scenes: unstamped, chapters: [...renamed] });
		expect(groups[0]!.chapter).toMatchObject({ title: "Cold Open", brief: "Sets it up." });
		expect(groups[0]!.rows).toHaveLength(2);
	});

	test("a chapter no scene names is still rendered", () => {
		const derived = seedChapters(unstamped, null).chapters;
		const groups = scriptRows({
			scenes: unstamped,
			chapters: [...derived, { id: "ch-99", title: "Unwritten" }],
		});
		expect(groups.at(-1)).toMatchObject({ chapter: { title: "Unwritten" }, rows: [] });
	});
});

describe("what is exported is what the table shows", () => {
	test("scenes with no written membership export under their derived chapter", () => {
		/* The table derives membership for projects that never had it written down.
		 * Re-grouping from the raw document at export time instead put every one of
		 * those scenes under "Unassigned", so the file disagreed with the page it
		 * came from. Export renders the ROWS. */
		const unstamped = [scene({ id: 1, vo: "One." }), scene({ id: 2, vo: "Two." })];
		const groups = scriptRows({ scenes: unstamped, chapters: [{ id: "ch-1", title: "Intro" }] });
		const md = toScriptMarkdown(
			groups.map((g) => ({ chapter: g.chapter, scenes: g.rows.map((r) => r.scene) })),
		);
		expect(md).toContain("# 1. Intro");
		expect(md).toContain("## 1.1");
		expect(md).toContain("## 1.2");
		expect(md).not.toContain("Unassigned");
	});
});
