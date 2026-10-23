/* A stored storyboard as the editable scope, and back (`p1-command-log`).
 *
 * The server executes submitted commands against the head version's scope and
 * records every other writer's version as one `scope.replace` of it, so both
 * directions live here, beside the document contract they read and write.
 *
 * The scope owns what the editor's commands write: clips, markers, chapters,
 * bookmarks, references, materials, captions, track flags, slides and posts.
 * Everything else — pacing devices, infographic style, presentation, the agent's
 * artifacts and unit lifecycle — stays the head's. Media assets are not part of a
 * storyboard: the server holds them as library rows (`p1-media-library`), and the
 * caller passes them in. */
import {
	readStoryboardDocument,
	readStoryboardPosts,
	readStoryboardSlides,
	writeStoryboardDocument,
	writeStoryboardPosts,
	writeStoryboardSlides,
	type StoredStoryboardDocument,
} from "../storyboard-document.ts";
import { z } from "zod";
import { parseImportedMediaFields } from "../media-import.ts";
import type { EditScope, MediaAsset, Post, Slide } from "./scope.ts";

export type { MediaAsset };

/** The editable scope of a stored storyboard document, with the project's library. */
export function storyboardScope(raw: unknown, mediaAssets: MediaAsset[] = []): EditScope {
	const doc = readStoryboardDocument(raw).doc;
	const slides = readStoryboardSlides(raw).map((slide, index): Slide => ({
		key: slide.key,
		id: index + 1,
		...(slide.name === undefined ? {} : { name: slide.name }),
		cap: slide.caption,
		vis: slide.visual,
		img: Boolean(slide.image),
		...(slide.image ? { src: slide.image } : {}),
		refIds: slide.referenceIds,
		noteIds: slide.noteIds,
	}));
	const posts = readStoryboardPosts(raw).map((post, index): Post => ({
		key: post.key,
		id: index + 1,
		body: post.body,
		img: Boolean(post.image),
		...(post.image ? { src: post.image } : {}),
	}));
	return {
		doc: {
			schemaVersion: 2,
			clips: doc.clips,
			markers: doc.markers,
			projectReferences: doc.projectReferences,
			materials: doc.materials,
			...(doc.chapters === null ? {} : { chapters: doc.chapters }),
			...(doc.bookmarks === null ? {} : { bookmarks: doc.bookmarks }),
			...(doc.captions === null ? {} : { captions: doc.captions }),
			...(doc.captionSet === null ? {} : { captionSet: doc.captionSet }),
			...(doc.trackFlags === null ? {} : { trackFlags: doc.trackFlags }),
		},
		slides,
		posts,
		mediaAssets,
	};
}

/* An asset as the editor wrote it: the fields every asset has are checked, the
 * rest is kept as written. */
const StoredAssetSchema = z
	.object({
		id: z.string().optional(),
		url: z.string(),
		label: z.string().catch(""),
		kind: z.enum(["image", "video", "audio"]).catch("image"),
		source: z.enum(["generated", "stock", "upload", "reference"]).catch("upload"),
		metadata: z.unknown(),
		compatibility: z.unknown(),
		importedSource: z.unknown(),
	})
	.passthrough();
const StoredListSchema = z.object({ media_assets: z.array(z.unknown()).catch([]) }).catch({
	media_assets: [],
});

/** The media list a project stored before its library had rows (`p1-media-library`
 *  D5): the editor state's `media_assets`, then an older head document's, each asset
 *  once by URL, in stored order. An entry without a string URL is dropped; one
 *  without an id is named by its URL. */
export function storedMediaLibrary(editorState: unknown, document: unknown): MediaAsset[] {
	const assets: MediaAsset[] = [];
	for (const source of [editorState, document]) {
		for (const value of StoredListSchema.parse(source ?? {}).media_assets) {
			const parsed = StoredAssetSchema.safeParse(value);
			if (!parsed.success) continue;
			const { url } = parsed.data;
			const id = parsed.data.id || url;
			if (assets.some((asset) => asset.url === url || asset.id === id)) continue;
			const { metadata, compatibility, importedSource, ...legacy } = parsed.data;
			assets.push({
				...legacy,
				id,
				...parseImportedMediaFields({ metadata, compatibility, importedSource }),
			});
		}
	}
	return assets;
}

/** `head` with the scope's fields replaced by `scope`'s: the stored document a
 *  command submission writes. Throws what `writeStoryboardDocument` throws. */
export function storyboardWithScope(head: unknown, scope: EditScope): StoredStoryboardDocument {
	const prior = readStoryboardDocument(head).doc;
	const { doc } = scope;
	return {
		...writeStoryboardDocument({
			...prior,
			clips: doc.clips,
			markers: doc.markers,
			chapters: doc.chapters ?? null,
			bookmarks: doc.bookmarks ?? null,
			projectReferences: doc.projectReferences ?? prior.projectReferences,
			materials: doc.materials ?? prior.materials,
			captions: doc.captions ?? null,
			captionSet: doc.captionSet ?? null,
			trackFlags: doc.trackFlags ?? null,
		}),
		...(scope.slides.length
			? {
					slides: writeStoryboardSlides(
						scope.slides.map((slide) => ({
							key: slide.key,
							name: slide.name,
							caption: slide.cap,
							visual: slide.vis,
							image: slide.src,
							referenceIds: slide.refIds ?? [],
							noteIds: slide.noteIds ?? [],
						})),
					),
				}
			: {}),
		...(scope.posts.length
			? {
					posts: writeStoryboardPosts(
						scope.posts.map((post) => ({ key: post.key, body: post.body, image: post.src })),
					),
				}
			: {}),
	};
}
