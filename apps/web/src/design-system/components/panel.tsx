/* The panel hierarchy, as two primitives rather than one.
 *
 * `tl2-panel` and `tl2-dsec` are two tiers of a nesting structure, not two
 * names for one thing:
 *
 *     Panel    the rail container. `width: var(--tl2-panel-w)`, flex column,
 *              `position: relative` so the element detail has a containing block,
 *              a right border, and `tl2-panel-sheet` turns it into a bottom sheet
 *              at phone width. One per rail.
 *     Section   a titled group inside a panel body: `flex-direction: column;
 *              gap: 11px`, with a header, an optional hint and a note.
 *
 * There was a third, Control (one labelled range input under a live value). It
 * was replaced by PropertyRow and AmountRow in design-system/patterns, which
 * put the label beside the control and build on canonical components.
 *
 * `tl2-clippanel`, the docked clip inspector, is NOT inside `tl2-panel`: they
 * are siblings, so "Panel contains Section" holds for the rail panels and the
 * inspector reaches Section by its own route.
 *
 * These emit today's classes and move no pixels.
 */
import type { HTMLAttributes, JSX } from "react";
import { cn } from "@models/core/cn.ts";

export type PanelProps = HTMLAttributes<HTMLElement> & {
	/** `sheet` adds `tl2-panel-sheet`, the phone-width bottom-sheet treatment. */
	sheet?: boolean;
	as?: "aside" | "div";
};

export function Panel({ sheet, as = "aside", className, ...rest }: PanelProps): JSX.Element {
	const Tag = as;
	return <Tag className={panelClassName({ sheet, className })} {...rest} />;
}

/* The panel's classes as a string, for the one caller that cannot use the
 * component: at phone width the host is wrapped in a `Sheet`, so the classes
 * belong on someone else's element. Exposing them here keeps the spelling in the
 * file that owns it — a literal `className="tl2-panel"` anywhere else is what
 * the retired-spelling check exists to fail. */
export function panelClassName({
	sheet,
	className,
}: { sheet?: boolean; className?: string } = {}): string {
	return cn("tl2-panel", sheet ? "tl2-panel-sheet" : "", className);
}

export type SectionProps = HTMLAttributes<HTMLElement> & { as?: "section" | "div" };

export function Section({ as = "section", className, ...rest }: SectionProps): JSX.Element {
	const Tag = as;
	return <Tag className={cn("tl2-dsec", className)} {...rest} />;
}
