/* CreateContent pure helpers — no component-state dependency. */
import type { AgentJobState } from "@models/agent/agent-wire.ts";
import type { RenderQueueStatus } from "@models/render/render-queue.ts";
import { clipsPastSource, type Clip } from "@maleo/shared";
import { pendingMediaKeys, pendingSourceKey } from "./pending-media-sources.ts";
import {
	clipControlBlockers,
	mediaCompatibilityReason,
	reverseMediaBlockers,
	sourceAudioBlockers,
	type ClipLayout,
} from "@maleo/shared";
import type { MediaAsset } from "@models/timeline/editor-media.ts";

export function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/** Credentials mode for fetching a media url: cookies for our own origin
 *  (uploaded/generated assets behind session auth), NONE for cross-origin CDNs.
 *  Stock CDNs (Freesound/Pexels) answer `Access-Control-Allow-Origin: *`,
 *  and the fetch spec rejects wildcard + credentials — sending cookies there
 *  makes every request fail with a CORS error. */
export function mediaCredentials(url: string): RequestCredentials {
	try {
		return new URL(url, window.location.href).origin === window.location.origin
			? "include"
			: "omit";
	} catch {
		return "omit";
	}
}

export function logicalRefId(row: {
	id: string;
	meta_json: Record<string, unknown> | null;
}): string {
	const fromMeta = row.meta_json?.id;
	return typeof fromMeta === "string" && fromMeta.trim() ? fromMeta : row.id;
}

export type RenderButtonIntent = "confirm" | "status";

export function renderButtonIntent(rendering: boolean): RenderButtonIntent {
	return rendering ? "status" : "confirm";
}

// A run only counts as success when it finished cleanly AND produced content.
// An errored run that left partial content is still a failure the user can retry.
export function agentRunSucceeded(job: AgentJobState | null): boolean {
	return Boolean(
		job && job.status === "done" && (job.scenes.length || job.slides.length || job.posts.length),
	);
}

// Short, explicit label for the in-progress render button so it's clear the
// render is still working (and how far along), not a generic "In progress".
export function renderButtonLabel(status: RenderQueueStatus | null): string {
	if (!status) return "Starting render…";
	if (status.status === "queued") return "Queued for render…";
	if (status.status === "running") {
		const pct = Math.round((status.progress ?? 0) * 100);
		return `Rendering… ${pct}%`;
	}
	return "Rendering…";
}

export interface RenderPreflightInput {
	scenes: Array<{
		src?: string;
		endSrc?: string;
		img?: boolean;
		vo?: string;
		mediaAssetId?: string;
		layout?: ClipLayout;
		dur?: number;
		visualClips?: Array<{
			url: string;
			mediaAssetId?: string;
			layout?: ClipLayout;
			durationSec?: number;
			mediaStartSec?: number;
		}>;
	}>;
	videoOverlays: Array<{
		url?: string;
		mediaAssetId?: string;
		layout?: ClipLayout;
		dur?: number;
		mediaStartSec?: number;
	}>;
	audioOverlays: Array<{ url?: string; kind?: string; mediaAssetId?: string }>;
	mediaAssets?: MediaAsset[];
	/** The document's clips, for source ranges placed past their source's length. */
	clips?: readonly Clip[];
	processingSources?: string[];
	textOverlays: Array<unknown>;
	effects: Array<unknown>;
	agentRunning: boolean;
	rendering: boolean;
}

export interface RenderPreflight {
	blockers: string[];
	warnings: string[];
	summary: string;
}

export function buildRenderPreflight(input: RenderPreflightInput): RenderPreflight {
	const visualCount = input.scenes.length + input.videoOverlays.length + input.textOverlays.length;
	const hasRenderableVideo = visualCount > 0;
	const blockers: string[] = [
		...clipControlBlockers(input),
		...reverseMediaBlockers(input),
		...sourceAudioBlockers(input, input.mediaAssets),
		...new Set(clipsPastSource(input.clips ?? [], input.mediaAssets ?? []).values()),
	];
	for (const label of input.processingSources ?? [])
		blockers.push(`${label}: source processing is still pending. Wait or cancel before export.`);
	const warnings: string[] = [];
	if (!hasRenderableVideo) blockers.push("Add media, text, or generate a storyboard.");
	if (input.rendering) blockers.push("Render already running.");
	if (input.agentRunning) warnings.push("Generation still running; export may miss newer edits.");
	const scenesWithoutVisuals = input.scenes.filter((scene) => !scene.src && !scene.img).length;
	if (scenesWithoutVisuals > 0)
		warnings.push(
			`${scenesWithoutVisuals} scene${scenesWithoutVisuals === 1 ? " has" : "s have"} no visual frame.`,
		);
	const missingMedia =
		input.videoOverlays.filter((item) => !item.url).length +
		input.audioOverlays.filter((item) => !item.url).length;
	if (missingMedia > 0)
		blockers.push(
			`${missingMedia} media clip${missingMedia === 1 ? " has" : "s have"} no source file. Replace missing sources before export.`,
		);
	const sources = [
		...input.videoOverlays,
		...input.audioOverlays,
		...input.scenes.flatMap((scene) => [
			{ url: scene.src, mediaAssetId: scene.mediaAssetId },
			{ url: scene.endSrc },
			...(scene.visualClips ?? []),
		]),
	];
	const used = new Set(sources.map((source) => source.mediaAssetId).filter(Boolean));
	const urls = new Set(sources.map((source) => source.url).filter(Boolean));
	for (const asset of input.mediaAssets ?? []) {
		if (!used.has(asset.id) && !urls.has(asset.url)) continue;
		const reason = !asset.url
			? "Source file is missing"
			: mediaCompatibilityReason(asset.compatibility, "render");
		if (reason) blockers.push(`${asset.label}: ${reason}. Replace source before export.`);
	}
	// Both exports wait for every file still importing (p2-export, project-media-library).
	for (const key of pendingMediaKeys(input.clips ?? [])) {
		const asset = (input.mediaAssets ?? []).find((item) => pendingSourceKey(item.url) === key);
		const name = asset?.metadata?.originalFilename ?? asset?.label;
		blockers.push(`${name ?? "A file"} is still uploading. Wait for it to finish before export.`);
	}
	const voiceoverCount = input.audioOverlays.filter((item) => item.kind === "voiceover").length;
	if (
		input.scenes.length > 0 &&
		voiceoverCount === 0 &&
		!input.scenes.some((scene) => scene.vo?.trim())
	)
		warnings.push("No narration track detected.");
	if (input.effects.length > 0)
		warnings.push(
			`${input.effects.length} effect clip${input.effects.length === 1 ? "" : "s"} will render through Remotion only.`,
		);
	return {
		blockers,
		warnings,
		summary: blockers.length
			? `${blockers.length} blocker${blockers.length === 1 ? "" : "s"}`
			: warnings.length
				? `${warnings.length} warning${warnings.length === 1 ? "" : "s"}`
				: "Ready to export",
	};
}
