/* The upload state of the pending asset a media URL references, re-rendering only
 * when that asset's state changes. */
import { useSyncExternalStore } from "react";
import {
	pendingUploadStateOf,
	pendingUploadsVersion,
	subscribePendingUploadStates,
	type PendingUploadState,
} from "@models/core/pending-media-sources.ts";

export function usePendingUpload(url: string | undefined): PendingUploadState | undefined {
	const read = (): PendingUploadState | undefined => pendingUploadStateOf(url);
	return useSyncExternalStore(subscribePendingUploadStates, read, read);
}

/** Re-render when any pending asset's upload state changes (a list of many). */
export function usePendingUploadsVersion(): number {
	return useSyncExternalStore(
		subscribePendingUploadStates,
		pendingUploadsVersion,
		pendingUploadsVersion,
	);
}
