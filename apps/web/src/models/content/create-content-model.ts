/* Maleo — CreateContent domain model: the save enum and the one-time
 * initial-run marker. No component state, no JSX.
 *
 * The draft preview dims now sit beside FORMAT_DIMS in
 * models/timeline/timeline-editor-model.ts, which they are derived from; and
 * the export glyph was a duplicate of the registry's `Ic.export`. */
// Persisted save indicator shown in the workspace header.
export type SaveState = "idle" | "saving" | "saved" | "failed";

// In-memory trigger for the one-time initial agent run (the submitted brief). Set
// only on the live setup->work transition; never set on reload, so a reload never
// kicks off a second generation. runKey lets Retry re-fire it.
export interface PendingInitialRun {
	runKey: number;
	instruction: string;
}
