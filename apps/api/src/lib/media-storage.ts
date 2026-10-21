import { mediaObjectUrl, registerMediaObject } from "@maleo/db/media-objects";
import { putMedia, type MediaKind } from "@maleo/storage";
import type { Db } from "@maleo/db/handle";

/** Publish identity only after bytes reached storage. A failed registry insert
 * leaves an orphan for collection, never a URL pointing at absent bytes. */
export async function storeManagedMedia(input: {
	workspace: string;
	kind: MediaKind;
	body: Blob | Uint8Array;
	contentType: string;
	/** Owning project, when there is one; omitted for workspace-library media. */
	project?: string | null;
	/** Shown in a bucket listing; derived from kind and content type when absent. */
	filename?: string;
	db?: Db;
}): Promise<string> {
	const stored = await putMedia(input);
	const row = await registerMediaObject(
		{
			workspace: input.workspace,
			kind: input.kind,
			hash: stored.hash,
			storage_key: stored.key,
			content_type: stored.contentType,
			size: stored.size,
		},
		input.db,
	);
	return mediaObjectUrl(row.id);
}
