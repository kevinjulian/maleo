// ClipLayout / ClipTextStyle are part of the shared timeline domain model (one
// source of truth, shared with the render worker). Re-exported so existing
// `./clip-layout.ts` imports keep resolving.
export type { ClipLayout, ClipTextStyle } from "@maleo/shared";

export type { ClipKind } from "@maleo/shared";
/* The layout a clip has when a field is absent or out of range, and a text
 * preset's default style, are shared-core rules (`crates/app-core/src/layout.rs`,
 * `p1-envelope-inspector`). Reads tolerate a malformed field by dropping it; save
 * and agent boundaries are where invalid input is refused. */
export { defaultTextStyle, normalizeLayout } from "@maleo/shared/editor/inspector-rules";

/* ── The three widths a clip's geometry turns on ── */

/** A clip narrower than this is unreadable; the timeline has always clamped to
 *  it so a sub-second clip at wide zoom is at least a visible sliver. */
export const MIN_CLIP_PX = 16;

/** And unreachable below this, on a finger. 44px is the platform minimum, and
 *  padding a clip up to it is the one place this timeline stops telling the
 *  truth about duration — which is why the padding is drawn rather than applied
 *  silently. The alternative is a clip that cannot be tapped at all. */
export const TOUCH_MIN_CLIP_PX = 44;

/** Two 44px trim handles plus enough body left to grab. Below this a clip is
 *  moved by its body and must be zoomed into before it can be trimmed — there is
 *  no trim precision at that zoom anyway, so the handles would be a promise the
 *  geometry cannot keep. */
export const TOUCH_TRIM_MIN_PX = 132;

/** The trim handle's drawn width, matching `--tl2-handle-w` in tracks-interaction.css. */
export const CLIP_HANDLE_PX = 16;
