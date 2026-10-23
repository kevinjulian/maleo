/* The two ways a project leaves the editor: the fast in-browser draft, and the
 * submit that saves the storyboard and hands it to the render worker (video) or
 * to the queue (image, text).
 *
 * Split out of `create-content.tsx`.
 */
import type { Dispatch, SetStateAction } from "react";
import type { Config, ContentType } from "@maleo/shared";
import { exportDraft } from "@models/render/export.ts";
import { mediaFetchTarget } from "@api/media.ts";
import { resolveMediaUrl } from "@models/core/pending-media-sources.ts";
import { clipId } from "@models/timeline/timeline-clips.ts";
import { submitProject } from "@api/projects.ts";
import { submitVideoRender } from "@api/project-render.ts";
import { errMsg } from "@models/core/cc-helpers.ts";
import { DRAFT_DIMS } from "@models/timeline/timeline-editor-model.ts";
import { buildDraftRequest, timelineTotalSec } from "@models/render/draft-request.ts";
import type { RenderQueueStatus } from "@models/render/render-queue.ts";
import type { CreativeSettings } from "@hooks/editor/use-creative-settings.ts";
import type { ReferenceLibraryState } from "@hooks/editor/use-reference-library.ts";
import { renderPresentation } from "./editor-settings.tsx";
import type { ContentPersistence } from "@hooks/editor/use-content-persistence.ts";
import type { EditorDocument } from "./use-editor-document.ts";
import { captionOutputBlockers } from "@maleo/shared";

export async function exportFastDraft(input: {
	doc: EditorDocument;
	aspect: string;
	filename: string;
	setRenderStatus: Dispatch<SetStateAction<RenderQueueStatus | null>>;
	setRendering: Dispatch<SetStateAction<boolean>>;
	setSaveError: Dispatch<SetStateAction<string | null>>;
}): Promise<void> {
	const { doc, setRenderStatus, setRendering, setSaveError } = input;
	const { store } = doc;
	// Clip-native (G1): a scene's effective start is its clip's start on the doc.
	const sceneStart = (id: number): number =>
		store.getDoc().clips.find((c) => c.id === clipId("scene", id))?.startSec ?? 0;
	setRenderStatus({
		id: "fast-draft",
		status: "running",
		phase: "starting",
		progress: 0,
		error: null,
	});
	setRendering(true);
	try {
		const draft = buildDraftRequest({
			clips: store.getDoc().clips,
			scenes: doc.scenes,
			audioOverlays: doc.audioOverlays,
			captions: doc.captions,
			trackFlags: doc.trackFlags,
			sceneStart,
		});
		const dims = DRAFT_DIMS[input.aspect] ?? DRAFT_DIMS["9:16"]!;
		const blob = await exportDraft({
			...draft,
			// The draft may render a file still importing from the browser's copy (disclosed in the export menu).
			resolveMedia: (url: string, stream?: boolean) =>
				mediaFetchTarget(resolveMediaUrl(url), stream),
			width: dims.w,
			height: dims.h,
			fps: 30,
			onProgress: (fraction, label) =>
				setRenderStatus({
					id: "fast-draft",
					status: "running",
					phase: label,
					progress: Math.max(0, Math.min(1, fraction)),
					error: null,
				}),
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = input.filename;
		a.click();
		URL.revokeObjectURL(url);
		setRenderStatus({
			id: "fast-draft",
			status: "done",
			phase: "done",
			progress: 1,
			error: null,
		});
	} catch (err) {
		const msg = errMsg(err);
		setSaveError(`Fast render failed: ${msg}`);
		setRenderStatus({
			id: "fast-draft",
			status: "error",
			phase: "fast_render",
			progress: 0,
			error: msg,
		});
	} finally {
		setRendering(false);
	}
}

export async function persistSubmission(input: {
	projectId: string;
	type: ContentType;
	title: string;
	doc: EditorDocument;
	config: Config;
	refs: ReferenceLibraryState["refs"];
	creative: CreativeSettings;
	saveStoryboard: ContentPersistence["flushStoryboard"];
	backendOverride?: "local" | "lambda";
	onRenderJob: (jobId: string) => void;
}): Promise<void> {
	const { projectId, type, title, doc, config, refs, creative } = input;
	const { store, scenes, slides, posts, trackFlags, captions } = doc;
	const captionIssues = captionOutputBlockers(store.getDoc().clips, captions, trackFlags);
	if (captionIssues.length) throw new Error(captionIssues.join(" "));
	const { settings, pacingDevices } = creative;
	if (!projectId) throw new Error("draft was not saved — please regenerate and try again");
	const saved = await input.saveStoryboard();
	if (type === "video") {
		// Render at the aspect chosen in Timeline Global Settings, not the
		// original wizard format — preview and MP4 must match.
		const renderConfig = {
			...config,
			format: settings.aspectRatio || config.format,
			length: String(timelineTotalSec(store.getDoc().clips)),
		};
		// Clip-native wire: post the canonical document + projection inputs; the
		// dashboard `/render` route runs the SHARED projection server-side (same
		// `buildRenderStoryboardFromDoc` the WYSIWYG preview uses), so the render
		// path consumes clips[] and the MP4 matches what's on screen.
		const job = await submitVideoRender({
			projectId,
			storyboardId: saved.id,
			render: {
				doc: store.getDoc(),
				config: renderConfig,
				refs,
				trackFlags,
				captions,
				pacingDevices,
				brand: renderPresentation(settings).brand,
				backgroundFill: renderPresentation(settings).backgroundFill,
			},
			targetDurationSec: timelineTotalSec(store.getDoc().clips),
			backend: input.backendOverride || settings.renderBackend || undefined,
			title,
			platform: config.platform ?? null,
			content: {
				scenes: scenes.map((scene) => ({
					name: scene.name,
					voiceover: scene.vo,
					visual: scene.vis,
				})),
			},
		});
		input.onRenderJob(job.id);
		return;
	}
	await submitProject({
		projectId,
		type,
		title,
		platform: config.platform ?? null,
		content:
			type === "image"
				? {
						slides: slides.map((slide) => ({
							name: slide.name,
							caption: slide.cap,
							visual: slide.vis,
						})),
					}
				: {
						posts: posts.map((post) => ({ body: post.body })),
					},
	});
}
