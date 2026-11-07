/* The complete local file the preview loaded for a manifest entry (OpenSpec
 * p2-export E9). Browser export preflight hashes it and the export decodes it, so
 * each source's bytes are fetched once, by the preview's loader. A managed
 * source matches by media id, any other source by its exact URL. */
import { mediaUrlId } from "@maleo/shared";
import type { ManifestEntry } from "@models/render/export-preflight.ts";
import { borrowLocalPreviewSource } from "./local-sources.ts";
import type { PreviewMediaSession } from "./session.ts";

export function localFileLookup(
	session: Pick<PreviewMediaSession, "sourceUrls" | "resolve">,
	borrow: typeof borrowLocalPreviewSource = borrowLocalPreviewSource,
): (entry: ManifestEntry) => File | undefined {
	return (entry) => {
		const id = mediaUrlId(entry.url);
		const url = session
			.sourceUrls()
			.find(
				(candidate) =>
					candidate === entry.url || (id !== undefined && mediaUrlId(candidate) === id),
			);
		const local = url === undefined ? undefined : session.resolve(url);
		if (!local) return undefined;
		try {
			const held = borrow(local, async () => {});
			const file = held.source.file;
			held.release();
			return file;
		} catch {
			return undefined;
		}
	};
}
