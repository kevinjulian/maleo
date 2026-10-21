import { expect, test } from "vite-plus/test";
import { applyCommand } from "./editor/engine-registry.ts";
import { editCaptions } from "./editor/commands.ts";
import {
	withGeneratedNarrationCaptions,
	type GeneratedCaptionSources,
} from "./generated-narration-captions.ts";
import type { TimelineDoc } from "./timeline-doc.ts";

const media = "00000000-0000-4000-8000-000000000001";
const url = `/api/media/${media}`;
const fresh: GeneratedCaptionSources = {
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
function doc(): TimelineDoc {
	return {
		schemaVersion: 2,
		clips: [
			{
				id: "audio:1000",
				type: "audio",
				startSec: 3,
				durationSec: 2,
				track: 0,
				audio: {
					id: 1000,
					kind: "voiceover",
					origin: "tts",
					content: "Hello world.",
					url,
					start: 3,
					dur: 2,
					track: 0,
					mediaStartSec: 2,
					originalDur: 8,
					words: [
						{ text: "Hello", startSec: 3, endSec: 3.8 },
						{ text: "world.", startSec: 4, endSec: 5 },
					],
				},
			},
		],
		markers: [],
	};
}
test("historical voiceover words never initialize captions without fresh synthesis evidence", () => {
	const before = doc();
	expect(withGeneratedNarrationCaptions(before, undefined, applyCommand)).toBe(before);
	expect(withGeneratedNarrationCaptions(before, {}, applyCommand)).toBe(before);
});
test("fresh narration creates canonical script-assisted cues with original-source bindings and stable identity", () => {
	const before = doc();
	const result = withGeneratedNarrationCaptions(before, fresh, applyCommand);
	const cue = result.clips.find((clip) => clip.type === "caption")!;
	expect(cue.caption?.text).toBe("Hello world.");
	expect(cue.startSec).toBe(3);
	expect(cue.durationSec).toBe(2);
	expect(cue.caption?.words[0]).toMatchObject({ text: "Hello", startSec: 0 });
	expect(cue.caption?.words[0]?.endSec).toBeCloseTo(0.8, 9);
	expect(cue.caption?.sources[0]).toEqual({
		clipId: "audio:1000",
		mediaId: media,
		mediaRevision: media,
		sourceStartSec: 2,
		sourceEndSec: 4,
	});
	expect(cue.caption?.provenance).toMatchObject({
		origin: "script-assisted",
		wordTimingOrigin: "script-assisted",
		model: "base",
	});
	expect(result.trackFlags?.[cue.track]?.group).toBe("caption");
	expect(withGeneratedNarrationCaptions(result, fresh, applyCommand)).toBe(result);
	expect(before.clips).toHaveLength(1);
});

test("fresh narration reuses the empty caption lane without overwriting other lane groups", () => {
	const before = {
		...doc(),
		trackFlags: { 1: { group: "effect" as const }, 2: { group: "caption" as const } },
	};
	const result = withGeneratedNarrationCaptions(before, fresh, applyCommand);
	expect(result.clips.find((clip) => clip.type === "caption")?.track).toBe(2);
	expect(result.trackFlags).toEqual(before.trackFlags);
});
test("fresh synthesis with no recognition marks timing estimated and keeps semantic silence empty", () => {
	const before = doc();
	delete before.clips[0]!.audio!.words;
	const result = withGeneratedNarrationCaptions(
		before,
		{
			[url]: { language: "en", provenance: { origin: "estimated", wordTimingOrigin: "estimated" } },
		},
		applyCommand,
	);
	const cues = result.clips.filter((clip) => clip.type === "caption");
	expect(cues.length).toBeGreaterThan(0);
	for (const cue of cues) {
		expect(cue.startSec).toBeGreaterThanOrEqual(3);
		expect(cue.startSec + cue.durationSec).toBeLessThanOrEqual(5);
		expect(cue.caption?.provenance.wordTimingOrigin).toBe("estimated");
	}
});
test("repeated projections retain corrections and explicit deletions", () => {
	let result = withGeneratedNarrationCaptions(doc(), fresh, applyCommand);
	const id = result.clips.find((clip) => clip.type === "caption")!.id;
	const scope = () => ({ doc: result, slides: [], posts: [], mediaAssets: [] });
	result = applyCommand(scope(), editCaptions({ action: "update", id, text: "Corrected" })).doc;
	expect(withGeneratedNarrationCaptions(result, fresh, applyCommand)).toBe(result);
	result = applyCommand(scope(), editCaptions({ action: "delete", ids: [id] })).doc;
	expect(withGeneratedNarrationCaptions(result, fresh, applyCommand)).toBe(result);
	expect(result.clips.some((clip) => clip.type === "caption")).toBe(false);
});
