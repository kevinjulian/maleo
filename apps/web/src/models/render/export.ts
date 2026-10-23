/* Client-side DRAFT export: composites the storyboard onto a canvas frame by
 * frame and muxes H.264/AAC MP4 entirely in the browser via MediaBunny
 * (WebCodecs) — zero server queue. This is a fast preview artifact, not the
 * production render:
 *   - base-track images with the renderer's camera motion (Ken Burns presets)
 *   - hard cuts (no transitions), no effects/text overlays
 *   - fixed authored caption cues; caption styling and animation are omitted
 *   - full audio mix (voiceover/music/sfx with volume + fades + trim)
 * The server Remotion render remains the production path (WYSIWYG). */
import {
	ALL_FORMATS,
	AudioBufferSink,
	AudioBufferSource,
	BufferTarget,
	CanvasSource,
	Input,
	Mp4OutputFormat,
	Output,
	QUALITY_MEDIUM,
	UrlSource,
} from "mediabunny";
import { resolveMotion } from "@maleo/video/composition";
import type { Clip } from "@maleo/shared";

type MediaResolver = (
	url: string,
	stream?: boolean,
) => Promise<{ url: string; credentials: RequestCredentials }>;

export interface DraftScene {
	src?: string;
	start: number;
	dur: number;
	move?: string;
}
export interface DraftAudioClip {
	url?: string;
	start: number;
	dur: number;
	volume?: number;
	fadeIn?: number;
	fadeOut?: number;
	mediaStartSec?: number;
}
export interface DraftExportInput {
	scenes: DraftScene[];
	audio: DraftAudioClip[];
	captionCues: Clip[];
	width: number;
	height: number;
	fps: number;
	totalSec: number;
	onProgress?: (fraction: number, label: string) => void;
	resolveMedia: MediaResolver;
}

const AUDIO_SAMPLE_RATE = 44100;
// Caption band sizing relative to the frame.
const CAPTION_FONT_FRAC = 0.045;
const CAPTION_BOTTOM_FRAC = 0.12;
// Motion preset x/y offsets are authored against the 1080-wide render frame.
const MOTION_BASE_WIDTH = 1080;

async function loadImage(
	src: string,
	resolveMedia: MediaResolver,
): Promise<HTMLImageElement | null> {
	const target = await resolveMedia(src);
	return new Promise((resolve) => {
		const img = new Image();
		img.crossOrigin = "anonymous";
		img.onload = () => resolve(img);
		img.onerror = () => resolve(null);
		img.src = target.url;
	});
}

// Draw an image cover-fit with the scene's camera motion at progress p (0..1).
function drawSceneFrame(
	ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
	img: HTMLImageElement,
	w: number,
	h: number,
	move: string | undefined,
	p: number,
): void {
	const { from, to } = resolveMotion(move);
	const scale = from.scale + (to.scale - from.scale) * p;
	const px = (from.x + (to.x - from.x) * p) * (w / MOTION_BASE_WIDTH);
	const py = (from.y + (to.y - from.y) * p) * (w / MOTION_BASE_WIDTH);
	const cover = Math.max(w / img.naturalWidth, h / img.naturalHeight);
	const dw = img.naturalWidth * cover * scale;
	const dh = img.naturalHeight * cover * scale;
	ctx.drawImage(img, (w - dw) / 2 + px, (h - dh) / 2 + py, dw, dh);
}

export function draftCaptionText(cues: readonly Clip[], sec: number): string {
	return (
		cues.find((cue) => sec >= cue.startSec && sec < cue.startSec + cue.durationSec)?.caption
			?.text ?? ""
	);
}

function drawCaption(
	ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
	text: string,
	w: number,
	h: number,
): void {
	if (!text) return;
	const size = Math.round(h * CAPTION_FONT_FRAC);
	ctx.font = `700 ${size}px Inter, system-ui, sans-serif`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.lineWidth = Math.max(2, size / 8);
	ctx.strokeStyle = "rgba(0,0,0,0.85)";
	ctx.fillStyle = "#ffffff";
	const y = h * (1 - CAPTION_BOTTOM_FRAC);
	const lines = text.split("\n");
	const widest = Math.max(1, ...lines.map((line) => ctx.measureText(line).width));
	const fitted = size * Math.min(1, (w * 0.9) / widest, (h * 0.7) / (lines.length * size * 1.2));
	ctx.font = `700 ${fitted}px Inter, system-ui, sans-serif`;
	for (const [index, line] of lines.entries()) {
		const lineY = y - (lines.length - 1 - index) * fitted * 1.2;
		ctx.strokeText(line, w / 2, lineY);
		ctx.fillText(line, w / 2, lineY);
	}
}

// Schedule one audio clip into the offline mix: MediaBunny streams decoded
// chunks scheduled at their absolute offsets; a whole-file Web Audio decode is
// the fallback. Envelope (volume + fades) rides a per-clip gain node.
async function scheduleClip(
	ctx: OfflineAudioContext,
	clip: DraftAudioClip,
	resolveMedia: MediaResolver,
): Promise<void> {
	if (!clip.url || clip.dur <= 0) return;
	const gain = ctx.createGain();
	const vol = clip.volume ?? 1;
	const start = Math.max(0, clip.start);
	const end = start + clip.dur;
	const fadeIn = Math.min(clip.fadeIn ?? 0, clip.dur);
	const fadeOut = Math.min(clip.fadeOut ?? 0, clip.dur);
	gain.gain.setValueAtTime(fadeIn > 0 ? 0 : vol, start);
	if (fadeIn > 0) gain.gain.linearRampToValueAtTime(vol, start + fadeIn);
	if (fadeOut > 0) {
		gain.gain.setValueAtTime(vol, Math.max(start, end - fadeOut));
		gain.gain.linearRampToValueAtTime(0, end);
	}
	gain.connect(ctx.destination);
	const mediaStart = clip.mediaStartSec ?? 0;

	const scheduleBuffer = (buffer: AudioBuffer, at: number, offset: number, dur: number): void => {
		if (dur <= 0) return;
		const src = ctx.createBufferSource();
		src.buffer = buffer;
		src.connect(gain);
		src.start(Math.max(0, at), Math.max(0, offset), dur);
	};

	try {
		const target = await resolveMedia(clip.url, true);
		const input = new Input({
			formats: ALL_FORMATS,
			source: new UrlSource(target.url, {
				requestInit: { credentials: target.credentials },
				getRetryDelay: (n) => (n < 1 ? 0.2 : null),
			}),
		});
		try {
			const track = await input.getPrimaryAudioTrack();
			if (!track) throw new Error("no audio track");
			const sink = new AudioBufferSink(track);
			// Coalesce decoded chunks into ONE clip-length buffer and schedule a
			// single source. Scheduling one source per ~25ms chunk floods the
			// offline graph with tens of thousands of nodes on a long music bed,
			// and startRendering() then crawls for minutes (looks frozen).
			let merged: AudioBuffer | null = null;
			for await (const { buffer, timestamp } of sink.buffers(mediaStart, mediaStart + clip.dur)) {
				if (!merged) {
					merged = ctx.createBuffer(
						buffer.numberOfChannels,
						Math.ceil(clip.dur * buffer.sampleRate),
						buffer.sampleRate,
					);
				}
				const rel = timestamp - mediaStart; // chunk position inside the clip
				const dstStart = Math.round(rel * merged.sampleRate);
				for (let ch = 0; ch < merged.numberOfChannels; ch++) {
					const src = buffer.getChannelData(Math.min(ch, buffer.numberOfChannels - 1));
					const dst = merged.getChannelData(ch);
					// Clip head/tail: drop samples outside the clip window.
					const srcOffset = dstStart < 0 ? -dstStart : 0;
					const at = Math.max(0, dstStart);
					const count = Math.min(src.length - srcOffset, dst.length - at);
					if (count > 0) dst.set(src.subarray(srcOffset, srcOffset + count), at);
				}
			}
			if (!merged) throw new Error("no audio decoded");
			scheduleBuffer(merged, start, 0, clip.dur);
			return;
		} finally {
			input.dispose();
		}
	} catch {
		// Fallback: full decode, single source.
	}
	const fallback = await resolveMedia(clip.url, true);
	const raw = await (
		await fetch(fallback.url, { credentials: fallback.credentials })
	).arrayBuffer();
	const decoded = await ctx.decodeAudioData(raw);
	scheduleBuffer(
		decoded,
		start,
		mediaStart,
		Math.min(clip.dur, Math.max(0, decoded.duration - mediaStart)),
	);
}

// A clip that neither resolves nor rejects (edge-case network stall) must not
// freeze the whole export — cap each clip's scheduling time.
const CLIP_SCHEDULE_TIMEOUT_MS = 45_000;
// Clips decode independently — schedule a few in parallel (42 sequential
// accent hits would take minutes; the same urls are usually repeated).
const CLIP_SCHEDULE_CONCURRENCY = 4;

async function mixAudio(
	input: Pick<DraftExportInput, "audio" | "totalSec" | "onProgress" | "resolveMedia">,
): Promise<AudioBuffer | null> {
	const clips = input.audio.filter((a) => a.url && a.dur > 0);
	if (!clips.length) return null;
	const ctx = new OfflineAudioContext(
		2,
		Math.ceil(input.totalSec * AUDIO_SAMPLE_RATE),
		AUDIO_SAMPLE_RATE,
	);
	let doneCount = 0;
	let next = 0;
	const worker = async (): Promise<void> => {
		while (next < clips.length) {
			const clip = clips[next++]!;
			try {
				await Promise.race([
					scheduleClip(ctx, clip, input.resolveMedia),
					new Promise((_, reject) =>
						setTimeout(() => reject(new Error("clip schedule timeout")), CLIP_SCHEDULE_TIMEOUT_MS),
					),
				]);
			} catch (err) {
				throw new Error(
					`Audio clip failed: ${clip.url ?? "unknown"} (${err instanceof Error ? err.message : String(err)})`,
				);
			}
			doneCount++;
			input.onProgress?.(
				0.02 + 0.06 * (doneCount / clips.length),
				`mixing audio (${doneCount}/${clips.length})`,
			);
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(CLIP_SCHEDULE_CONCURRENCY, clips.length) }, worker),
	);
	input.onProgress?.(0.09, "rendering audio mix");
	return ctx.startRendering();
}

/** Render the storyboard to a draft MP4 Blob entirely in the browser. */
export async function exportDraft(input: DraftExportInput): Promise<Blob> {
	const { width, height, fps, totalSec, onProgress, resolveMedia } = input;
	if (totalSec <= 0) throw new Error("empty timeline");
	if (typeof VideoEncoder === "undefined")
		throw new Error("This browser has no WebCodecs support — use the server export.");

	onProgress?.(0, "mixing audio");
	const mixdown = await mixAudio(input);

	onProgress?.(0.1, "loading images");
	const sceneImages = new Map<string, HTMLImageElement | null>();
	for (const s of input.scenes) {
		if (s.src && !sceneImages.has(s.src))
			sceneImages.set(s.src, await loadImage(s.src, resolveMedia));
	}

	const canvas =
		typeof OffscreenCanvas !== "undefined"
			? new OffscreenCanvas(width, height)
			: Object.assign(document.createElement("canvas"), { width, height });
	// SAFETY: "2d" on either canvas returns its 2D context or null; TypeScript cannot
	// pick the overload across the `OffscreenCanvas | HTMLCanvasElement` union.
	const ctx = canvas.getContext("2d") as
		| OffscreenCanvasRenderingContext2D
		| CanvasRenderingContext2D
		| null;
	if (!ctx) throw new Error("canvas 2d unavailable");

	const target = new BufferTarget();
	const output = new Output({ format: new Mp4OutputFormat(), target });
	const videoSource = new CanvasSource(canvas, { codec: "avc", bitrate: QUALITY_MEDIUM });
	output.addVideoTrack(videoSource);
	const audioSource = mixdown
		? new AudioBufferSource({ codec: "aac", bitrate: QUALITY_MEDIUM })
		: null;
	if (audioSource) output.addAudioTrack(audioSource);
	await output.start();

	if (audioSource && mixdown) await audioSource.add(mixdown);

	const sorted = [...input.scenes].sort((a, b) => a.start - b.start);
	const totalFrames = Math.ceil(totalSec * fps);
	for (let f = 0; f < totalFrames; f++) {
		const t = f / fps;
		ctx.fillStyle = "#000";
		ctx.fillRect(0, 0, width, height);
		let scene: DraftScene | undefined;
		for (let i = sorted.length - 1; i >= 0; i--) {
			const s = sorted[i]!;
			if (t >= s.start && t < s.start + s.dur) {
				scene = s;
				break;
			}
		}
		if (scene?.src) {
			const img = sceneImages.get(scene.src);
			if (img)
				drawSceneFrame(
					ctx,
					img,
					width,
					height,
					scene.move,
					Math.min(1, (t - scene.start) / Math.max(0.01, scene.dur)),
				);
		}
		drawCaption(ctx, draftCaptionText(input.captionCues, t), width, height);
		await videoSource.add(t, 1 / fps);
		if (f % Math.max(1, Math.round(fps / 2)) === 0)
			onProgress?.(
				0.15 + 0.8 * (f / totalFrames),
				`encoding ${Math.round((f / totalFrames) * 100)}%`,
			);
	}

	onProgress?.(0.97, "finalizing");
	await output.finalize();
	if (!target.buffer) throw new Error("draft mux produced no data");
	onProgress?.(1, "done");
	return new Blob([target.buffer], { type: "video/mp4" });
}
