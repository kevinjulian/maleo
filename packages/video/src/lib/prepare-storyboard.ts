// Make a raw storyboard renderable: prep (and reuse) images, synthesize the
// voiceover, and align scene durations + caption word timings to the real audio.
// Runs before the Remotion render so the composition just plays prepared assets.
//
// Image reuse is free: prepareAll caches by content+aspect, so the same image
// URL across many scenes is prepped once and reused instantly.
import type { Aspect, CaptionWord, Storyboard } from "../schema";
import { prepareAll } from "./image-prep";
import { resolveSceneImage } from "./scene-images";
import { synthesizeStoryboard, type SceneVoiceover } from "./tts";
import { transcribe } from "./transcribe";
import { storyboardSeconds } from "./duration";

// Convert an absolute prepped-asset path to a path relative to public/, which is
// what staticFile() in the composition expects. Leaves URLs/relative paths as-is.
function toPublicRelative(p: string): string {
	if (/^(https?:|data:|blob:|file:)/.test(p)) return p;
	const norm = p.replace(/\\/g, "/");
	const i = norm.lastIndexOf("/public/");
	if (i >= 0) return norm.slice(i + "/public/".length);
	// Relative path like "public/images/x.jpg" (no leading slash).
	if (norm.startsWith("public/")) return norm.slice("public/".length);
	return norm;
}

// Resolve a generated asset (image/audio under public/) to the URL the renderer
// will fetch. When MALEO_VIDEO_PUBLIC_BASE is set (server worker), local files
// become absolute HTTP URLs served live — Remotion's bundle only snapshots
// public/ at warm time, so per-job files must be fetched over HTTP. Without it
// (CLI render against a live public/), the staticFile-relative path is kept.
function toAssetUrl(p: string): string {
	if (/^(https?:|data:|blob:|file:)/.test(p)) return p;
	const rel = toPublicRelative(p);
	const base = process.env.MALEO_VIDEO_PUBLIC_BASE?.replace(/\/$/, "");
	return base ? `${base}/${rel}` : rel;
}

function compactUnique(values: Array<string | undefined>): string[] {
	return [...new Set(values.filter((v): v is string => Boolean(v)))];
}

function mapPreparedAsset(url: string | undefined, byUrl: Map<string, string>): string | undefined {
	return url ? (byUrl.get(url) ?? url) : url;
}

export function wordCount(text: string): number {
	const t = text.trim();
	return t ? t.split(/\s+/).length : 0;
}

// Distribute a scene's words across its [startSec, endSec] window, weighted by
// word length so captions track speech better than an equal split (longer words
// take longer to say). No paid transcription needed; a real word-level pass
// (Whisper) overrides this when OPENAI_API_KEY is set.
export function wordsForScene(text: string, startSec: number, endSec: number): CaptionWord[] {
	const tokens = text.trim().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return [];
	const span = Math.max(0.001, endSec - startSec);
	// Weight by characters + 1 (every word costs at least one slot) so a 9-letter
	// word holds the caption ~3x longer than a 2-letter one.
	const weights = tokens.map((w) => w.replace(/[^A-Za-z0-9]/g, "").length + 1);
	const total = weights.reduce((a, b) => a + b, 0);
	let cursor = startSec;
	return tokens.map((w, i) => {
		const dur = (weights[i]! / total) * span;
		const startW = cursor;
		cursor += dur;
		return { text: w, startSec: startW, endSec: cursor };
	});
}

// Audio outcome for the prep, surfaced so the worker can mark a job
// `done_with_fallback` instead of silently shipping a muted video.
//  - "present":         voiceover synthesized and aligned
//  - "fallback_silent": scenes had narration but no TTS provider was reachable
//  - "none":            storyboard had no narration to begin with
export type AudioStatus = "present" | "fallback_silent" | "none";

export interface PrepareStoryboardResult {
	storyboard: Storyboard;
	totalDurationSec: number;
	uniqueImages: number;
	reusedScenes: number;
	audioStatus: AudioStatus;
	generatedImages: number;
	// Count of freshly-generated images that fell back to a local placeholder
	// (image service unreachable / failed). >0 means degraded visuals.
	placeholderImages: number;
}

// Pipeline stages surfaced to the caller (worker) so the UI can show "where" a
// prep is, with a human detail (e.g. image 3/10). Mirrors the job phases.
export type PrepareStage = "preparing_images" | "synthesizing_audio" | "aligning_captions";

// Per-image generation state, surfaced so the UI can show a pill per pending
// image (not just an aggregate counter).
export type ImageItemStatus = "pending" | "generating" | "done" | "placeholder";

export interface ImageItemProgress {
	label: string;
	status: ImageItemStatus;
}

export interface PrepareProgress {
	stage: PrepareStage;
	/** 0..1 within the stage when known (image gen), else undefined. */
	fraction?: number;
	detail?: string;
	/** Per-image snapshot during the preparing_images stage. */
	items?: ImageItemProgress[];
}

// When there's no audio to time against, give each scene a duration based on
// its narration length (longer line = longer on screen), clamped, and optionally
// scaled so the whole video hits a target total (e.g. exactly ~60s). Avoids the
// robotic constant-4s look.
function silentDurations(
	scenes: ReadonlyArray<{ voiceover: string; durationSec: number }>,
	targetTotalSec?: number,
): number[] {
	const MIN = 2.5,
		MAX = 9;
	const raw = scenes.map((s) => {
		const w = wordCount(s.voiceover);
		// ~2.6 words/sec narration pace; fall back to the scene's own duration.
		const est = w > 0 ? w / 2.6 : s.durationSec;
		return Math.min(MAX, Math.max(MIN, est));
	});
	if (!targetTotalSec || raw.length === 0) return raw;
	const sum = raw.reduce((a, b) => a + b, 0);
	const scale = targetTotalSec / sum;
	return raw.map((d) => Math.min(MAX * 1.5, Math.max(1.5, d * scale)));
}

export async function prepareStoryboard(
	input: Storyboard,
	opts?: {
		aspect?: Aspect;
		placeholderOnly?: boolean;
		/** Re-attempt the image service for cached placeholders (see scene-images). */
		retryPlaceholders?: boolean;
		targetDurationSec?: number;
		onProgress?: (p: PrepareProgress) => void;
	},
): Promise<PrepareStoryboardResult> {
	const aspect = opts?.aspect ?? "horizontal"; // 16:9 long-format default
	// Absolute scene starts mark an authored timeline; preparation must not retime it.
	const hasAuthoredTiming = input.scenes.some((scene) => scene.startSec != null);
	input = {
		...input,
		scenes: input.scenes.map((scene) => {
			const primaryVisual =
				scene.visualClips?.find((clip) => clip.primary)?.url ?? scene.visualClips?.[0]?.url;
			const mergedVoiceover = scene.audioClips
				?.filter((clip) => clip.kind === "voiceover")
				.map((clip) => clip.content.trim())
				.filter(Boolean)
				.join(" ")
				.trim();
			const sfxUrl =
				scene.audioClips?.find((clip) => clip.kind === "sfx" && clip.url)?.url ?? scene.sfxUrl;
			return {
				...scene,
				image: primaryVisual ?? scene.image,
				voiceover: mergedVoiceover || scene.voiceover,
				sfxUrl,
			};
		}),
	};

	// 0. Per-scene image generation: any scene without an image but with a visual
	// description gets one (image service or local placeholder). Cached by visual,
	// so scenes sharing a description reuse the same generated image.
	//
	// Default concurrency is 1: the image backend (Gemini) generates one image at
	// a time, so firing all scenes at once makes the later ones' poll windows
	// expire while they're still queued (-> placeholder fallback). Raise via
	// MALEO_IMAGE_CONCURRENCY only when the backend can serve parallel requests.
	// Progress is reported per completed image regardless of concurrency.
	const pending: { visual: string; label: string }[] = [];
	const seen = new Set<string>();
	for (const s of input.scenes) {
		if (s.image && s.image.length > 0) continue;
		if (!s.visual || s.visual.trim().length === 0) continue;
		if (seen.has(s.visual)) continue;
		seen.add(s.visual);
		pending.push({ visual: s.visual, label: s.label });
	}

	const imageByVisual = new Map<string, string>();
	let placeholderImages = 0;
	const totalToGen = pending.length;
	if (totalToGen > 0) {
		const itemStatus: ImageItemStatus[] = pending.map(() => "pending");
		const snapshot = (): ImageItemProgress[] =>
			pending.map((p, i) => ({ label: p.label || "scene", status: itemStatus[i]! }));
		const emit = (done: number) =>
			opts?.onProgress?.({
				stage: "preparing_images",
				fraction: done / totalToGen,
				detail: `${done}/${totalToGen}`,
				items: snapshot(),
			});
		emit(0);
		const concurrency = Math.max(1, parseInt(process.env.MALEO_IMAGE_CONCURRENCY ?? "1", 10) || 1);
		let done = 0;
		let cursor = 0;
		const runOne = async (): Promise<void> => {
			while (cursor < pending.length) {
				const idx = cursor++;
				const item = pending[idx]!;
				itemStatus[idx] = "generating";
				emit(done);
				const resolved = await resolveSceneImage(item.visual, item.label, {
					aspect,
					placeholderOnly: opts?.placeholderOnly,
					retryPlaceholder: opts?.retryPlaceholders,
				});
				imageByVisual.set(item.visual, resolved.path);
				const placeholder = resolved.source === "placeholder";
				if (placeholder) placeholderImages++;
				itemStatus[idx] = placeholder ? "placeholder" : "done";
				done++;
				emit(done);
			}
		};
		await Promise.all(
			Array.from({ length: Math.min(concurrency, pending.length) }, () => runOne()),
		);
	}
	const scenesWithImages = input.scenes.map((s) =>
		s.image && s.image.length > 0
			? s
			: { ...s, image: imageByVisual.get(s.visual ?? "") ?? s.image },
	);
	input = { ...input, scenes: scenesWithImages };

	// 1. Prep unique images once, map URL -> local path (reuse hits the cache).
	const sceneImageUrls = compactUnique(input.scenes.map((s) => s.image));
	const sceneVisualClipUrls = compactUnique(
		input.scenes.flatMap((s) =>
			(s.visualClips ?? [])
				.filter((clip) => (clip.kind ?? "image") === "image")
				.map((clip) => clip.url),
		),
	);
	const transitionPlateUrls = compactUnique(
		input.scenes.map((s) => s.sectionTransition?.plateImageUrl),
	);
	const visualTimelineUrls = compactUnique(
		(input.visualTimeline ?? []).filter((clip) => clip.kind === "image").map((clip) => clip.url),
	);
	const videoOverlayImageUrls = compactUnique(
		(input.videoOverlays ?? [])
			.filter((clip) => clip.kind === "image")
			.flatMap((clip) => [clip.url, clip.thumb]),
	);
	const uniqueUrls = compactUnique([
		...sceneImageUrls,
		...sceneVisualClipUrls,
		...transitionPlateUrls,
		...visualTimelineUrls,
		...videoOverlayImageUrls,
	]);
	const prepped = await prepareAll(uniqueUrls, aspect, {
		removeBg: false,
		upscale: false,
		preserveSource: true,
	});
	const pathByUrl = new Map<string, string>();
	uniqueUrls.forEach((url, i) => pathByUrl.set(url, toAssetUrl(prepped[i] ?? url)));
	const reusedScenes = input.scenes.length - sceneImageUrls.length;

	// 2. Synthesize the full voiceover and get per-scene boundaries.
	const sceneVO: SceneVoiceover[] = input.scenes.map((s) => ({
		text: s.voiceover,
		wordCount: Math.max(1, wordCount(s.voiceover)),
	}));
	const hasVO = !hasAuthoredTiming && input.scenes.some((s) => s.voiceover.trim().length > 0);
	// TTS is best-effort: if no provider is reachable, render silent with captions
	// timed to each scene's own duration instead of failing the whole job.
	let tts: Awaited<ReturnType<typeof synthesizeStoryboard>> | null = null;
	if (hasVO) {
		opts?.onProgress?.({ stage: "synthesizing_audio" });
		try {
			tts = await synthesizeStoryboard(sceneVO);
		} catch (e) {
			console.warn(
				`[prepare-storyboard] TTS unavailable, rendering silent: ${e instanceof Error ? e.message : String(e)}`,
			);
		}
	}

	// 3. Rebuild scenes: local image, audio-aligned duration. Collect caption words.
	// With audio: align to TTS boundaries. Without: keep scene durations and time
	// captions within each scene so they still track the visuals.
	const words: CaptionWord[] = [];
	let cursor = 0;
	// Varied per-scene durations for the silent path (audio path uses TTS bounds).
	const silent = hasAuthoredTiming
		? input.scenes.map((s) => s.durationSec)
		: tts
			? null
			: silentDurations(input.scenes, opts?.targetDurationSec);
	const scenes = input.scenes.map((s, i) => {
		const bound = tts?.sceneBoundaries[i];
		const durationSec = bound
			? Math.max(1, bound.endSec - bound.startSec)
			: (silent?.[i] ?? s.durationSec);
		const start = bound ? bound.startSec : cursor;
		const end = bound ? bound.endSec : cursor + durationSec;
		if (!hasAuthoredTiming && s.voiceover.trim())
			words.push(...wordsForScene(s.voiceover, start, end));
		cursor = end;
		const transition = s.sectionTransition?.plateImageUrl
			? {
					...s.sectionTransition,
					plateImageUrl: mapPreparedAsset(s.sectionTransition.plateImageUrl, pathByUrl),
				}
			: s.sectionTransition;
		return {
			...s,
			image: s.image ? (mapPreparedAsset(s.image, pathByUrl) ?? s.image) : s.image,
			visualClips: s.visualClips?.map((clip) => ({
				...clip,
				url:
					(clip.kind ?? "image") === "image"
						? (mapPreparedAsset(clip.url, pathByUrl) ?? clip.url)
						: clip.url,
			})),
			sectionTransition: transition,
			durationSec,
		};
	});

	// True audio-synced captions: transcribe the rendered voiceover for real
	// word-level timestamps and replace the weighted estimate. Whisper-gated on
	// OPENAI_API_KEY; on any failure we keep the estimate so captions never break.
	if (tts && process.env.OPENAI_API_KEY) {
		opts?.onProgress?.({ stage: "aligning_captions" });
		try {
			const captionText = input.scenes
				.map((s) => s.voiceover.trim())
				.filter(Boolean)
				.join(". ");
			const tr = await transcribe({ audioPath: tts.audioPath, text: captionText });
			if (tr.words.length > 0) {
				words.length = 0;
				words.push(...tr.words);
			}
		} catch (e) {
			console.warn(
				`[prepare-storyboard] caption transcription failed, using estimate: ${e instanceof Error ? e.message : String(e)}`,
			);
		}
	}

	const audioStatus: AudioStatus = !hasVO ? "none" : tts ? "present" : "fallback_silent";

	const totalDurationSec = hasAuthoredTiming
		? storyboardSeconds({ ...input, scenes })
		: tts
			? tts.totalDurationSec
			: scenes.reduce((sum, s) => sum + s.durationSec, 0);

	const fullText = input.scenes
		.map((s) => s.voiceover.trim())
		.filter(Boolean)
		.join(". ");
	const storyboard: Storyboard = {
		...input,
		scenes,
		visualTimeline: input.visualTimeline?.map((clip) => ({
			...clip,
			url: clip.kind === "image" ? (mapPreparedAsset(clip.url, pathByUrl) ?? clip.url) : clip.url,
		})),
		videoOverlays: input.videoOverlays?.map((clip) => ({
			...clip,
			url: clip.kind === "image" ? (mapPreparedAsset(clip.url, pathByUrl) ?? clip.url) : clip.url,
			thumb: clip.kind === "image" ? mapPreparedAsset(clip.thumb, pathByUrl) : clip.thumb,
		})),
		voiceover:
			words.length > 0
				? {
						text: fullText,
						// Live HTTP URL (server worker) or staticFile-relative (CLI render).
						audioUrl: tts ? toAssetUrl(tts.audioPath) : undefined,
						startSec: 0,
						endSec: tts ? tts.totalDurationSec : cursor,
						words,
					}
				: input.voiceover,
	};

	return {
		storyboard,
		totalDurationSec,
		uniqueImages: uniqueUrls.length,
		reusedScenes,
		audioStatus,
		generatedImages: imageByVisual.size,
		placeholderImages,
	};
}
