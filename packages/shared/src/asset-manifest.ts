/* The media a project references (`p1-asset-identity` D4): one entry per identity,
 * derived from the document and its media library on request, never stored. */
import { z } from "zod";
import { mediaUrlId } from "./media-id.ts";
import { MAX_INLINE_IMAGE_CHARS, MEDIA_FIELD } from "./pending-media.ts";

type Draft = { type: "managed"; id: string; url: string } | { type: "external"; url: string };

/** `used`: the document places it; a library entry alone is listed, not used. */
export type AssetReference = Draft & { label?: string; used: boolean };

function referenceOf(url: string): { key: string; ref: Draft } | undefined {
	const id = mediaUrlId(url);
	if (id) return { key: `managed:${id}`, ref: { type: "managed", id, url } };
	// Small inline images are stored in the document itself; they are not media.
	if (url.startsWith("data:image/") && url.length <= MAX_INLINE_IMAGE_CHARS) return undefined;
	if (/^(https?:\/\/|\/)/i.test(url))
		return { key: `external:${url}`, ref: { type: "external", url } };
	return undefined;
}

const namedSchema = z.object({
	url: z.string().optional(),
	label: z.string().min(1).optional(),
	metadata: z
		.object({ originalFilename: z.string().min(1) })
		.partial()
		.optional(),
});

/** A library entry's original filename, else its label. */
const nameOf = (value: unknown): string | undefined => {
	const named = namedSchema.safeParse(value);
	return named.success ? (named.data.metadata?.originalFilename ?? named.data.label) : undefined;
};

/** Every media reference in `document` (used) and `libraryAssets` (listed), once per
 *  identity. Media fields follow the same rule as `localMediaUrlIssues`; a library
 *  entry's filename names the file before any label in the document. */
export function collectAssetReferences(
	document: unknown,
	libraryAssets: unknown = [],
): AssetReference[] {
	const refs = new Map<string, AssetReference>();
	// `preferred`: a library filename outranks a label found in the document.
	const note = (url: string, name: string | undefined, used: boolean, preferred: boolean) => {
		const found = referenceOf(url);
		if (!found) return;
		const current = refs.get(found.key);
		const label = preferred ? (name ?? current?.label) : (current?.label ?? name);
		refs.set(found.key, {
			...found.ref,
			...(label ? { label } : {}),
			used: used || Boolean(current?.used),
		});
	};
	const visit = (value: unknown): void => {
		if (Array.isArray(value)) value.forEach(visit);
		else if (value && typeof value === "object")
			for (const [key, field] of Object.entries(value)) {
				if (typeof field === "string" && MEDIA_FIELD.test(key))
					note(field, nameOf(value), true, false);
				else visit(field);
			}
	};
	visit(document);
	for (const asset of Array.isArray(libraryAssets) ? libraryAssets : []) {
		const url = namedSchema.safeParse(asset).data?.url;
		if (url) note(url, nameOf(asset), false, true);
	}
	return [...refs.values()];
}

/** Whether `value` references a managed identity listed in `pendingIds`
 *  (the project's unfinished imports). */
export function referencesPendingMedia(
	value: unknown,
	pendingIds: readonly string[] = [],
): boolean {
	return collectAssetReferences(value).some(
		(ref) => ref.type === "managed" && pendingIds.includes(ref.id),
	);
}
