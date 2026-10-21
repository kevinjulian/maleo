/* Caption configuration stays on the canonical timeline document. */
import type { CaptionConfig } from "@maleo/shared";
import {
	selectDocCaptions,
	useDocumentSelector,
	type TimelineDocumentStore,
} from "@stores/timeline-document-store.ts";
export function useEditorCaptions(args: {
	store: TimelineDocumentStore;
	setCaptions: (next: CaptionConfig | ((previous: CaptionConfig) => CaptionConfig)) => void;
}) {
	return {
		captions: useDocumentSelector(args.store, selectDocCaptions),
		setCaptions: args.setCaptions,
	};
}
