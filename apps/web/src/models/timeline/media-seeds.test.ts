/* The net should catch nothing.
 *
 * Each of these takes the seed a writer admits, admits it, builds the clip that
 * writer builds, and asserts `planMediaReconcile` finds nothing. That is the
 * same assertion the drivable writers get in `use-visual-clip-ops.test.ts` and
 * `apply-agent-job.test.ts`; here it reaches the four writers that live inside
 * React hooks holding busy maps and calling the network — `regenAudio`,
 * `use-scene-generation`, caption realignment, and the chat artifact button.
 *
 * What that leaves untested is the line of wiring between the seed and the
 * setter in each hook. What it does cover is the part that can actually be
 * wrong in a way the reconciler would silently paper over: the URL, since
 * admission dedups on URL and the whole invariant rests on it, and the kind and
 * audio track, which decide what the panel shows.
 *
 * These fail against the pre-change writers, none of which admitted at all. */
import { describe, expect, test } from "vite-plus/test";
import {
	mediaLabel,
	seedForArtifact,
	seedForGeneratedAudio,
	seedForGeneratedVideo,
	seedForSceneFrame,
} from "./media-seeds.ts";
import { admitMediaAsset, type MediaAssetSeed } from "./media-admission.ts";
import { planMediaReconcile } from "./media-reconcile.ts";
import type { MediaAsset } from "./editor-media.ts";
import type { AudioOverlay, Scene, VideoOverlay } from "@maleo/shared";

function library() {
	let assets: MediaAsset[] = [];
	return {
		admit: (seed: MediaAssetSeed): string => {
			const r = admitMediaAsset(assets, seed);
			assets = r.assets;
			return r.id;
		},
		assets: () => assets,
	};
}

const scene = (over: Partial<Scene> = {}): Scene => ({
	id: 1,
	dur: 3,
	name: "Beat",
	shot: "Medium Shot",
	move: "Static",
	vis: "",
	vo: "",
	img: false,
	...over,
});

const clean = (input: {
	scenes?: Scene[];
	videoOverlays?: VideoOverlay[];
	audioOverlays?: AudioOverlay[];
	assets: MediaAsset[];
}): void => {
	expect(
		planMediaReconcile({
			scenes: input.scenes ?? [],
			videoOverlays: input.videoOverlays ?? [],
			audioOverlays: input.audioOverlays ?? [],
			assets: input.assets,
		}),
	).toBeNull();
};

describe("regenAudio: a synthesised voiceover", () => {
	test("is admitted as audio on the clip's own track, and leaves nothing to repair", () => {
		const lib = library();
		const clip: AudioOverlay = {
			id: 5,
			kind: "voiceover",
			content: "Once upon a time",
			start: 0,
			dur: 2,
		};
		const url = "/uploads/tts-5.wav";

		const seed = seedForGeneratedAudio({
			url,
			content: clip.content,
			kind: clip.kind,
			durationSec: 4.2,
		});
		expect(seed).toMatchObject({
			url,
			kind: "audio",
			audioKind: "voiceover",
			dur: 4.2,
			source: "generated",
		});
		expect(seed.label).toBe("Once upon a time");

		const mediaAssetId = lib.admit(seed);
		clean({ audioOverlays: [{ ...clip, url, mediaAssetId, dur: 4.2 }], assets: lib.assets() });
	});

	test("a sound effect keeps its track, so the panel does not file it as music", () => {
		const seed = seedForGeneratedAudio({
			url: "/uploads/whoosh.mp3",
			content: "whoosh",
			kind: "sfx",
		});
		expect(seed.audioKind).toBe("sfx");
	});

	test("regenerating the same clip twice admits one asset", () => {
		// TTS is deterministic enough to return the same file, and a second
		// admission that minted a second identity would leave a duplicate in the
		// panel that no clip points at.
		const lib = library();
		const seed = (): MediaAssetSeed =>
			seedForGeneratedAudio({ url: "/uploads/tts-5.wav", content: "VO", kind: "voiceover" });
		expect(lib.admit(seed())).toBe(lib.admit(seed()));
		expect(lib.assets()).toHaveLength(1);
	});

	test("a whole script does not become the label", () => {
		const script = "a".repeat(400);
		expect(
			seedForGeneratedAudio({ url: "/u/a.wav", content: script, kind: "voiceover" }).label,
		).toHaveLength(60);
	});
});

describe("use-scene-generation: a generated frame", () => {
	test.each([2, 7])(
		"four-second video admission stays separate from %ss placement",
		(placement) => {
			const lib = library();
			const seed = seedForGeneratedVideo({ url: "/api/media/mock-video", durationSec: 4 });
			const mediaAssetId = lib.admit(seed);
			expect(lib.assets()[0]?.dur).toBe(4);
			clean({
				videoOverlays: [
					{
						id: 1,
						url: seed.url,
						kind: "video",
						start: 0,
						dur: placement,
						sourceDurationSec: 4,
						mediaAssetId,
					},
				],
				assets: lib.assets(),
			});
		},
	);
	test("both slots admit, and a scene carrying both identities leaves nothing to repair", () => {
		const lib = library();
		const start = lib.admit(
			seedForSceneFrame({ url: "/uploads/start.png", sceneName: "Opening", slot: "start" }),
		);
		const end = lib.admit(
			seedForSceneFrame({ url: "/uploads/end.png", sceneName: "Opening", slot: "end" }),
		);

		expect(start).not.toBe(end);
		clean({
			scenes: [
				scene({
					img: true,
					src: "/uploads/start.png",
					mediaAssetId: start,
					endSrc: "/uploads/end.png",
					endMediaAssetId: end,
					visualClips: [
						{
							id: "scene-1-visual-primary",
							kind: "image",
							label: "Opening",
							url: "/uploads/start.png",
							mediaAssetId: start,
							startSec: 0,
							durationSec: 3,
							primary: true,
						},
					],
				}),
			],
			assets: lib.assets(),
		});
	});

	test("the two frames of one beat are distinguishable in the panel", () => {
		expect(seedForSceneFrame({ url: "/u/a.png", sceneName: "Opening", slot: "start" }).label).toBe(
			"Opening",
		);
		expect(seedForSceneFrame({ url: "/u/b.png", sceneName: "Opening", slot: "end" }).label).toBe(
			"Opening end frame",
		);
	});

	test("an animated frame admits its server poster separately from the input image", () => {
		const lib = library();
		const seed = seedForGeneratedVideo({
			url: "/uploads/anim.mp4",
			label: "Opening (video)",
			thumb: "/uploads/start.png",
			poster: "/api/media/poster",
			durationSec: 3,
		});
		expect(seed).toMatchObject({
			kind: "video",
			thumb: "/uploads/start.png",
			poster: "/api/media/poster",
			dur: 3,
			source: "generated",
		});

		const mediaAssetId = lib.admit(seed);
		expect(lib.assets()[0]?.poster).toBe("/api/media/poster");
		const overlay: VideoOverlay = {
			id: 9,
			url: "/uploads/anim.mp4",
			mediaAssetId,
			kind: "video",
			start: 0,
			dur: 3,
			source: "generated",
		};
		clean({ videoOverlays: [overlay], assets: lib.assets() });
	});
});

describe("caption realignment: a repaired audio clip", () => {
	test("acquires an identity for media it did not have before", () => {
		const lib = library();
		const clip: AudioOverlay = {
			id: 5,
			kind: "voiceover",
			content: "VO",
			url: "/uploads/pre.wav",
			start: 0,
			dur: 2,
		};
		expect(
			planMediaReconcile({ scenes: [], videoOverlays: [], audioOverlays: [clip], assets: [] }),
		).not.toBeNull();

		const mediaAssetId = lib.admit(
			seedForGeneratedAudio({
				url: clip.url!,
				content: clip.content,
				kind: clip.kind,
				durationSec: clip.dur,
			}),
		);
		clean({ audioOverlays: [{ ...clip, mediaAssetId }], assets: lib.assets() });
	});

	test("a re-encode to a new URL admits the new file rather than keeping a stale identity", () => {
		// Realignment rewrites `url` field by field. Keeping the old identity would
		// leave the clip naming an asset that is not the file it now plays.
		const lib = library();
		const before = lib.admit(
			seedForGeneratedAudio({ url: "/uploads/pre.wav", content: "VO", kind: "voiceover" }),
		);
		const after = lib.admit(
			seedForGeneratedAudio({ url: "/uploads/repaired.wav", content: "VO", kind: "voiceover" }),
		);

		expect(after).not.toBe(before);
		clean({
			audioOverlays: [
				{
					id: 5,
					kind: "voiceover",
					content: "VO",
					url: "/uploads/repaired.wav",
					mediaAssetId: after,
					start: 0,
					dur: 2,
				},
			],
			assets: lib.assets(),
		});
	});
});

describe("chat artifact: media the run produced", () => {
	test("each media type admits under its own kind", () => {
		expect(seedForArtifact({ url: "/u/a.wav", mediaType: "audio" }).kind).toBe("audio");
		expect(seedForArtifact({ url: "/u/a.mp4", mediaType: "video" }).kind).toBe("video");
		expect(seedForArtifact({ url: "/u/a.png", mediaType: "image" }).kind).toBe("image");
		// An artifact with no declared type is a frame; the panel's Add button
		// routes it to `addSceneWithMedia`, which is an image placement.
		expect(seedForArtifact({ url: "/u/a.png" }).kind).toBe("image");
	});

	test("placing an audio artifact leaves nothing to repair", () => {
		const lib = library();
		const mediaAssetId = lib.admit(
			seedForArtifact({
				url: "/uploads/art.wav",
				mediaType: "audio",
				label: "Narration",
				durationSec: 4,
			}),
		);
		clean({
			audioOverlays: [
				{
					id: 1,
					kind: "voiceover",
					content: "Narration",
					url: "/uploads/art.wav",
					mediaAssetId,
					start: 0,
					dur: 4,
				},
			],
			assets: lib.assets(),
		});
	});

	test("placing a video artifact leaves nothing to repair", () => {
		const lib = library();
		const mediaAssetId = lib.admit(
			seedForArtifact({
				url: "/uploads/art.mp4",
				mediaType: "video",
				label: "Clip",
				durationSec: 5,
			}),
		);
		clean({
			videoOverlays: [
				{
					id: 1,
					url: "/uploads/art.mp4",
					mediaAssetId,
					kind: "video",
					label: "Clip",
					start: 0,
					dur: 5,
					source: "generated",
				},
			],
			assets: lib.assets(),
		});
	});
});

describe("labels", () => {
	test("blank and whitespace fall back rather than showing an empty cell", () => {
		expect(mediaLabel(undefined, "Media")).toBe("Media");
		expect(mediaLabel("   ", "Media")).toBe("Media");
		expect(mediaLabel(" Named ", "Media")).toBe("Named");
	});
});
