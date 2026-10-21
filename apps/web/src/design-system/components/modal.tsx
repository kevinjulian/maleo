import { createPortal } from "react-dom";
import "./modal.css";
import type { JSX, ReactNode } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { OverlayHostContext, useOverlay } from "@hooks/ui/use-overlay.ts";
import { cn } from "@models/core/cn.ts";
import { IconButton } from "@design-system/components/icon-button.tsx";

export interface ModalProps {
	title: ReactNode;
	sub?: ReactNode;
	onClose: () => void;
	/** Close this dialog before browser Back leaves its page. */
	dismissOnBack?: boolean;
	children?: ReactNode;
	width?: number;
	/* At phone width the dialog leaves the middle of the screen and sits on the
	 * bottom edge, full-width, with only its top corners rounded.
	 *
	 * A typed prop rather than the `sheet-mobile` class two call sites used to
	 * spell, and the rename is the point: the class said Sheet, so a Modal wore
	 * another primitive's name for a treatment that is not that primitive's job.
	 * A Sheet SLIDES in from an edge and is the phone form of a panel; a docked
	 * Modal still pops, still interrupts, still demands the decision it was
	 * opened for — it has changed where it sits, not what it is. Keeping the two
	 * apart is what stops "make it a sheet on phones" from becoming a second
	 * overlay mechanism.
	 *
	 * The class is `cv-modal-dock`, so the stylesheet says Modal too. */
	dock?: boolean;
	className?: string;
	bodyClassName?: string;
}

export function Modal({
	title,
	sub,
	onClose,
	dismissOnBack = false,
	children,
	width = 460,
	dock = false,
	className = "",
	bodyClassName = "",
}: ModalProps): JSX.Element | null {
	const { host, mounted, panelRef } = useOverlay<HTMLDivElement>({
		open: true,
		onClose,
		zOrder: 1100,
		dismissOnBack,
	});
	const tree =
		(
			/* The backdrop carries the dock flag too, rather than the stylesheet
			 * reaching for `:has(.cv-modal-dock)`. The phone rule has to change the
			 * backdrop's alignment AND the dialog's geometry, and those are one
			 * decision: aligning every backdrop to the bottom edge — which is what
			 * the rule did before this — dropped plain modals onto the edge with all
			 * four corners still rounded and their side padding gone, so a dialog
			 * that never asked to dock got half a dock. */
			<div
				role="presentation"
				className={cn("cv-modal-back", dock && "cv-modal-back-dock")}
				onClick={onClose}
			>
				<div
					ref={panelRef}
					className={cn("cv-modal", dock && "cv-modal-dock", className)}
					style={{ width, maxWidth: "94vw" }}
					role="dialog"
					aria-modal="true"
					aria-label={typeof title === "string" ? title : "Dialog"}
					tabIndex={-1}
					onClick={(event) => event.stopPropagation()}
					onKeyDown={(event) => {
						// Embedded menus dismiss through document-level Escape listeners.
						if (event.key !== "Escape") event.stopPropagation();
					}}
				>
					<div className="cv-modal-h">
						<div className="tw:min-w-0">
							<div className="cv-modal-title">{title}</div>
							{sub && <div className="cv-modal-sub">{sub}</div>}
						</div>
						<IconButton onClick={onClose} aria-label="Close">
							{Ic.x(ICON.md)}
						</IconButton>
					</div>
					<div className={cn("cv-modal-body", bodyClassName)}>{children}</div>
				</div>
			</div>
		);
	if (!host) return tree;
	return mounted
		? createPortal(
				<OverlayHostContext.Provider value={host}>{tree}</OverlayHostContext.Provider>,
				host,
			)
		: null;
}
