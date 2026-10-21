/* The persisted sidecar: which layer supplied each element, and a project's
 * overrides of its render-scope defaulter.
 *
 * Both live in `editor_state_json` and are OPTIONAL. A project written before this
 * existed carries neither, and that absence is a meaningful value rather than
 * something to backfill: a missing source reads as operator-owned, so nothing that
 * predates provenance gets overwritten on the strength of not knowing. An EMPTY map
 * means the same thing as an absent one — no element has a source, so every element
 * resolves to operator-owned — which is why neither needs special handling.
 *
 * `render_overrides` exists because a project had no way to diverge from its timeline
 * template. The project points at a shared row and reads every render field from it,
 * so an operator could only edit the shared row — affecting every other project using
 * it — or accept its value. Overrides sit between the template and the operator, which
 * is what makes divergence representable at all, and therefore what makes the
 * library's "N diverged" view possible.
 *
 * These are read from persisted JSON, so they are PARSED rather than cast. A blob can
 * carry anything: an older shape, a hand-edited row, a key from a build that has since
 * been renamed. An unknown layer is dropped rather than coerced, because coercing it
 * would invent provenance, and inventing provenance is worse than admitting none.
 */
import {
	entriesOfUnknown,
	ELEMENT_LAYERS,
	fieldOf,
	oneOf,
	type ElementSource,
} from "@maleo/shared";
import type { TemplateParams, TemplateParamValue } from "@maleo/shared";

/** Source per element path. Absent keys read as operator-owned. */
export type ElementSourceMap = Readonly<Record<string, ElementSource>>;

/** A project's own values for render-scope elements, keyed by the template field
 *  they override. Which SHAPE a given field holds is the template's own schema's
 *  business — duplicating that knowledge here is how the two drift apart — but
 *  the values are the same JSON a template parameter is, so they say so. */
export type RenderOverrides = Readonly<TemplateParams>;

function parseSource(raw: unknown): ElementSource | null {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	// `oneOf` RETURNS the matched member, so the membership test and the narrowing
	// are one step. This was a `Set` lookup on the line above and a cast on the
	// line below — the same check written twice, once for the runtime and once
	// for the compiler.
	const layer = oneOf(fieldOf(raw, "layer"), ELEMENT_LAYERS);
	if (!layer) return null;
	const declared = fieldOf(raw, "defaulterId");
	const defaulterId = typeof declared === "string" && declared ? declared : null;
	return { layer, defaulterId };
}

/** Read the source map from a persisted blob, dropping anything unrecognisable.
 *
 *  Dropping is deliberate: an entry that cannot be understood leaves that element
 *  with no source, which reads as operator-owned, which is the safe direction. */
export function parseElementSources(raw: unknown): ElementSourceMap {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
	const out: Record<string, ElementSource> = {};
	for (const [path, value] of entriesOfUnknown(raw)) {
		if (!path.trim()) continue;
		const source = parseSource(value);
		if (source) out[path] = source;
	}
	return out;
}

/** Read the render overrides from a persisted blob. `undefined` values are dropped:
 *  an override whose value is undefined is indistinguishable from no override, and
 *  keeping it would make "is this overridden?" answer yes with nothing to show. */
export function parseRenderOverrides(raw: unknown): RenderOverrides {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
	const out: TemplateParams = {};
	for (const [field, value] of entriesOfUnknown(raw)) {
		if (!field.trim() || value === undefined) continue;
		// SAFETY: `raw` is a stored override block, which reached this process as
		// JSON — every value in it is therefore a JSON value. The loop drops
		// `undefined`, which JSON cannot carry anyway.
		out[field] = value as TemplateParamValue;
	}
	return out;
}

/** The source recorded for an element, or undefined when none is. Callers treat
 *  undefined as operator-owned via `isOverridden`; this does not decide that for
 *  them, because a reader that wants to know "was this ever recorded?" needs the
 *  distinction. */
export function sourceFor(sources: ElementSourceMap, path: string): ElementSource | undefined {
	return sources[path];
}

/** Record a source for one element, returning a new map. */
export function withSource(
	sources: ElementSourceMap,
	path: string,
	source: ElementSource,
): ElementSourceMap {
	return { ...sources, [path]: source };
}

/** Record sources for several elements at once, returning a new map. */
export function withSources(
	sources: ElementSourceMap,
	entries: ReadonlyArray<readonly [string, ElementSource]>,
): ElementSourceMap {
	return entries.length ? { ...sources, ...Object.fromEntries(entries) } : sources;
}

/** Drop an element's source, returning a new map. Used by revert, where the element
 *  goes back to being supplied rather than owned. */
export function withoutSource(sources: ElementSourceMap, path: string): ElementSourceMap {
	if (!(path in sources)) return sources;
	const next = { ...sources };
	delete next[path];
	return next;
}
