/* What a content project is called, derived from what it contains.
 *
 * A project's title has three answers depending on who is asking, and they are
 * not the same string: the breadcrumb wants the operator's own title and falls
 * back to the content; a download wants a filesystem-safe slug; an output row
 * wants something readable even when the project is empty.
 *
 * Pure, and here rather than in the editor, because the editor computed the
 * breadcrumb chain and the download filename from the same source with two
 * separate copies of the slug expression. One of them went stale when the
 * create screens moved out — the editor kept computing a `slug` that nothing
 * read any more, while the download rebuilt it inline.
 */
import type { ContentType } from "@maleo/shared";

/** The content the title is derived from, per type. */
export interface ProjectTitleSource {
	type: ContentType | null;
	/** The first marker's title (video). */
	firstMarkerTitle?: string | null;
	/** The first slide's name (image). */
	firstSlideName?: string | null;
	/** The first post's body (text); trimmed to a title length here. */
	firstPostBody?: string | null;
}

/** The project's name as its content implies it, or "" for an unknown type. */
export function titleFromContent(source: ProjectTitleSource): string {
	switch (source.type) {
		case "video":
			return source.firstMarkerTitle?.trim() || "Storyboard";
		case "image":
			return source.firstSlideName?.trim() || "Carousel";
		case "text":
			return source.firstPostBody?.slice(0, 32) || "Draft";
		case null:
		default:
			return "";
	}
}

/** A filesystem-safe slug, for a download filename. Empty when there is nothing
 *  to slugify, so callers choose their own fallback rather than inheriting one. */
export function titleSlug(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "");
}

/** The breadcrumb's label: the operator's own title wins over the derived one. */
export function titleForCrumb(operatorTitle: string | undefined, derived: string): string {
	return operatorTitle?.trim() || derived || "Untitled";
}

/** The title an output row or a render carries. */
export function titleForOutput(derived: string, type: ContentType | null): string {
	return derived || `${type ?? "content"} deliverable`;
}
