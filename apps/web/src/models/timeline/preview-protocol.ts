/* Preview worker protocol. Host time uses performance.timeOrigin plus performance.now(), in seconds.
 * Output observations retain the AudioContext's context/performance timestamp pair. */
import { z } from "zod";
import { videoMetadataSchema } from "./preview-video-protocol.ts";
import { audioMetadataSchema } from "./preview-audio-protocol.ts";
const sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const time = z.number().finite();
const blocker = z.object({ clipId: z.string().min(1), message: z.string().min(1) }).strict();
export const previewReadinessSchema = z
	.object({
		revision: z.string().min(1),
		sourceGeneration: sequence.max(0xffffffff),
		sequence,
		ready: z.boolean(),
		blockers: z.array(blocker),
	})
	.strict()
	.refine((value) => !value.ready || value.blockers.length === 0);
export type PreviewReadiness = z.infer<typeof previewReadinessSchema>;
const mediaBinding = z
	.object({
		url: z.string().min(1),
		id: z.string().min(1),
		revision: z.string().min(1),
		file: z.instanceof(File),
		video: videoMetadataSchema.nullable(),
		audio: audioMetadataSchema.nullable(),
	})
	.strict();
export type PreviewMediaBinding = z.infer<typeof mediaBinding>;
const playback = z.discriminatedUnion("state", [
	z.object({ state: z.literal("ready") }).strict(),
	z.object({ state: z.literal("buffering") }).strict(),
	z.object({ state: z.literal("stalled"), message: z.string().min(1) }).strict(),
]);
export type PreviewMediaPlayback = z.infer<typeof playback>;
const anchor = z
	.object({
		generation: sequence,
		position: time.nonnegative(),
		sampleRate: z.number().int().min(8000).max(192000),
		rate: time.min(0.25).max(4),
	})
	.strict();
export type PreviewAudioAnchor = z.infer<typeof anchor>;
const observation = z
	.object({
		generation: sequence,
		frames: sequence,
		renderFrame: sequence,
		contextTime: time.nonnegative(),
		performanceTime: time.nonnegative(),
		output: z
			.object({ contextTime: time.nonnegative(), performanceTime: time.nonnegative() })
			.strict()
			.nullable(),
		latency: time.nonnegative().nullable(),
	})
	.strict()
	.refine((value) => value.renderFrame >= value.frames);
export type PreviewAudioObservation = z.infer<typeof observation>;
const mediaEventSchema = z.discriminatedUnion("type", [
	z
		.object({
			type: z.literal("decoder-request"),
			owner: id,
			request: id,
			kind: z.enum(["video", "audio"]),
			slots: z.union([z.literal(1), z.literal(2)]),
		})
		.strict(),
	z.object({ type: z.literal("decoder-return"), owner: id, lease: id }).strict(),
	z.object({ type: z.literal("decoder-close"), owner: id }).strict(),
	z.object({ type: z.literal("source-released"), requestId: id }).strict(),
	z.object({ type: z.literal("disposed") }).strict(),
	z
		.object({ type: z.literal("audio-ready"), generation: sequence, outputGeneration: sequence })
		.strict(),
	z
		.object({ type: z.literal("audio-started"), generation: sequence, outputGeneration: sequence })
		.strict(),
	z
		.object({
			type: z.literal("audio-block"),
			generation: sequence,
			outputGeneration: sequence,
			requestId: id,
			block: z
				.object({ lease: z.bigint().positive(), pcm: z.instanceof(Float32Array) })
				.strict()
				.nullable(),
		})
		.strict(),
	z
		.object({
			type: z.literal("audio-failed"),
			generation: sequence,
			outputGeneration: sequence,
			message: z.string().min(1),
		})
		.strict(),
	z
		.object({
			type: z.literal("pcm-reserved"),
			requestId: id,
			lease: z.bigint().positive().nullable(),
			message: z.string().nullable(),
		})
		.strict(),
]);
export type PreviewMediaEvent = z.infer<typeof mediaEventSchema>;
export const previewRequestSchema = z.discriminatedUnion("type", [
	z
		.object({
			type: z.literal("init"),
			canvas: z.custom<OffscreenCanvas>(
				(value) => typeof OffscreenCanvas !== "undefined" && value instanceof OffscreenCanvas,
			),
		})
		.strict(),
	z
		.object({
			type: z.literal("storyboard"),
			generation: id,
			json: z.string().min(1),
			fps: time.positive(),
			durationFrames: id,
			images: z.array(z.string()),
			media: z.array(mediaBinding).optional(),
			readiness: previewReadinessSchema,
		})
		.strict(),
	z.object({ type: z.literal("seek"), generation: sequence, frame: sequence }).strict(),
	z
		.object({
			type: z.literal("play"),
			generation: sequence,
			position: time.nonnegative(),
			at: time,
			rate: time.positive(),
		})
		.strict(),
	z
		.object({ type: z.literal("pause"), generation: sequence, position: time.nonnegative() })
		.strict(),
	z
		.object({
			type: z.literal("remotion"),
			generation: sequence,
			position: time.nonnegative(),
			at: time,
		})
		.strict(),
	z
		.object({
			type: z.literal("resize"),
			generation: sequence,
			width: id.max(0xffffffff),
			height: id.max(0xffffffff),
		})
		.strict(),
	z
		.object({
			type: z.literal("media-readiness"),
			generation: sequence,
			readiness: previewReadinessSchema,
		})
		.strict(),
	z.object({ type: z.literal("media-playback"), generation: sequence, playback }).strict(),
	z.object({ type: z.literal("audio-play"), generation: sequence, anchor, at: time }).strict(),
	z.object({ type: z.literal("audio-position"), generation: sequence, observation }).strict(),
	z.object({ type: z.literal("audio-stop"), generation: sequence }).strict(),
	z
		.object({
			type: z.literal("audio-configure"),
			generation: sequence,
			outputGeneration: sequence,
			position: time.nonnegative(),
			rate: time.min(0.25).max(4),
			sampleRate: z.number().int().min(8000).max(192000),
		})
		.strict(),
	z
		.object({
			type: z.literal("audio-pull"),
			generation: sequence,
			outputGeneration: sequence,
			requestId: id,
			availableFrames: id.max(384000),
		})
		.strict(),
	z
		.object({ type: z.literal("pcm-reserve"), requestId: id, bytes: id.max(16 * 1024 * 1024) })
		.strict(),
	z.object({ type: z.literal("pcm-release"), lease: z.bigint().positive() }).strict(),
	z.object({ type: z.literal("decoder-grant"), owner: id, request: id, lease: id }).strict(),
	z
		.object({ type: z.literal("decoder-reject"), owner: id, request: id, message: z.string() })
		.strict(),
	z.object({ type: z.literal("decoder-yield"), owner: id, lease: id }).strict(),
	z.object({ type: z.literal("source-release"), url: z.string(), requestId: id }).strict(),
	z.object({ type: z.literal("dispose") }).strict(),
]);
export type PreviewRequest = z.infer<typeof previewRequestSchema>;
const previewStatusSchema = z.enum([
	"loading",
	"ready",
	"playing",
	"paused",
	"buffering",
	"stalled",
	"device-lost",
	"failed",
]);
export type PreviewStatus = z.infer<typeof previewStatusSchema>;
const previewStateSchema = z
	.object({
		status: previewStatusSchema,
		message: z.string().nullable(),
		position: time.nonnegative(),
		frame: sequence,
		dropped: sequence,
		times: z
			.object({
				last: time.nonnegative(),
				p50: time.nonnegative(),
				p95: time.nonnegative(),
				count: id,
			})
			.strict()
			.nullable(),
		drift: time.nullable(),
		coverage: z.array(
			z.object({ kind: z.string(), path: z.string(), reason: z.string() }).strict(),
		),
		error: z.string().nullable(),
		generation: sequence,
		mediaGeneration: sequence.max(0xffffffff),
		mediaReady: z.boolean(),
		blockers: z.array(blocker),
		clockOwner: z.enum(["host", "audio"]),
	})
	.strict();
export type PreviewState = z.infer<typeof previewStateSchema>;
export const EMPTY_PREVIEW_STATE: PreviewState = {
	status: "loading",
	message: null,
	position: 0,
	frame: 0,
	dropped: 0,
	times: null,
	drift: null,
	coverage: [],
	error: null,
	generation: 0,
	mediaGeneration: 0,
	mediaReady: false,
	blockers: [],
	clockOwner: "host",
};
export type PreviewEvent =
	| { type: "state"; state: PreviewState; requestGeneration: number }
	| PreviewMediaEvent;
export function previewNow(): number {
	return (performance.timeOrigin + performance.now()) / 1000;
}
/** Invalid messages never become partial/defaulted state. */
export function parsePreviewEvent(data: unknown): PreviewEvent {
	const state = z
		.object({ type: z.literal("state"), state: previewStateSchema, requestGeneration: sequence })
		.strict()
		.safeParse(data);
	if (state.success) return state.data;
	const media = mediaEventSchema.safeParse(data);
	if (media.success) return media.data;
	throw new Error("preview worker: unexpected message or invalid state");
}
/** Correlate a rejected envelope without trusting its payload. */
export function previewRequestGeneration(data: unknown): number | undefined {
	const parsed = z.object({ generation: sequence }).safeParse(data);
	return parsed.success ? parsed.data.generation : undefined;
}
