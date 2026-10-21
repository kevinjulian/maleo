import { describe, expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { ScriptTable } from "./script-table.tsx";
import { scriptRows } from "@models/script/script-rows.ts";
import { sceneSpeechHash, toTimelineDoc } from "@maleo/shared";
import type { Chapter, Clip, Scene } from "@maleo/shared";

// Static render + source assertions (harness has no DOM/event layer).

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
		dur: 4,
		shot: "close-up",
		move: "push-in",
		vo: "Ships break when nobody is watching.",
		vis: "Terminal light on a dark desk.",
		src: "a.png",
		img: true,
	}),
	scene({
		id: 3,
		sectionId: "s-a",
		dur: 5,
		durMode: "auto",
		vo: "Then someone reads the log.",
		vis: "A hand stops the scroll.",
	}),
	scene({
		id: 9,
		sectionId: "s-b",
		dur: 6,
		vo: "Everything changes.",
		vis: "The room lights up.",
		castId: "nova",
	}),
];

const html = (
	over: Partial<Parameters<typeof ScriptTable>[0]> = {},
	scenes = SCENES,
	clips?: Clip[],
): string =>
	renderToStaticMarkup(
		<ScriptTable
			chapters={scriptRows({
				scenes,
				chapters: CHAPTERS,
				clips: clips ?? toTimelineDoc(scenes).clips,
			})}
			density="write"
			onEdit={() => {}}
			{...over}
		/>,
	);

describe("the table renders one row per scene, audio before visual", () => {
	test("every scene is a row, with its label and both prose cells", () => {
		const out = html();
		expect(out).toContain(">1.1<");
		expect(out).toContain(">1.2<");
		expect(out).toContain(">2.1<");
		expect(out).toContain("Ships break when nobody is watching.");
		expect(out).toContain("Terminal light on a dark desk.");
	});

	test("audio comes before visual in the markup, not just visually", () => {
		const out = html();
		expect(out.indexOf("Narration for Scene 7")).toBeLessThan(
			out.indexOf("Visual prompt for Scene 7"),
		);
	});

	test("a scene with a frame shows it; one without says so", () => {
		const out = html();
		expect(out).toContain('src="a.png"');
		expect(out).toContain("no frame");
	});

	test("the duration cell shows the duration alone", () => {
		const out = html();
		// Four, five and six second scenes.
		expect(out).toContain("00:04");
		expect(out).toContain("00:05");
		expect(out).toContain("00:06");
	});

	test("neither the start offset nor the duration mode is rendered", () => {
		// A start offset is a fact about the timeline, not about the writing. The
		// mode goes with it; the overflow flag still fires where it matters.
		const out = html();
		expect(out).not.toContain(">PIN<");
		expect(out).not.toContain(">AUTO<");
		expect(out).not.toContain("sc-mode");
	});

	test("the delete control is still reachable from the duration cell", () => {
		expect(html({ onDelete: () => {} })).toContain('aria-label="Delete Scene 7"');
	});

	test("the column is headed Duration", () => {
		const out = html();
		expect(out).toContain(">Duration<");
		expect(out).not.toContain(">Time<");
	});
});

describe("the audio cell lists every audio element on the scene", () => {
	const withAudio = (): Scene[] => [
		{
			...SCENES[0]!,
			audioClips: [
				{
					id: "a1",
					kind: "voiceover",
					label: "",
					content: "Arrakis, the city of deadly mercenaries.",
					startSec: 0,
					durationSec: 4,
				},
				{
					id: "a2",
					kind: "music",
					label: "",
					content: "Beethoven's 9th symphony swells.",
					startSec: 0,
					durationSec: 4,
				},
				{ id: "a3", kind: "sfx", label: "", content: "server hum", startSec: 0, durationSec: 4 },
			],
		},
		...SCENES.slice(1),
	];

	test("music, effect and narration render as labelled lines in that order", () => {
		const out = html({}, withAudio());
		expect(out).toContain("Beethoven&#x27;s 9th symphony swells.");
		expect(out).toContain("server hum");
		expect(out.indexOf("Beethoven")).toBeLessThan(out.indexOf("server hum"));
		expect(out.indexOf("server hum")).toBeLessThan(out.indexOf("Narration for Scene 7"));
	});

	test("the cues are read-only and only the narration is a field", () => {
		// They project clips the script does not own, and an edit that writes
		// nowhere is worse than no edit at all.
		const out = html({}, withAudio());
		const cues = out.match(/<div class="sc-audio-line sc-audio-cue">.*?<\/div>/g) ?? [];
		expect(cues).toHaveLength(2);
		expect(cues.every((cue) => !/<textarea|<input|<button/.test(cue))).toBe(true);
		// The narration is the one field in the cell.
		expect(out.match(/aria-label="Narration for Scene 7"/g)).toHaveLength(1);
	});

	test("every voiceover line names its speaker", () => {
		const out = html({ defaultVoice: "atlas" });
		expect(out).toContain("VO (atlas)");
		// The scene that chose one names that one instead.
		expect(out).toContain("VO (nova)");
	});
});

describe("the frame is sized by the shape it turns out to be", () => {
	test("a frame starts portrait, which is what the pipeline produces", () => {
		// The document records a URL, never dimensions, so the common case reserves
		// the right box and the uncommon one corrects itself once decoded.
		expect(html()).toContain('data-orient="portrait"');
	});

	test("orientation decides WIDTH; the frame keeps its own ratio", () => {
		// A portrait frame at full column width stands nearly twice as tall as the
		// prose beside it. Half the column keeps the row readable.
		const css = readFileSync(new URL("./script-table.css", import.meta.url), "utf8");
		expect(css).toMatch(/\.sc-image\[data-orient="portrait"\][^}]*width:\s*50%/);
		expect(css).toMatch(/\.sc-image\[data-orient="wide"\][^}]*width:\s*100%/);
		// No fixed ratio on the base rule: a landscape or square frame keeps its own.
		expect(css).toMatch(/\.sc-image\s*\{[^}]*height:\s*auto/);
	});

	test("a scene with no frame still reserves a box", () => {
		expect(html()).toContain('class="sc-image sc-image-empty" data-orient="portrait"');
	});
});

describe("a long visual prompt does not set the row height", () => {
	test("the visual field is capped and scrolls; the narration field is not", () => {
		const out = html();
		expect(out).toMatch(
			/class="[^"]*\bsc-prose sc-prose-capped" aria-label="Visual prompt for Scene 7"/,
		);
		expect(out).toMatch(/class="[^"]*\bsc-prose" aria-label="Narration for Scene 7"/);
		const css = readFileSync(new URL("./script-table.css", import.meta.url), "utf8");
		expect(css).toMatch(/\.sc-prose-capped\s*\{[^}]*max-height/);
		expect(css).toMatch(/\.sc-prose-capped\s*\{[^}]*overflow-y:\s*auto/);
	});
});

describe("chapters bound the document", () => {
	test("each chapter has a numbered header and its title", () => {
		const out = html();
		expect(out).toContain("Chapter 1");
		expect(out).toContain(">Intro<");
		expect(out).toContain("Chapter 2");
		expect(out).toContain(">The Turn<");
	});

	test("a brief renders when there is one", () => {
		expect(html()).toContain("Nobody watches the logs until something breaks.");
	});

	test("a chapter with no brief gets no placeholder in its place", () => {
		// A prompt on every chapter of every project would be noise on a field
		// nothing generates yet.
		expect(html()).not.toContain('sc-chapter-brief"></p>');
		expect(html()).not.toMatch(/Add a brief/i);
	});

	test("the footer states segment and cumulative totals", () => {
		const out = html();
		expect(out).toContain("Segment RT");
		expect(out).toContain("Total words");
		expect(out).toContain("00:09");
	});

	test("each footer statistic is a stacked label-over-value pair", () => {
		// The values are what the reader is scanning for; inline they were the tail
		// of a run-on line.
		const out = html();
		expect(out).toContain(
			'<span class="sc-stat-label">Segment RT</span><b class="sc-stat-value">00:09</b>',
		);
		expect(out.match(/class="sc-stat"/g)).toHaveLength(10);
	});

	test("a chapter with no scenes still renders", () => {
		const out = html({}, [SCENES[0]!]);
		expect(out).toContain(">The Turn<");
		expect(out).toContain("No scenes in this chapter yet.");
	});
});

describe("density is column visibility over the same rows", () => {
	test("outline drops the prose and keeps the structure", () => {
		const out = html({ density: "outline" });
		expect(out).toContain(">1.1<");
		expect(out).toContain(">Intro<");
		expect(out).not.toContain("Ships break when nobody is watching.");
	});

	test("read keeps narration alone", () => {
		const out = html({ density: "read" });
		expect(out).toContain("Ships break when nobody is watching.");
		expect(out).not.toContain("Terminal light on a dark desk.");
		expect(out).not.toContain('src="a.png"');
	});

	test("the density reaches the grid, so columns are hidden rather than rows retemplated", () => {
		expect(html({ density: "outline" })).toContain('data-density="outline"');
	});
});

describe("what the script shows but does not own", () => {
	test("overlapping content is disclosed on the row it crosses", () => {
		const clips: Clip[] = [
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
				durationSec: 20,
				track: 1,
				audio: { id: 1, kind: "music", content: "bed", start: 0, dur: 20 },
			} as Clip,
		];
		expect(html({}, SCENES, clips)).toContain("1 overlay");
	});

	test("audio is named in the audio cell, not counted beside the visual", () => {
		// A count next to a cell that already names every clip crossing the row is
		// the same fact told twice, and told worse.
		const clips: Clip[] = [
			...toTimelineDoc(SCENES).clips,
			{
				id: "audio:1",
				type: "audio",
				startSec: 0,
				durationSec: 20,
				track: 1,
				audio: { id: 1, kind: "music", content: "bed", start: 0, dur: 20 },
			} as Clip,
		];
		const out = html({}, SCENES, clips);
		expect(out).toContain("Music:");
		expect(out).not.toMatch(/\d+ audio/);
	});

	test("a project with nothing overlapping says nothing", () => {
		expect(html()).not.toContain("sc-owned");
	});
});

describe("staleness is information, not an error", () => {
	const staleScenes = (): Scene[] => {
		const s = SCENES[0]!;
		return [
			{ ...s, speechInputHash: sceneSpeechHash(s), vo: "Rewritten entirely." },
			...SCENES.slice(1),
		];
	};

	test("a stale row offers regeneration when something can act on it", () => {
		const out = html({ onRegenerateSpeech: () => {} }, staleScenes());
		expect(out).toContain("text changed since generated — regenerate");
		expect(out).toContain("<button");
	});

	test("the two kinds are offered independently", () => {
		/* The editor can regenerate a frame but has no per-scene speech path. One
		 * handler for both would have made the surface offer an action it cannot
		 * perform. */
		const out = html({ onRegenerateFrame: () => {} }, staleScenes());
		expect(out).toContain("text changed since this speech was generated");
		expect(out).not.toContain("— regenerate");
	});

	test("a scene being generated says so rather than looking idle", () => {
		const out = html({ onRegenerateFrame: () => {}, generating: { 7: true } }, staleScenes());
		expect(out).toContain("generating…");
	});

	test("with no handler the staleness is stated but not offered as an action", () => {
		// A button wired to nothing reads as offered and does nothing, and the
		// operator cannot tell which. The information survives; the affordance does
		// not.
		const out = html({}, staleScenes());
		expect(out).toContain("text changed since this speech was generated");
		expect(out).not.toContain("— regenerate");
	});

	test("no control regenerates everything at once", () => {
		// Bulk regeneration spends credits without a decision, so the surface must
		// not offer it at all.
		const out = html({}, staleScenes());
		expect(out).not.toMatch(/regenerate all/i);
		const source = readFileSync(new URL("./script-table.tsx", import.meta.url), "utf8");
		expect(source).not.toMatch(/regenerateAll|onRegenerateAll/);
	});

	test("a pinned scene whose speech runs long says so on the row", () => {
		const over = [{ ...SCENES[0]!, durMode: "pinned" as const, contentDur: 5.2 }];
		expect(html({}, over)).toContain("speech runs 1.2s past this shot");
	});
});

describe("the speaker cue appears only when a speaker was chosen", () => {
	test("the header does not name the default voice", () => {
		// Every voiceover line names its own speaker, so a name in the header was
		// the same fact twice — and the wrong one on any row that chose differently.
		const out = html({ defaultVoice: "nova" });
		expect(out).toContain(">Audio / Voiceover<");
		expect(out).not.toContain("Audio / Voiceover · nova");
	});

	test("a scene that chose a speaker names it, and one that did not names the default", () => {
		// Every voiceover line names its speaker now that the line is labelled by
		// kind: an unlabelled "VO:" beside "Music:" and "SFX:" would be the one
		// line in the cell that does not say whose it is.
		const out = html({ defaultVoice: "atlas" });
		expect(out).toContain('<div class="sc-cue">VO (nova)</div>');
		expect(out.match(/VO \(atlas\)/g)).toHaveLength(2);
	});

	test("with no default voice named, the fallback speaker is not hardcoded in the component", () => {
		const source = readFileSync(new URL("./script-table.tsx", import.meta.url), "utf8");
		expect(source).not.toMatch(/Narrator/);
	});

	test("no hardcoded role string exists to fall back on", () => {
		const source = readFileSync(new URL("./script-table.tsx", import.meta.url), "utf8");
		expect(source).not.toMatch(/NARRATOR/);
	});
});

describe("the grid is one grid for the whole page", () => {
	test("chapters do not open their own table", () => {
		// A table element per chapter would size its columns independently and the
		// same column would land at a different width in every chapter.
		const css = readFileSync(new URL("./script-table.css", import.meta.url), "utf8");
		expect(css).toContain("grid-template-columns: subgrid");
		expect(html()).not.toContain("<table");
	});

	test("the header is sticky rather than repeated per chapter", () => {
		const out = html();
		expect(out.match(/class="sc-head"/g)).toHaveLength(1);
		const css = readFileSync(new URL("./script-table.css", import.meta.url), "utf8");
		expect(css).toMatch(/\.sc-head\s*\{[^}]*position:\s*sticky/);
	});

	test("narrow viewports stack the cells", () => {
		const css = readFileSync(new URL("./script-table.css", import.meta.url), "utf8");
		expect(css).toMatch(/@media \(max-width: 60rem\)/);
	});
});

describe("chapters can be renamed and briefed", () => {
	test("with a handler the title and brief are writable", () => {
		const out = html({ onChapterEdit: () => {} });
		expect(out).toContain('aria-label="Title of chapter 1"');
		expect(out).toContain('aria-label="Brief for chapter 1"');
	});

	test("a chapter with no brief still offers somewhere to write one", () => {
		// Nothing generates a brief, so without the invitation the field would be a
		// permanently blank one nobody knows they can fill.
		expect(html({ onChapterEdit: () => {} })).toContain("What is this chapter for?");
	});

	test("with no handler the header is read-only and promises nothing", () => {
		const out = html();
		expect(out).toContain("<h2");
		expect(out).not.toContain("What is this chapter for?");
		expect(out).not.toContain('aria-label="Title of chapter 1"');
	});
});

describe("citations sit beside the narration they justify", () => {
	const GROUNDED: Scene[] = [
		scene({
			id: 11,
			sectionId: "s-a",
			dur: 5,
			vo: "Majapahit declined through the fifteenth century.",
			vis: "A court emptying.",
			sourceEvidence: [
				{
					url: "https://hist.example/majapahit",
					quote: "declined through the late fifteenth century",
				},
				{ url: "https://edu.example/decline", quote: "succession wars eroded its authority" },
			],
		}),
		scene({
			id: 12,
			sectionId: "s-a",
			dur: 4,
			vo: "A dragon watched from the hill.",
			vis: "A hill.",
		}),
	];

	test("a grounded scene offers its evidence, collapsed", () => {
		const out = html({}, GROUNDED, toTimelineDoc(GROUNDED).clips);
		expect(out).toContain("2 evidence matches");
		// Collapsed: the quote is behind the toggle, so a citation cannot lengthen
		// the row until the operator asks for it.
		expect(out).not.toContain("declined through the late fifteenth century");
	});

	/* The deliberate blind spot. `Scene` records no `factual` or `citationStatus`,
	 * so an ungrounded row says NOTHING rather than implying the line needed
	 * grounding — a fiction beat and an unsupported factual claim would otherwise
	 * get the same mark, which is worse than silence. */
	test("a scene with no evidence shows no citation affordance and no verdict", () => {
		const out = html({}, [GROUNDED[1]!], toTimelineDoc([GROUNDED[1]!]).clips);
		expect(out).not.toContain("evidence match");
		expect(out).not.toContain("source");
	});

	test("the outline density stays scannable", () => {
		const outline = html({ density: "outline" }, GROUNDED, toTimelineDoc(GROUNDED).clips);
		expect(outline).not.toContain("evidence match");
		const write = html({ density: "write" }, GROUNDED, toTimelineDoc(GROUNDED).clips);
		expect(write).toContain("evidence match");
	});

	test("displaying a citation writes nothing back to the scene", () => {
		const before = JSON.stringify(GROUNDED);
		html({}, GROUNDED, toTimelineDoc(GROUNDED).clips);
		expect(JSON.stringify(GROUNDED)).toBe(before);
	});
});
