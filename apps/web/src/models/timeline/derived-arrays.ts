/* The per-type editor views, projected from the canonical clip document.
 *
 * This type lives in models rather than beside the store that produces it
 * because models is the layer both sides may import: the store derives the
 * value, and the hit-testing math consumes its shape. Defining it in the store
 * made `canvas-hit-clips.ts` import upward through a value it never calls, to
 * read a type. */
import { fromTimelineDoc } from "@maleo/shared";

export type DerivedArrays = ReturnType<typeof fromTimelineDoc>;
