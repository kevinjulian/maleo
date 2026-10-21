/* The inspector sections a selected motion layer has.
 *
 * One list, two readers — the same arrangement `clip-property-groups.tsx`
 * already makes for the content editor, and for the same reason. The docked
 * inspector draws these as accordions down the panel; the phone's bottom bar
 * draws them as a row of controls that open the sheet at one of them. They are
 * the same question — "what can be edited about this thing?" — and the answer
 * used to live only inside the inspector's render closure, where the bar could
 * not reach it. A second copy would mean a section gained in one surface and
 * not the other, with nothing to catch the divergence.
 *
 * Icons are stored as registry factories so the rail and phone bar can render
 * the same category glyph at the editor's 17px size.
 */
import type { JSX } from "react";
import { Ic } from "@design-system/icons/index.tsx";

export type MotionLayerSectionKey = "content" | "placement" | "motion" | "style" | "timing";

export interface MotionLayerSection {
	k: MotionLayerSectionKey;
	/** The accordion's label, and the control's accessible name. One string, so
	 *  the bar cannot announce a destination the panel does not have. */
	label: string;
	icon: (s?: number) => JSX.Element;
}

/** Every section a layer carries. Unlike a clip's groups these do not vary by
 *  kind: a motion layer is a box with content, a position, an animation, a
 *  look and a lifetime, whether it is text or a shape. */
export const MOTION_LAYER_SECTIONS: readonly MotionLayerSection[] = [
	{ k: "content", label: "Content", icon: Ic.edit },
	{ k: "placement", label: "Placement", icon: Ic.box },
	{ k: "motion", label: "Motion", icon: Ic.bolt },
	{ k: "style", label: "Style", icon: Ic.palette },
	{ k: "timing", label: "Timing", icon: Ic.clock },
] as const;

/** The one destination a studio offers when nothing is selected. */
export const MOTION_IDENTITY_SECTION = {
	k: "identity",
	label: "Motion identity",
	icon: Ic.edit,
} as const;
