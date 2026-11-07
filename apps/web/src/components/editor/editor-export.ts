/* The server submit: it saves the storyboard and hands it to the render worker
 * (video) or to the queue (image, text). Browser export lives in
 * `hooks/editor/use-browser-export.ts`.
 *
 * Split out of `create-content.tsx`.
 */
import type { Config, ContentType } from "@maleo/shared";
import { submitProject } from "@api/projects.ts";
import { submitVideoRender } from "@api/project-render.ts";
import { timelineTotalSec } from "@models/render/timeline-extent.ts";
import type { CreativeSettings } from "@hooks/editor/use-creative-settings.ts";
import type { ReferenceLibraryState } from "@hooks/editor/use-reference-library.ts";
import { renderPresentation } from "./editor-settings.tsx";
import type { ContentPersistence } from "@hooks/editor/use-content-persistence.ts";
import type { EditorDocument } from "./use-editor-document.ts";
import { captionOutputBlockers } from "@maleo/shared";

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
