/* The field box: one recipe for Input, Textarea and Select, so three controls
 * that sit side by side in a form cannot drift apart again.
 *
 * Sizes are the control-height scale (foundations, Sizing & Density):
 *   xs  24  the editor field — filled, borderless at rest, inset focus ring
 *   sm  32  compact forms and toolbars
 *   md  40  forms and settings outside the editor
 *
 * Size changes density only; every field uses the filled value surface.
 * Every state is defined here: hover lifts the surface, focus draws the
 * foundation ring (inset on the dense editor field, where an outer ring would
 * collide with its neighbour), disabled fades and stops hover, invalid turns
 * the border destructive. Under a coarse pointer every size grows to the touch
 * floor, as Button does: a 24px field is a mouse target, not a finger's. Nothing about a field's look lives in a stylesheet
 * any more; `cv-input` and `cv-select` were retired with their rules. */

export type FieldSize = "xs" | "sm" | "md";

const BOX =
	"tw:min-w-0 tw:rounded-md tw:border tw:font-sans tw:text-foreground tw:placeholder:text-muted-foreground tw:transition-colors tw:disabled:cursor-not-allowed tw:disabled:opacity-50 tw:aria-invalid:border-destructive tw:pointer-coarse:min-h-[var(--control-h-touch)]";

const FILLED =
	"tw:border-transparent tw:bg-secondary tw:hover:bg-accent tw:disabled:hover:bg-secondary tw:focus-visible:bg-[var(--surface-raised)] tw:focus-visible:outline-ring";

/* Filled rather than outlined, so a column of values reads as values and not
 * as a stack of form boxes; lifted to `--surface-raised` while focused. */
const EDITOR = "tw:py-0 tw:tabular-nums";

const SIZE: Record<FieldSize, string> = {
	xs: "tw:min-h-[var(--control-h-xs)] tw:px-1.5 tw:text-xs",
	sm: "tw:min-h-[var(--control-h-sm)] tw:px-2.5 tw:text-xs",
	md: "tw:min-h-[var(--control-h)] tw:px-3 tw:text-sm",
};

/* `fill` false keeps the intrinsic width. A layered `width: auto` cannot undo
 * `tw:w-full`: utilities is the last cascade layer. */
export function fieldClass(size: FieldSize, fill = true): string {
	return `${fill ? "tw:w-full " : ""}${BOX} ${FILLED} ${size === "xs" ? `${EDITOR} tw:focus-visible:outline-1 tw:focus-visible:-outline-offset-1` : "tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2"} ${SIZE[size]}`;
}

/* A number field's native spinner is web-form chrome; the arrow keys still
 * step the value. */
export const NO_SPINNER =
	"tw:[appearance:textfield] tw:[&::-webkit-inner-spin-button]:appearance-none tw:[&::-webkit-outer-spin-button]:appearance-none";

/* The platform chevron is drawn at the platform's weight in the text colour,
 * the heaviest mark in a dense panel. Every Select draws this one instead: two
 * gradient strokes in `--muted`, no asset, theme-aware. The geometry is glyph
 * drawing, not spacing. */
export const SELECT_CHEVRON =
	"tw:appearance-none tw:cursor-pointer tw:pr-6 tw:bg-no-repeat tw:bg-[image:linear-gradient(45deg,transparent_50%,var(--muted)_50%),linear-gradient(135deg,var(--muted)_50%,transparent_50%)] tw:bg-[position:calc(100%-11px)_55%,calc(100%-7px)_55%] tw:bg-[size:4px_4px]";
