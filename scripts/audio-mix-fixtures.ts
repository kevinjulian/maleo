import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
	timelineAudioGain,
	sampleClipProperty,
	type AudioAnimation,
	buildRenderStoryboardFromDoc,
	timelineAudioSources,
	processedAudioSource,
	type TimelineDoc,
	type TrackFlags,
	type DialoguePriorityKind,
} from "../packages/shared/src/index.ts";
import { duckEnvelope } from "../packages/video/src/lib/music.ts";

const fixtures = [];
for (const fps of [24, 30, 60])
	for (const kind of ["voiceover", "music", "ambient", "sfx", "accent_hit"] as const)
		for (const easing of ["linear", "in", "out", "in-out", "bezier", "hold"] as const)
			for (const mode of ["overlay", "native", "legacy-music"] as const) {
				if (mode === "native" && kind !== "sfx") continue;
				if (mode === "legacy-music" && (kind !== "music" || easing !== "linear")) continue;
				const keys: NonNullable<AudioAnimation["tracks"]["volume"]> = [
					{ t: 0, v: 0.2 },
					{ t: 1, v: 0.9, easing, easingRange: [0.2, 0.8] },
					{ t: 2.5, v: 0.6, easing: "hold" as const },
				];
				const animation: AudioAnimation = { tracks: { volume: keys } };
				const clip = {
					kind,
					startSec: 1.2,
					durationSec: 3,
					volume: 0.7,
					fadeInSec: 0.4,
					fadeOutSec: 0.6,
					animation,
					duckUnderVoice: easing === "hold" ? 1 : easing === "bezier" ? 0 : undefined,
				};
				const ranges =
					easing === "linear"
						? []
						: [
								{ startSec: 0.5, endSec: 1.8 },
								{ startSec: 2.4, endSec: 4.5 },
							];
				const source = {
					path: "audioOverlays[0]",
					url: "fixture.wav",
					startFrame: Math.floor(clip.startSec * fps),
					frames: Math.floor(clip.durationSec * fps),
					mediaStartSec: 0.3,
					playbackRate: { voiceover: 0.25, music: 0.5, ambient: 1, sfx: 2, accent_hit: 4 }[kind],
					loopSource: kind === "music",
					embedded: mode === "native",
					kind,
					gainMode: mode,
					volume: clip.volume,
					volumeKeys: keys,
					fadeInSec: clip.fadeInSec,
					fadeOutSec: clip.fadeOutSec,
					duckUnderVoice: clip.duckUnderVoice ?? null,
				};
				const mix = {
					fps,
					frames: fps * 6,
					sources: [source],
					voiceoverRanges: ranges,
					legacyVoiceover: ranges[0],
				};
				const samples = [
					-1,
					0,
					1,
					Math.floor(0.4 * fps),
					fps,
					Math.floor(1.2 * fps),
					2 * fps,
					Math.floor(2.5 * fps),
					source.frames - 1,
					source.frames,
				].map((local) => {
					const frame = source.startFrame + local;
					const gain =
						local < 0 || local >= source.frames
							? 0
							: mode === "overlay"
								? timelineAudioGain(clip, local, fps, ranges)
								: mode === "legacy-music"
									? duckEnvelope(frame, fps, ranges.slice(0, 1))
									: sampleClipProperty(animation, "volume", local / fps, clip.volume);
					assert(Number.isFinite(gain));
					return { frame, gain, time: source.mediaStartSec + (local * source.playbackRate) / fps };
				});
				fixtures.push({ mix, samples });
			}
const path = new URL("../crates/media/tests/fixtures/audio-gain.json", import.meta.url);
const content = execFileSync("bunx", ["vp", "fmt", `--stdin-filepath=${fileURLToPath(path)}`], {
	input: JSON.stringify(fixtures),
	encoding: "utf8",
	maxBuffer: 8 * 1024 * 1024,
});
if (process.argv.includes("--check")) assert.equal(readFileSync(path, "utf8"), content);
else writeFileSync(path, content);
console.log(
	`${fixtures.length} audio gain cases / ${fixtures.reduce((sum, value) => sum + value.samples.length, 0)} reference samples`,
);

const audioClip = (
	id: number,
	kind: DialoguePriorityKind,
	start: number,
	duration: number,
	volume = 1,
) => ({
	id: `audio:${id}`,
	type: "audio" as const,
	startSec: start,
	durationSec: duration,
	track: id,
	audio: {
		id,
		kind,
		content: kind,
		url: `${kind}-${id}.wav`,
		start,
		dur: duration,
		volume,
		fadeIn: 0.2,
		fadeOut: 0.3,
	},
});
const document: TimelineDoc = {
	schemaVersion: 2,
	markers: [],
	clips: [
		audioClip(1, "voiceover", 1, 1),
		audioClip(2, "voiceover", 4, 1),
		audioClip(3, "music", 0, 6, 0.7),
		audioClip(4, "ambient", 0, 6, 0.6),
		audioClip(5, "sfx", 2, 0.5, 0.8),
		audioClip(6, "accent_hit", 3, 0.5, 0.8),
		{
			id: "video:1",
			type: "video",
			startSec: 1,
			durationSec: 2,
			track: 0,
			video: {
				id: 1,
				kind: "video",
				url: "native.mp4",
				start: 1,
				dur: 2,
				volume: 0.5,
				mediaStartSec: 0.25,
			},
		},
		{
			id: "scene:1",
			type: "image",
			startSec: 4,
			durationSec: 2,
			track: 0,
			scene: {
				id: 1,
				dur: 2,
				name: "Scene",
				shot: "",
				move: "Static",
				vis: "",
				vo: "",
				img: true,
				visualClips: [
					{
						id: "visual:1",
						kind: "video",
						url: "scene.mp4",
						label: "Scene source",
						startSec: 0,
						durationSec: 2,
					},
				],
			},
		},
	],
};
const refs = { images: [], speakers: [], notes: [], style: { tone: "", palette: "", music: "" } };
const projections = [];
for (const name of [
	"all",
	"muted",
	"hidden",
	"isolated-music",
	"extracted",
	"animated-zero",
	"derivative",
	"stale-derivative",
]) {
	const doc = structuredClone(document);
	const flags: TrackFlags =
		name === "muted"
			? { [-1]: { muted: true }, 0: { muted: true }, 1: { muted: true } }
			: name === "hidden"
				? { [-1]: { hidden: true }, 0: { hidden: true }, 4: { hidden: true } }
				: name === "isolated-music"
					? Object.fromEntries([-1, 0, 1, 2, 4, 5, 6].map((track) => [track, { muted: true }]))
					: {};
	const native = doc.clips.find((clip) => clip.video)!.video!;
	if (name === "extracted")
		native.layout = {
			xPct: 0,
			yPct: 0,
			widthPct: 100,
			fit: "cover",
			sourceAudioExtraction: {
				audioClipId: "audio:5",
				priorVolume: 0.5,
				source: {
					url: native.url,
					startSec: 0.25,
					durationSec: 2,
					playbackRate: 1,
					preservePitch: false,
					reverse: false,
				},
				audioSnapshot: doc.clips[4]!.audio!,
			},
		};
	if (name === "animated-zero") {
		native.volume = 0;
		native.layout = {
			xPct: 0,
			yPct: 0,
			widthPct: 100,
			fit: "cover",
			animation: {
				tracks: {
					volume: [
						{ t: 0, v: 0 },
						{ t: 1, v: 0.8 },
					],
				},
			},
		};
	}
	if (name.endsWith("derivative")) {
		const music = doc.clips[2]!.audio!;
		music.playbackRate = 2;
		music.preservePitch = true;
		if (name === "derivative")
			music.audioMedia = {
				url: "/api/media/00000000-0000-0000-0000-000000000001",
				sourceUrl: music.url!,
				sourceRevision: "r1",
				startSec: 0,
				durationSec: 12,
				playbackRate: 2,
				preservePitch: true,
				reverse: false,
			};
	}
	const storyboard = buildRenderStoryboardFromDoc({ format: "9:16", length: "6" }, refs, doc, {
		trackFlags: flags,
	}).storyboard;
	const expected = timelineAudioSources(doc, flags).map((input) => {
		const clip = doc.clips.find((clip) => clip.id === input.clipId)!;
		const retimed = clip.audio && ((clip.audio.playbackRate ?? 1) !== 1 || clip.audio.reverse);
		const mapped = retimed
			? processedAudioSource(input.url, input.mediaStartSec, input.durationSec, clip.audio!)
			: undefined;
		return {
			path: "reference",
			url: mapped?.url ?? input.url,
			startFrame: Math.floor(input.startSec * 30),
			frames: Math.max(1, Math.floor(input.durationSec * 30)),
			mediaStartSec: Math.round((mapped?.mediaStartSec ?? input.mediaStartSec) * 30) / 30,
			playbackRate: mapped ? 1 : input.playbackRate,
			loopSource: input.loop,
			embedded: !clip.audio,
			kind: input.kind,
			gainMode: clip.audio ? "overlay" : "native",
			volume: input.volume,
			volumeKeys: input.animation?.tracks.volume ?? [],
			fadeInSec: input.fadeInSec,
			fadeOutSec: input.fadeOutSec,
			duckUnderVoice: clip.audio ? (input.duckUnderVoice ?? null) : null,
		};
	});
	const voiceoverRanges = (storyboard.audioOverlays ?? [])
		.filter((row) => row.kind === "voiceover")
		.map((row) => ({ startSec: row.startSec, endSec: row.startSec + row.durationSec }))
		.sort((a, b) => a.startSec - b.startSec);
	projections.push({
		name,
		storyboard,
		fps: 30,
		frames: 180,
		expected,
		voiceoverRanges,
		error: name === "stale-derivative",
	});
}
const projectionPath = new URL(
	"../crates/renderer/tests/fixtures/audio-projection.json",
	import.meta.url,
);
const projected = execFileSync(
	"bunx",
	["vp", "fmt", `--stdin-filepath=${fileURLToPath(projectionPath)}`],
	{ input: JSON.stringify(projections), encoding: "utf8" },
);
if (process.argv.includes("--check")) assert.equal(readFileSync(projectionPath, "utf8"), projected);
else writeFileSync(projectionPath, projected);
console.log(`${projections.length} document/render audio projection cases`);
