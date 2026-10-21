/* The editor's media import: `useMediaImport` wired to the project's library and
 * document, so a chosen file is a pending asset at once (`use-media-while-uploading`). */
import { useEffect } from "react";
import { isPendingMediaUrl, pendingMediaRequestKey } from "@maleo/shared";
import type { TimelineDocumentStore } from "@stores/timeline-document-store.ts";
import type { DocumentWriters } from "@stores/document-writers.ts";
import { removeUnusedProjectMedia } from "@models/timeline/media-library.ts";
import { mediaUsages } from "@models/timeline/media-usage.ts";
import { chosenFileReason, removeMediaWithUses } from "@models/timeline/pending-media-recovery.ts";
import { useMediaImport } from "./use-media-import.ts";
import type { ReferenceLibraryState } from "./use-reference-library.ts";

export function useProjectMediaImport(
	projectId: string | null,
	library: ReferenceLibraryState,
	store: TimelineDocumentStore,
	writers: DocumentWriters,
) {
	const imports = useMediaImport(projectId, (asset) => library.ensureMediaAsset(asset), {
		admit: (asset) => {
			library.ensureMediaAsset(asset);
		},
		has: (key) =>
			library.getMediaAssets().some((asset) => pendingMediaRequestKey(asset.url) === key),
		// Unused, it simply leaves the library; used, it leaves with its clips as one undo step.
		discard: (key) => {
			if (!mediaUsages(key, store.deriveArrays()).length) {
				library.setMediaAssets((assets) =>
					removeUnusedProjectMedia(assets, [key], store.deriveArrays()),
				);
				return undefined;
			}
			try {
				writers.apply((scope) => removeMediaWithUses(scope, key));
				return undefined;
			} catch (failure) {
				return failure instanceof Error ? failure.message : String(failure);
			}
		},
		validate: (key, kind, duration) =>
			chosenFileReason(
				{ doc: store.getDoc(), mediaAssets: library.getMediaAssets() },
				key,
				kind,
				duration,
			),
	});
	// A loaded project's pending references resolve to finished imports, or follow unfinished ones.
	const { mediaAssets } = library,
		{ resolve } = imports;
	useEffect(() => {
		resolve(mediaAssets.filter((asset) => isPendingMediaUrl(asset.url)));
	}, [mediaAssets, resolve]);
	return imports;
}
