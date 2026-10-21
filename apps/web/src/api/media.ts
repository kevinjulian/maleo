/* Generating media for a clip: TTS, image upload, scene image generation and
 * image-to-video animation.
 *
 * These are the calls that spend generation credits, and the only ones here that
 * poll rather than return in one round trip. */
import { apiUrl, get, post, postForm } from "./client.ts";
import type {
	RefImage,
	TtsProviderId,
	TtsStatus,
	ImagePromptIntent,
	ImagePromptReference,
} from "@maleo/shared";
import { generatedVideoSchema, roleOf, type GeneratedVideo } from "@maleo/shared";
import { getActiveWorkspace } from "@models/core/active-workspace.ts";
import { mediaCredentials } from "@models/core/cc-helpers.ts";

/** Signed address is held for this fetch only; project data keeps stable ID. */
export async function mediaFetchTarget(
	url: string,
	stream = false,
): Promise<{ url: string; credentials: RequestCredentials }> {
	const id = /^\/api\/media\/([0-9a-f-]{36})$/.exec(url)?.[1];
	if (!id) return { url, credentials: mediaCredentials(url) };
	// Range readers can outlive one signature. Each request to the stable URL
	// gets a new redirect, including retries and seeks during a long export.
	if (stream) return { url: apiUrl(url), credentials: "include" };
	const signed = await get<{ url: string }>(`/api/media/${id}/sign`);
	return {
		url: apiUrl(signed.url),
		credentials: signed.url.startsWith("/api/media/") ? "include" : "omit",
	};
}

/** TTS provider readiness + per-provider voice catalogue. Drives the editor's
 *  gate, the Timeline Global Settings voice picker, and the Workspace status. */
export async function fetchTtsStatus(): Promise<TtsStatus> {
	return get<TtsStatus>("/api/tts/status");
}

export async function uploadReferenceImage(file: File, projectId?: string | null): Promise<string> {
	const form = new FormData();
	form.set("file", file);
	if (projectId) form.set("project_id", projectId);
	const path = `/api/image-gen/upload?workspace=${encodeURIComponent(getActiveWorkspace())}`;
	const body = await postForm<{ url?: string }>(path, form);
	if (!body.url) throw new Error("upload did not return url");
	return body.url;
}

// Synthesize a voiceover clip's audio via the server TTS proxy. Returns the
// stored audio url plus measured duration when available.
export async function generateTts(
	text: string,
	voice?: string,
	provider?: TtsProviderId,
	projectId?: string | null,
): Promise<{ url: string; durationSec?: number }> {
	const body = await post<{ url?: string; durationSec?: number }>("/api/tts/generate", {
		text,
		voice,
		provider,
		project_id: projectId,
	});
	if (!body.url) throw new Error("TTS returned no url");
	return { url: body.url, durationSec: body.durationSec };
}

interface SceneImageJob {
	/** "queued", "processing", "done" or "error"; open on the wire. */
	status: string;
	image_url?: string | null;
	error?: string | null;
}

const IMAGE_POLL_INTERVAL_MS = 1500;

const IMAGE_POLL_TIMEOUT_MS = 120_000;

export interface SceneImageInput {
	visual: string;
	aspect?: string;
	refs: RefImage[];
	sceneName?: string;
	action?: string;
	shotType?: string;
	movement?: string;
	tone?: string;
	colors?: string;
	target?: string;
	characterDescription?: string;
	/** Global style lock — sent as a "style" role ref (match look, not subject). */
	styleImageUrl?: string;
	/* Generation context. This request used to carry none, so the route's
	 * `if (job_id && body.workspace)` guard was always false and every clip,
	 * reference and studio image it produced was both unmetered and unrecorded.
	 *
	 * There is no `workspace` here on purpose, and the reason is now the STRONGER
	 * one. The app does have an active workspace, and this request must still not
	 * carry it: a generation that belongs to a project is attributed to the
	 * PROJECT's workspace, never to the one the operator is viewing from. An
	 * operator can open a project by direct link while another workspace is
	 * active, and billing the tenant they happen to be looking at would be wrong.
	 * `content_projects.workspace` stays authoritative. */
	/** The project this image belongs to. Omit for workspace-scoped reference
	 *  images, which belong to no project. */
	projectId?: string | null;
	source: "clip" | "reference";
}

function cleanPromptText(value: string | undefined): string {
	return (value ?? "")
		.replace(/(^|[\s([{"'])@([^\s,).!?;:"'\]}][^,).!?;:"'\]}]*)/gu, "$1$2")
		.replace(/\s+/g, " ")
		.trim();
}

function splitProjectBrief(value: string) {
	const match = value.match(/^Project reference brief:\s*([\s\S]*?)\n\nClip prompt:\s*([\s\S]*)$/u);
	if (!match) return { visualMoment: cleanPromptText(value) };
	return { visualGuidance: cleanPromptText(match[1]), visualMoment: cleanPromptText(match[2]) };
}

function refToPromptReference(ref: RefImage, url: string): ImagePromptReference {
	const role = roleOf(ref.role) ?? roleOf(ref.tags?.[0]) ?? "style";
	return {
		url,
		role,
		entityId: ref.id,
		label: ref.label,
		description: ref.description,
		primary: ref.primary,
		referenceUse: ref.referenceUse,
	};
}

/** Build the /api/image-gen/generate-scene request body. Pure (testable): the
 *  global style ref goes to style_image_urls, kept SEPARATE from product refs so
 *  it's matched for look only, never as an exact product/subject lock. `origin`
 *  resolves relative urls (defaults to window.location.origin in the browser). */
export function buildSceneImageRequest(input: SceneImageInput, origin?: string) {
	const base = origin ?? (typeof window !== "undefined" ? window.location.origin : "");
	const abs = (src: string): string => (src.startsWith("http") ? src : `${base}${src}`);
	const productImageUrls = input.refs
		.map((ref) => (ref.imageUrl ? refToPromptReference(ref, abs(ref.imageUrl)) : null))
		.filter((ref): ref is ImagePromptReference => Boolean(ref));
	const styleImageUrls = input.styleImageUrl ? [abs(input.styleImageUrl)] : [];
	const { visualMoment, visualGuidance } = splitProjectBrief(input.visual);
	const references: ImagePromptReference[] = [
		...productImageUrls,
		...styleImageUrls.map((url): ImagePromptReference => ({
			url,
			role: "style",
			label: "Global style reference",
		})),
	];
	const intent: ImagePromptIntent = {
		output: { kind: "single-image", aspect: input.aspect, fullFrame: true },
		subjectLocks: productImageUrls.map((ref) => ({
			source: "reference",
			role: ref.role,
			label: ref.label ?? ref.entityId ?? ref.role,
			descriptors: ref.description ? [cleanPromptText(ref.description)] : [],
			mustAvoid: [],
			referenceId: ref.entityId,
		})),
		scene: {
			visualMoment,
			action: cleanPromptText(input.action),
		},
		composition: {
			shotType: input.shotType,
			movement: input.movement,
		},
		style: {
			visualTreatment: visualGuidance,
		},
		lightingColor: {
			palette: input.colors,
			mood: input.tone,
		},
		constraints: {
			mustInclude: [],
			mustAvoid: [],
		},
		negative: [],
		references,
	};
	return {
		project_id: input.projectId ?? undefined,
		source: input.source,
		aspect: input.aspect,
		scene: {
			sceneName: input.sceneName ?? "",
			visualDesc: visualMoment,
			actionDesc: cleanPromptText(input.action),
			shotType: input.shotType ?? "Medium Shot",
			movement: input.movement ?? "Static",
		},
		creativeNotes: { tone: input.tone, colors: input.colors, target: input.target },
		product_image_urls: productImageUrls.map((ref) => ref.url),
		style_image_urls: styleImageUrls,
		character_description: input.characterDescription,
		intent,
	};
}

/** Generate one scene/slide image via the image pipeline. Returns the proxied
 *  image URL on success, throws on failure or timeout. Reference images come
 *  from the selected catalogue refs (passed through as absolute URLs). */
export async function generateSceneImage(input: SceneImageInput): Promise<string> {
	const start = await post<{ job_id?: string; error?: string }>(
		"/api/image-gen/generate-scene",
		buildSceneImageRequest(input),
	);
	if (!start.job_id) throw new Error(start.error || "image generation did not start");
	const jobId = start.job_id;
	const deadline = Date.now() + IMAGE_POLL_TIMEOUT_MS;
	while (Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, IMAGE_POLL_INTERVAL_MS));
		const job = await get<SceneImageJob>(`/api/image-gen/jobs/${jobId}`);
		if (job.status === "done" && job.image_url) return job.image_url;
		if (job.status === "error") throw new Error(job.error || "image generation failed");
	}
	throw new Error("image generation timed out");
}

// Image-to-video: animate a frame into a clip. Returns the video url, or throws.
export async function animateClip(
	imageUrl: string,
	prompt?: string,
	durationSec?: number,
	projectId?: string | null,
): Promise<GeneratedVideo> {
	return generatedVideoSchema.parse(
		await post<unknown>("/api/video/animate", {
			imageUrl,
			prompt,
			durationSec,
			project_id: projectId ?? undefined,
		}),
	);
}
