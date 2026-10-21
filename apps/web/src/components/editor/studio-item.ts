/* The two arms the Scene Studio edits: a video scene or an image slide. */
import type { Scene } from "@maleo/shared";
import type { Slide } from "@models/content/content-types.ts";

export type StudioItem = Scene | Slide;

/* The union carries no tag, so the arms are told apart by a field only one of
 * them declares: a scene has a duration, a slide has a caption. The studio knows
 * which arm it holds from `type`, but a `ContentType` and an item list are two
 * separate values and the compiler cannot see that they agree — which is why
 * every read of a scene field used to be asserted. Narrowing per item makes the
 * compiler check the arm instead. */
export const isScene = (item: StudioItem): item is Scene => "dur" in item;
export const isSlide = (item: StudioItem): item is Slide => "cap" in item;

/** A slide's caption, or the empty string when the item is a scene. */
export const capOf = (item: StudioItem): string => (isSlide(item) ? item.cap : "");
/** The label a card shows: a scene's name, else the slide's caption. */
export const labelOf = (item: StudioItem, i: number): string =>
	isScene(item) ? item.name : item.cap || `Slide ${i + 1}`;
