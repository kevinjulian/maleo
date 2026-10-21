import type { CSSProperties, JSX, ReactNode } from "react";
import { VuiOverlay, type VuiDismissReason } from "./overlay.tsx";

export type VuiSheetPlacement = "bottom" | "left" | "right" | "fullscreen";
/* Literal class names, one per placement, so the stylesheet's placement rules
 * have a renderer the structural check can read (as the app Sheet's SHEET_EDGE). */
const PLACEMENT_CLASS = {
	bottom: "vui-sheet-bottom",
	left: "vui-sheet-left",
	right: "vui-sheet-right",
	fullscreen: "vui-sheet-fullscreen",
} as const satisfies Record<VuiSheetPlacement, string>;
export interface VuiSheetProps {
	open: boolean;
	title: string;
	children: ReactNode;
	onRequestClose: (reason: VuiDismissReason) => void;
	placement?: VuiSheetPlacement;
	ownerDocument?: Document;
	className?: string;
	style?: CSSProperties;
	dismissOnEscape?: boolean;
	dismissOnScrim?: boolean;
}
export function VuiSheet({
	open,
	title,
	children,
	onRequestClose,
	placement = "bottom",
	ownerDocument,
	className,
	style,
	dismissOnEscape = true,
	dismissOnScrim = true,
}: VuiSheetProps): JSX.Element | null {
	return (
		<VuiOverlay
			open={open}
			label={title}
			kind="sheet"
			onRequestClose={onRequestClose}
			ownerDocument={ownerDocument}
			dismissOnEscape={dismissOnEscape}
			dismissOnScrim={dismissOnScrim}
			className={
				className
					? `vui-sheet-overlay ${PLACEMENT_CLASS[placement]} ${className}`
					: `vui-sheet-overlay ${PLACEMENT_CLASS[placement]}`
			}
			style={style}
		>
			<div className="vui-sheet" data-vui-slot="sheet" data-vui-placement={placement}>
				<header className="vui-sheet-header" data-vui-slot="sheet-header">
					<strong>{title}</strong>
					<button
						type="button"
						onClick={() => onRequestClose("close-button")}
						aria-label={`Close ${title}`}
					>
						×
					</button>
				</header>
				<div className="vui-sheet-body" data-vui-slot="sheet-body">
					{children}
				</div>
			</div>
		</VuiOverlay>
	);
}
