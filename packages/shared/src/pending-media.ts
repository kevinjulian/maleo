/* Small inline images (a blank studio pixel, a captured video poster) survive reload
 * and are already stored; anything larger belongs in managed media. */
export const MAX_INLINE_IMAGE_CHARS = 64 * 1024;
export const MEDIA_FIELD = /(?:^|[a-z])(?:url|src|thumb|image)$/i;

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
