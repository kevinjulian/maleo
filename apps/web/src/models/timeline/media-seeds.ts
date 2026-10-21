/* What each writer admits, as a decision separate from the writing.
 *
 * The rule "every path that introduces media admits it and records the
 * identity" is enforced per writer, and most of those writers are React hooks
 * holding busy maps and calling the network — not reachable from a test without
 * mounting the editor. The part worth pinning is not the setter call, it is the
 * seed: what label, what kind, which audio track, and above all which URL, since
 * admission dedups on URL and the whole invariant rests on that.
 *
 * So the decision lives here as a plain function per writer, and the hook does
 * `ensureMediaAsset(seedFor…(…))`. A test drives the seed, admits it, and
 * asserts `planMediaReconcile` finds nothing on the clip built from it — which
 * is the same assertion the drivable writers get. */
import type { AudioOverlayKind } from "@maleo/shared/audio-overlays";
import type { MediaAssetSeed } from "@models/timeline/media-admission.ts";

/** Labels are what the panel shows, so a whole voiceover script is not one.
 *  Truncated rather than dropped: the first words identify the clip. */
const LABEL_MAX = 60;

export function mediaLabel(raw: string | undefined, fallback: string): string {
	const trimmed = raw?.trim();
	return trimmed ? trimmed.slice(0, LABEL_MAX) : fallback;
}

/** A synthesised voiceover, or any audio clip whose media a writer produced.
 *  `audioKind` rides along because nothing about an mp3 says whether it is a bed
 *  or a sound effect, and the panel needs to know. */
export function seedForGeneratedAudio(input: {
	url: string;
	content?: string;
	kind: AudioOverlayKind;
	durationSec?: number;
}): MediaAssetSeed {
	return {
		label: mediaLabel(input.content, input.kind === "voiceover" ? "Voiceover" : "Audio"),
		url: input.url,
		kind: "audio",
		audioKind: input.kind,
		dur: input.durationSec,
		source: "generated",
	};
}

/** A generated scene frame. The end slot is labelled apart from the start slot
 *  so two frames of one beat are distinguishable in the panel. */
export function seedForSceneFrame(input: {
	url: string;
	sceneName?: string;
	slot: "start" | "end";
}): MediaAssetSeed {
	const name = mediaLabel(input.sceneName, "Scene");
	return {
		label: input.slot === "end" ? `${name} end frame` : name,
		url: input.url,
		kind: "image",
		source: "generated",
	};
}

/** Generated video keeps its server poster separate from the input scene image. */
export function seedForGeneratedVideo(input: {
	url: string;
	label?: string;
	thumb?: string;
	poster?: string;
	durationSec?: number;
}): MediaAssetSeed {
	return {
		label: mediaLabel(input.label, "Video"),
		url: input.url,
		kind: "video",
		thumb: input.thumb,
		poster: input.poster,
		dur: input.durationSec,
		source: "generated",
	};
}

/** Media the chat produced as an artifact. One entry point for all three media
 *  types, because the panel's Add button does not know which it is until it
 *  reads the artifact. */
export function seedForArtifact(input: {
	url: string;
	mediaType?: string;
	label?: string;
	durationSec?: number;
}): MediaAssetSeed {
	const kind =
		input.mediaType === "audio" ? "audio" : input.mediaType === "video" ? "video" : "image";
	return {
		label: mediaLabel(input.label, "Media"),
		url: input.url,
		kind,
		dur: input.durationSec,
		source: "generated",
	};
}
