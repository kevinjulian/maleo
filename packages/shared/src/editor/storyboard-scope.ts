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
 * storyboard (the editor state holds them), so a stored scope has none. */
import {
	readStoryboardDocument,
	readStoryboardPosts,
	readStoryboardSlides,
	writeStoryboardDocument,
	writeStoryboardPosts,
	writeStoryboardSlides,
	type StoredStoryboardDocument,
} from "../storyboard-document.ts";
import type { EditScope, Post, Slide } from "./scope.ts";

/** The editable scope of a stored storyboard document. */
export function storyboardScope(raw: unknown): EditScope {
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
		mediaAssets: [],
	};
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
