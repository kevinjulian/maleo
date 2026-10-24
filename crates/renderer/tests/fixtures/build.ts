/// <reference types="node" />
// Writes the renderer's TypeScript-derived fixtures:
// - built-storyboard.json: the render storyboard `buildRenderStoryboardFromDoc`
//   builds from a shared editor corpus scope, for the Rust decoder.
// - caption-timing.json: cues chunked by `groupCaptionWords`, and per frame the
//   cue `captionAt` shows and the word `captionActiveWord` marks, for the Rust
//   cue and word selection.
//
//   bun crates/renderer/tests/fixtures/build.ts          write
//   bun crates/renderer/tests/fixtures/build.ts --check  fail when stale
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	buildRenderStoryboardFromDoc,
	groupCaptionWords,
	type TimelineDoc,
} from "../../../../packages/shared/src/index.ts";
import {
	captionActiveWord,
	captionAt,
	type RenderCaptionCue,
} from "../../../../packages/video/src/components/Captions.tsx";

const here = fileURLToPath(new URL(".", import.meta.url));
// SAFETY: the corpus scopes are editor scopes exported by
// scripts/export-editor-corpus.ts; `doc` is a TimelineDoc.
const scope = JSON.parse(
	readFileSync(
		join(here, "../../../../packages/shared/src/editor/corpus/scopes/video-s-0e71d5854634.json"),
		"utf8",
	),
) as { doc: TimelineDoc };
const refs = { images: [], notes: [], speakers: [], style: { tone: "", palette: "", music: "" } };
const { storyboard } = buildRenderStoryboardFromDoc({ format: "9:16" }, refs, scope.doc);

// Spoken words with a pause and a sentence end, so the chunker splits.
const spoken = "Halo semua, ini maleo. Kami membuat video pendek dengan cepat dan rapi untuk kamu"
	.split(" ")
	.map((text, i) => {
		const startSec = 0.2 + i * 0.31 + (i >= 6 ? 0.7 : 0);
		return { text, startSec, endSec: startSec + 0.26 };
	});
const cues: RenderCaptionCue[] = groupCaptionWords(spoken).map((phrase, i) => ({
	id: `cue-${i}`,
	startSec: phrase.startSec,
	durationSec: phrase.endSec - phrase.startSec,
	caption: { text: phrase.text, words: phrase.words } as RenderCaptionCue["caption"],
}));
const lastFrame = Math.ceil((cues.at(-1)!.startSec + cues.at(-1)!.durationSec) * 30) + 2;
const frames = Array.from({ length: lastFrame }, (_, frame) => {
	const cue = captionAt(cues, frame / 30);
	return {
		frame,
		cue: cue ? cues.indexOf(cue) : null,
		word: cue ? captionActiveWord(cue.caption.words, frame / 30 - cue.startSec) : null,
	};
});

const outputs: Array<[string, unknown]> = [
	["built-storyboard.json", storyboard],
	["caption-timing.json", { cues: cues.map((c) => ({ ...c, type: "caption", track: 0 })), frames }],
];
for (const [name, value] of outputs) {
	const out = join(here, name);
	const json = `${JSON.stringify(value, null, "\t")}\n`;
	if (process.argv.includes("--check")) {
		if (readFileSync(out, "utf8") !== json) throw new Error(`${out} is stale; run without --check`);
	} else writeFileSync(out, json);
}
