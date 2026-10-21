/* The library's geometry query, published on the surface it describes.
 *
 * A painted item has no element to measure. Every assertion the suite used to
 * make by reading a clip's box would therefore not fail when the item moved to
 * the canvas — it would quietly stop existing, which is the worst outcome
 * available. `@maleo/vui`'s geometry query is the replacement: it reports what
 * the kernel computed, in the kernel's units, rather than measuring anything.
 *
 * Published on the surface's own root element rather than on `window`. Three
 * timelines are open at once in this app — the editor's, Motion Studio's, and
 * the template preview's — and a global would either name them or collide. The
 * root is already how a caller says which timeline it means.
 *
 * This is not a test hook. The query is a shipped interface: a consumer building
 * its own assertions, its own inspector, or its own accessibility layer needs
 * exactly these answers, and there is nowhere else to get them.
 */
import type { GeometryQuery } from "./query.ts";

/** An element carrying the query for the timeline rooted at it. */
export interface GeometryHost extends HTMLElement {
	vuiGeometry?: GeometryQuery;
}

/**
 * Attach a query to its surface, or detach it.
 *
 * Detaching on teardown matters: a query left on a removed element still answers
 * from the store it closed over, so a stale one reports confidently about a
 * timeline that is no longer on screen.
 */
export function publishGeometry(
	node: HTMLElement | null | undefined,
	query: GeometryQuery | undefined,
): void {
	if (!node) return;
	/* SAFETY: `GeometryHost` adds one optional property to `HTMLElement` and
	 * changes nothing else, so every element satisfies it — the assertion names
	 * the property this function is about to write rather than claiming the
	 * element is something it is not. Reading it back elsewhere still has to
	 * handle `undefined`, which is the case where nothing published. */
	const host = node as GeometryHost;
	if (query === undefined) delete host.vuiGeometry;
	else host.vuiGeometry = query;
}
