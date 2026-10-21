/* A pane that slides in over the app from a viewport edge, behind a scrim.
 *
 * The behaviour is not new — `.nav-drawer` / `.nav-scrim` in
 * app/styles/shell.css has done exactly this since the mobile nav landed. It
 * becomes a primitive here because the editor needs two more instances at
 * phone width, and writing the pattern by hand a second and third time drops
 * the same two things every time: the `prefers-reduced-motion` arm and the
 * safe-area padding. Neither omission is visible in a diff.
 *
 * Following the rule the button primitives already set: the edge is a typed
 * value rather than a class name, so a misspelling fails `bun run typecheck`
 * instead of rendering a pane that never moves.
 */
import { createPortal } from "react-dom";
import type { JSX, ReactNode } from "react";
import { cn } from "@models/core/cn.ts";
import { cssVars } from "@models/core/css-vars.ts";
import "./sheet.css";
import { countRender } from "@models/timeline/render-probe.ts";
import { OverlayHostContext, useOverlay } from "@hooks/ui/use-overlay.ts";

const SHEET_EDGE = {
	left: "ui-sheet-left",
	right: "ui-sheet-right",
	bottom: "ui-sheet-bottom",
} as const;

/** Which viewport edge the pane slides in from. A typed value, not a class
 *  name, so a misspelling fails typecheck instead of rendering a pane that
 *  never moves. */
export type SheetEdge = keyof typeof SHEET_EDGE;

export type SheetProps = { edge?: SheetEdge | null } & {
	/** Routed selection can own Back; local sheets retain the shared overlay entry. */
	dismissOnBack?: boolean;
	/** Routed inspectors resolve their surviving origin at dismissal. */
	returnFocus?: () => HTMLElement | null | undefined;
	open: boolean;
	onClose: () => void;
	/* Width for a side sheet, height for a bottom one. Any CSS length. */
	size?: string;
	/* Named for assistive tech: a sheet is a dialog, and an unlabelled dialog
	 * announces as nothing useful. */
	label: string;
	/* How far the sheet AND its scrim stand off the edge they are anchored to.
	 * Any CSS length; defaults to flush.
	 *
	 * It exists for the case where something at that edge must stay live while
	 * the sheet is open. The editor's contextual clip bar is the example: it is
	 * what says which clip is selected and how to deselect, and the properties
	 * sheet is opened FROM it — so a sheet that covered it left the operator
	 * inside a mode with its only exit underneath a scrim. The scrim has to move
	 * too, or the bar is visible and untappable, which is worse than hidden. */
	offset?: string;
	/* The same idea at the OPPOSITE edge: how much the sheet and its scrim keep
	 * clear of the far side.
	 *
	 * For a bottom sheet that is the top, and the editor's transport is why it
	 * exists. Undo, redo, play and the timecode sit there, and so does the
	 * control that opens the tools sheet — covering it made switching sheets
	 * cost two taps, one to dismiss and one to reopen, with the second aimed at
	 * a control the operator could no longer see. */
	headroom?: string;
	className?: string;
	children: ReactNode;
};

export function Sheet({
	edge,
	open,
	onClose,
	dismissOnBack = true,
	returnFocus,
	size,
	offset,
	headroom,
	label,
	className,
	children,
}: SheetProps): JSX.Element | null {
	countRender("sheet");
	/* Back closes the sheet rather than leaving the page: a sheet is a place the
	 * operator went, and on a phone Back is the gesture reached for first. The
	 * shared history entry and "which overlay is on top" both live in
	 * controllers/overlay, so a modal above the sheet absorbs Back. */
	const { host, mounted, panelRef } = useOverlay<HTMLElement>({
		open,
		onClose,
		zOrder: 700,
		aboveCurrent: true,
		persistentAttribute: "data-app-overlay-persistent",
		dismissOnBack,
		returnFocus,
	});

	/* One object for both, so the scrim can never stand off a different amount
	 * from the sheet — which would leave a live strip that looks dismissible and
	 * a dead one that looks live. */
	const vars = cssVars({
		...(size ? { "--ui-sheet-size": size } : {}),
		...(offset ? { "--ui-sheet-offset": offset } : {}),
		...(headroom ? { "--ui-sheet-headroom": headroom } : {}),
	});
	const styled = size || offset || headroom ? vars : undefined;

	const tree = (
		<>
			<div
				className={cn("ui-sheet-scrim", open && "ui-sheet-open")}
				style={styled}
				onClick={onClose}
				aria-hidden
			/>
			<aside
				ref={panelRef}
				className={cn("ui-sheet", SHEET_EDGE[edge ?? "left"], open && "ui-sheet-open", className)}
				style={styled}
				role="dialog"
				aria-modal="true"
				aria-label={label}
				tabIndex={-1}
				/* A closed sheet is translated off-screen but still in the tree, so
				 * without these its focusable children stay in the tab order and the
				 * keyboard walks into a pane nobody can see. `inert` is a boolean
				 * attribute in the React 19 types, not the empty string the HTML
				 * spec writes. */
				aria-hidden={!open}
				inert={!open}
			>
				{children}
			</aside>
		</>
	);

	/* Portalled to the body for the same reason the lightbox is: a sheet
	 * rendered in place would be clipped by the first ancestor with
	 * `overflow: hidden`, and `.cv-studio` and `.tl2-body` both have one.
	 *
	 * The guard is not SSR support — this client mounts with createRoot and
	 * never renders on a server. It exists so the primitive can be rendered to
	 * a string in a test, since `createPortal` needs a real node and this repo
	 * runs `bun test` without a DOM. Placement is the only thing that differs;
	 * the markup asserted in sheet.test.tsx is the markup the browser gets. */
	if (!host) return tree;
	return mounted
		? createPortal(
				<OverlayHostContext.Provider value={host}>{tree}</OverlayHostContext.Provider>,
				host,
			)
		: null;
}
