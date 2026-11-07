/* Browser export worker protocol (OpenSpec p2-export E2).
 *
 * The page starts one export per worker. The worker owns its own renderer
 * session and canvas at output size, so the live preview never changes the
 * output. Decoder slots stay main-thread grants, routed with the preview's
 * decoder messages. */
import { z } from "zod";
import { videoMetadataSchema } from "@models/timeline/preview-video-protocol.ts";
import { audioMetadataSchema } from "@models/timeline/preview-audio-protocol.ts";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const dimension = z.number().int().min(16).max(4096);

const binding = z
	.object({
		url: z.string().min(1),
		id: z.string().min(1),
		revision: z.string().min(1),
		file: z.instanceof(File),
		video: videoMetadataSchema.nullable(),
		audio: audioMetadataSchema.nullable(),
	})
	.strict();

export const exportStartSchema = z
	.object({
		type: z.literal("start"),
		/** The render storyboard captured when export started, as JSON. */
		json: z.string().min(2),
		fps: z.number().positive().max(120),
		frames: id,
		width: dimension,
		height: dimension,
		/** Video bitrate in bits per second. */
		bitrate: id,
		media: z.array(binding),
	})
	.strict();
export type ExportStart = z.infer<typeof exportStartSchema>;

export const exportRequestSchema = z.discriminatedUnion("type", [
	exportStartSchema,
	z.object({ type: z.literal("cancel") }).strict(),
	z.object({ type: z.literal("decoder-grant"), owner: id, request: id, lease: id }).strict(),
	z
		.object({ type: z.literal("decoder-reject"), owner: id, request: id, message: z.string() })
		.strict(),
	z.object({ type: z.literal("decoder-yield"), owner: id, lease: id }).strict(),
]);
export type ExportRequest = z.infer<typeof exportRequestSchema>;

export const EXPORT_PHASES = ["loading", "rendering", "finishing"] as const;

export const exportEventSchema = z.discriminatedUnion("type", [
	z
		.object({
			type: z.literal("progress"),
			phase: z.enum(EXPORT_PHASES),
			frame: z.number().int().nonnegative(),
			frames: id,
		})
		.strict(),
	z.object({ type: z.literal("done"), bytes: z.instanceof(ArrayBuffer) }).strict(),
	z.object({ type: z.literal("failed"), message: z.string().min(1) }).strict(),
	z.object({ type: z.literal("cancelled") }).strict(),
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
]);
export type ExportEvent = z.infer<typeof exportEventSchema>;
