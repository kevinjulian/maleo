/* The editable timeline document. A plain `TimelineDoc` plus the editor's own
 * caption config and track flags — no store, no React: the store that holds one
 * lives in state/timeline-document-store.ts. */
import type { EditorDoc } from "@maleo/shared/editor";

export type { EditorDoc };

export type DocUpdater = (doc: EditorDoc) => EditorDoc;
