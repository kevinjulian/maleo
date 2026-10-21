/* Re-render when a file still importing gets a new source (a local copy, then the
 * managed URL), so whatever resolves `pending:` references reads the current one. */
import { useSyncExternalStore } from "react";
import {
	pendingSourcesVersion,
	subscribePendingSources,
} from "@models/core/pending-media-sources.ts";

export function usePendingMediaVersion(): number {
	return useSyncExternalStore(
		subscribePendingSources,
		pendingSourcesVersion,
		pendingSourcesVersion,
	);
}
