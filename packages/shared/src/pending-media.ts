import { z } from "zod";

/** Client-generated import identity; the same key names the pending asset and its server import. */
export const MediaImportRequestKeySchema = z
	.string()
	.min(1)
	.max(160)
	.regex(/^[A-Za-z0-9_-]+$/);

const PENDING_MEDIA_PREFIX = "pending:";

/** Stable document reference for a file still being imported. Never a browser-local URL. */
export function pendingMediaUrl(requestKey: string): string {
	return `${PENDING_MEDIA_PREFIX}${MediaImportRequestKeySchema.parse(requestKey)}`;
}

export function pendingMediaRequestKey(url: unknown): string | undefined {
	if (typeof url !== "string" || !url.startsWith(PENDING_MEDIA_PREFIX)) return undefined;
	const key = MediaImportRequestKeySchema.safeParse(url.slice(PENDING_MEDIA_PREFIX.length));
	return key.success ? key.data : undefined;
}

export function isPendingMediaUrl(url: unknown): boolean {
	return pendingMediaRequestKey(url) !== undefined;
}

const namedSchema = z.object({
	url: z.string(),
	label: z.string().min(1).optional(),
	metadata: z
		.object({ originalFilename: z.string().min(1) })
		.partial()
		.optional(),
});

/** Pending media is unavailable to server consumers; names each pending file `input` uses.
 *  `assets` (the project media library) only supplies names, so unplaced uploads never block. */
export function pendingMediaBlockers(input: unknown, assets: unknown = []): string[] {
	const used = new Map<string, string | undefined>();
	const visit = (value: unknown): void => {
		if (typeof value === "string") {
			const key = pendingMediaRequestKey(value);
			if (key && !used.has(key)) used.set(key, undefined);
		} else if (Array.isArray(value)) value.forEach(visit);
		else if (value && typeof value === "object") {
			const named = namedSchema.safeParse(value);
			const key = named.success ? pendingMediaRequestKey(named.data.url) : undefined;
			if (key && !used.get(key)) used.set(key, named.data!.label);
			Object.values(value).forEach(visit);
		}
	};
	visit(input);
	const assetNames = new Map<string, string>();
	for (const asset of Array.isArray(assets) ? assets : []) {
		const named = namedSchema.safeParse(asset);
		const key = named.success ? pendingMediaRequestKey(named.data.url) : undefined;
		const name = named.data?.metadata?.originalFilename ?? named.data?.label;
		if (key && name && !assetNames.has(key)) assetNames.set(key, name);
	}
	return [...used].map(([key, label]) => {
		const name = assetNames.get(key) ?? label;
		return `${name ?? "A file"} is still uploading. Wait for it to finish before export.`;
	});
}

/* Small inline images (a blank studio pixel, a captured video poster) survive reload
 * and are already stored; anything larger belongs in managed media. */
const MAX_INLINE_IMAGE_CHARS = 64 * 1024;
const MEDIA_FIELD = /(?:^|[a-z])(?:url|src|thumb|image)$/i;

/** Browser-local media URLs a saved document must not hold, named by field path.
 *  A `blob:` URL dies with the tab; a `data:` URL is refused unless it is a small image. */
export function localMediaUrlIssues(input: unknown): string[] {
	const issues: string[] = [];
	const visit = (value: unknown, path: string): void => {
		if (Array.isArray(value)) value.forEach((item, index) => visit(item, `${path}[${index}]`));
		else if (value && typeof value === "object") {
			for (const [key, field] of Object.entries(value)) {
				const at = path ? `${path}.${key}` : key;
				if (typeof field !== "string" || !MEDIA_FIELD.test(key)) visit(field, at);
				else if (field.startsWith("blob:")) issues.push(`${at} is a browser-local blob: URL`);
				else if (!field.startsWith("data:")) continue;
				else if (!field.startsWith("data:image/"))
					issues.push(`${at} is a data: URL that is not an image`);
				else if (field.length > MAX_INLINE_IMAGE_CHARS)
					issues.push(`${at} is a data: URL too large to store`);
			}
		}
	};
	visit(input, "");
	return issues;
}
