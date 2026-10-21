/* Turning a finished project into a video: the output row, the render job and the
 * render record that ties them together.
 *
 * Clip-native: the client posts the canonical document and the projection inputs,
 * and the dashboard `/render` route runs the SHARED projection server-side. */
import { post } from "./client.ts";
import type {
	BrandKit,
	Config,
	InfographicStyle,
	PacingDevices,
	RefsState,
	TrackFlags,
	TimelineDoc,
	CaptionConfig,
} from "@maleo/shared";
import { BASE } from "./base.ts";
import { withReadyPending } from "@models/core/pending-media-sources.ts";

interface VideoRenderJob {
	id: string;
	status: string;
	phase?: string | null;
	duration_sec?: number | null;
}

interface CreatedOutput {
	id: string;
}

async function createProjectOutput(input: {
	projectId: string;
	storyboardId?: string | null;
	title: string;
	platform?: string | null;
	kind: string;
	status: string;
	content?: Record<string, unknown> | null;
}): Promise<CreatedOutput> {
	const res = await post<{ output: CreatedOutput }>(`${BASE}/projects/${input.projectId}/outputs`, {
		storyboard_id: input.storyboardId ?? null,
		channel: "social",
		platform: input.platform ?? null,
		kind: input.kind,
		title: input.title,
		status: input.status,
		content_json: input.content ?? null,
	});
	return res.output;
}

// Clip-native render request: the client posts the canonical document + the
// projection inputs (config, refs, track flags, global settings). The dashboard
// `/render` route runs the SHARED projection (`buildRenderStoryboardFromDoc`)
// server-side, so the render path consumes clips[] and the client no longer
// projects. `refs` is sent so server-side image resolution is byte-identical to
// the old client-side projection (no behavior change).
export interface VideoRenderRequest {
	doc: TimelineDoc;
	config: Config;
	refs: RefsState;
	trackFlags?: TrackFlags;
	captions?: CaptionConfig;
	pacingDevices?: PacingDevices;
	infographicStyle?: InfographicStyle;
	brand?: BrandKit;
	backgroundFill?: string;
}

export async function submitVideoRender(input: {
	projectId: string;
	storyboardId: string;
	render: VideoRenderRequest;
	/** Fallback render duration when the video service doesn't report one. */
	targetDurationSec?: number;
	title: string;
	platform?: string | null;
	content?: Record<string, unknown> | null;
	/** Render backend override; omitted = server default (MALEO_VIDEO_BACKEND). */
	backend?: "local" | "lambda";
}): Promise<VideoRenderJob> {
	const output = await createProjectOutput({
		projectId: input.projectId,
		storyboardId: input.storyboardId,
		title: input.title,
		platform: input.platform ?? null,
		kind: "video_render",
		status: "queued",
		content: input.content ?? null,
	});
	const job = await post<VideoRenderJob>("/api/video/render", {
		project_id: input.projectId,
		// Finished imports render as their managed media; one still uploading stays pending and is refused.
		render: { ...input.render, doc: withReadyPending(input.render.doc) },
		...(input.backend ? { backend: input.backend } : {}),
	});
	await post<{ render: { id: string } }>(`${BASE}/projects/${input.projectId}/renders`, {
		output_id: output.id,
		storyboard_id: input.storyboardId,
		video_job_id: job.id,
		status: job.status,
		phase: job.phase ?? null,
		duration_sec: job.duration_sec ?? input.targetDurationSec ?? null,
	});
	return job;
}
