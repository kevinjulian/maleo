// Thin client for maleo-video API. Render queue + status polling.
//
// Response bodies are PARSED, not asserted — see `video-response-schemas.ts`
// for what the schemas are and why they pass unknown keys through.
import {
	jobsPageResponseSchema,
	presetsResponseSchema,
	renderJobSchema,
	templatesResponseSchema,
} from "./video-response-schemas.ts";
import type { z } from "zod";

export type VideoPreset = {
	id: string;
	compositionId: string;
	maxDurationSec: number;
	codec: string;
	videoBitrate: string;
	label?: string;
	aspect?: "vertical" | "square" | "horizontal";
	aspectRatio?: string;
	hint?: string;
};

export type VideoTemplate = {
	id: "classic" | "split-screen" | "before-after" | "testimonial";
	label: string;
};

export type RenderJobStatus =
	| "queued"
	| "running"
	| "done"
	| "done_with_fallback"
	| "error"
	| "cancelled";
export type RenderJobPhase =
	| "queued"
	| "validating"
	| "preparing_images"
	| "synthesizing_audio"
	| "bundling"
	| "rendering"
	| "finalizing"
	| "done"
	| "failed";

export type RenderJob = {
	id: string;
	product_json: string;
	preset: string;
	status: RenderJobStatus;
	phase?: RenderJobPhase;
	phase_detail?: string | null;
	output_path: string | null;
	output_url?: string | null;
	thumbnail_path?: string | null;
	thumbnail_storage?: string | null;
	thumbnail_url?: string | null;
	manifest_path?: string | null;
	image_status?: string | null;
	duration_sec?: number | null;
	error: string | null;
	error_code?: string | null;
	cost_usd: number | null;
	progress: number;
	backend: "local" | "lambda";
	attempts?: number;
	max_attempts?: number;
	created_at: number;
	started_at: number | null;
	finished_at: number | null;
	workspace?: string | null;
	project_id?: string | null;
	output_storage?: string | null;
	manifest_storage?: string | null;
};

let getJobOverride: ((id: string) => Promise<RenderJob | null>) | null = null;

function cfg() {
	const base = process.env.MALEO_VIDEO_URL;
	const token = process.env.MALEO_VIDEO_TOKEN;
	if (!base || !token) throw new Error("video service not configured");
	return { base: base.replace(/\/+$/, ""), token };
}

function headers() {
	return {
		"content-type": "application/json",
		authorization: `Bearer ${cfg().token}`,
	};
}

/* A response that does not parse THROWS, at every call site in this file.
 *
 * The alternative — returning `[]` or `null` — is worse here than it looks,
 * because both are meaningful values on these calls. An empty preset list
 * renders as "this service has no presets"; a null job means "no such job", and
 * a polling UI reading that will declare a running render gone. Neither is
 * distinguishable from the real thing once it reaches the caller, so a body we
 * could not read is reported as the failure it is. Every caller in this file
 * already throws on a non-2xx, so this adds no new failure mode. */
async function parsed<T extends z.ZodTypeAny>(
	res: Response,
	schema: T,
	what: string,
): Promise<z.infer<T>> {
	const body: unknown = await res.json().catch(() => undefined);
	const result = schema.safeParse(body);
	if (!result.success) {
		throw new Error(
			`${what}: unreadable response from the video service — ${result.error.issues[0]?.message ?? "invalid body"}`,
		);
	}
	return result.data;
}

export async function listPresets(): Promise<VideoPreset[]> {
	const { base } = cfg();
	const res = await fetch(`${base}/presets`, { headers: headers() });
	if (!res.ok) throw new Error(`listPresets ${res.status}`);
	const j = await parsed(res, presetsResponseSchema, "listPresets");
	return j.items;
}

export async function listTemplates(): Promise<VideoTemplate[]> {
	const { base } = cfg();
	const res = await fetch(`${base}/templates`, { headers: headers() });
	if (!res.ok) throw new Error(`listTemplates ${res.status}`);
	const j = await parsed(res, templatesResponseSchema, "listTemplates");
	return j.items;
}

export async function submitRender(opts: {
	product: unknown;
	preset: string;
	backend?: "local" | "lambda";
	project_id: string;
	workspace: string;
}): Promise<RenderJob> {
	const { base } = cfg();
	const res = await fetch(`${base}/render`, {
		method: "POST",
		headers: headers(),
		body: JSON.stringify(opts),
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`submitRender ${res.status}: ${text.slice(0, 300)}`);
	}
	return parsed(res, renderJobSchema, "submitRender");
}

export async function getJob(id: string): Promise<RenderJob | null> {
	if (getJobOverride) return getJobOverride(id);
	const { base } = cfg();
	const res = await fetch(`${base}/render/${id}`, { headers: headers() });
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`getJob ${res.status}`);
	return parsed(res, renderJobSchema, "getJob");
}

export function setVideoJobGetterForTests(
	fn: ((id: string) => Promise<RenderJob | null>) | null,
): void {
	getJobOverride = fn;
}

export interface VideoJobsPage {
	project_ids?: string[];
	legacy_job_ids?: string[];
	items: RenderJob[];
	total: number;
	limit: number;
	offset: number;
	has_more: boolean;
	next_offset: number | null;
}

export async function listJobs(
	opts: {
		limit?: number;
		offset?: number;
		workspace?: string;
		projectIds?: string[];
		legacyJobIds?: string[];
		statuses?: RenderJobStatus[];
	} = {},
): Promise<VideoJobsPage> {
	const { base } = cfg();
	const limit = Math.min(Math.max(1, opts.limit ?? 50), 500);
	const offset = Math.max(0, opts.offset ?? 0);
	const url = new URL(`${base}/jobs`);
	url.searchParams.set("limit", String(limit));
	if (offset > 0) url.searchParams.set("offset", String(offset));
	const res = opts.workspace
		? await fetch(`${base}/jobs/query`, {
				method: "POST",
				headers: headers(),
				body: JSON.stringify({ ...opts, limit, offset }),
			})
		: await fetch(url.toString(), { headers: headers() });
	if (!res.ok) throw new Error(`listJobs ${res.status}`);
	const j = await parsed(res, jobsPageResponseSchema, "listJobs");
	const total = j.total ?? j.items.length;
	const consumed = offset + j.items.length;
	return {
		items: j.items,
		project_ids: j.project_ids,
		legacy_job_ids: j.legacy_job_ids,
		total,
		limit,
		offset,
		has_more: j.has_more ?? consumed < total,
		next_offset: j.next_offset ?? (consumed < total ? consumed : null),
	};
}

export async function cancelRender(id: string): Promise<RenderJob | null> {
	const { base } = cfg();
	const res = await fetch(`${base}/render/${id}/cancel`, { method: "POST", headers: headers() });
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`cancelRender ${res.status}`);
	return parsed(res, renderJobSchema, "cancelRender");
}

export async function retryRender(
	id: string,
	opts: { force?: boolean; refreshImages?: boolean } = {},
): Promise<RenderJob> {
	const { base } = cfg();
	const url = new URL(`${base}/render/${id}/retry`);
	if (opts.force) url.searchParams.set("force", "1");
	if (opts.refreshImages) url.searchParams.set("refresh_images", "1");
	const res = await fetch(url.toString(), { method: "POST", headers: headers() });
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`retryRender ${res.status}: ${text.slice(0, 200)}`);
	}
	return parsed(res, renderJobSchema, "retryRender");
}

export async function fetchJobFile(id: string): Promise<Response> {
	const { base } = cfg();
	return fetch(`${base}/render/${id}/file`, { headers: headers() });
}
