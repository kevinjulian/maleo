import { createPortal } from "react-dom";
import {
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
	type CSSProperties,
	type JSX,
	type KeyboardEvent,
	type ReactNode,
} from "react";
import { getVuiFocusable } from "@controllers/overlay/focusable.ts";
import { createFocusTrap, scrollLockForDocument } from "@controllers/overlay/focus-trap.ts";
import { overlayStackForDocument } from "@controllers/overlay/overlay-stack.ts";
import { VUI_PERSISTENT_ATTRIBUTE } from "@controllers/overlay/persistent.ts";

export type VuiDismissReason = "close-button" | "escape" | "scrim";
/** What kind of overlay this is, published so a consumer can name one. */
export type VuiOverlayKind = "dialog" | "sheet" | "workspace";
export interface VuiOverlayProps {
	open: boolean;
	label: string;
	children: ReactNode;
	onRequestClose?: (reason: VuiDismissReason) => void;
	ownerDocument?: Document;
	className?: string;
	style?: CSSProperties;
	dismissOnEscape?: boolean;
	dismissOnScrim?: boolean;
	kind?: VuiOverlayKind;
	mode?: "modal" | "fullscreen";
}
export function allowsVuiDismiss(
	reason: VuiDismissReason,
	dismissOnEscape: boolean,
	dismissOnScrim: boolean,
): boolean {
	if (reason === "escape") return dismissOnEscape;
	if (reason === "scrim") return dismissOnScrim;
	return true;
}
export function VuiOverlay({
	open,
	label,
	children,
	onRequestClose,
	ownerDocument,
	className,
	style,
	dismissOnEscape = true,
	dismissOnScrim = true,
	kind = "dialog",
	mode,
}: VuiOverlayProps): JSX.Element | null {
	const documentRef = ownerDocument ?? (typeof document === "undefined" ? null : document);
	const [host] = useState(() => documentRef?.createElement("div") ?? null);
	const [mounted, setMounted] = useState(false);
	const dialogRef = useRef<HTMLDivElement>(null);
	const openerRef = useRef<HTMLElement | null>(null);
	const id = useId();
	const closeRef = useRef(onRequestClose);
	closeRef.current = onRequestClose;
	const dismissRef = useRef({ dismissOnEscape, dismissOnScrim });
	dismissRef.current = { dismissOnEscape, dismissOnScrim };
	useLayoutEffect(() => {
		if (!open || !documentRef || !host) return;
		openerRef.current =
			documentRef.activeElement instanceof HTMLElement ? documentRef.activeElement : null;
		documentRef.body.appendChild(host);
		setMounted(true);
		return () => {
			setMounted(false);
			if (host.parentNode) host.parentNode.removeChild(host);
		};
	}, [documentRef, host, open]);
	useEffect(() => {
		const dialog = dialogRef.current;
		if (!open || !documentRef || !host || !dialog) return;
		const stack = overlayStackForDocument(documentRef);
		const overlay = host.firstElementChild instanceof HTMLElement ? host.firstElementChild : null;
		const release = stack.push({
			id,
			zOrder: kind === "sheet" ? 1020 : 1000,
			modal: true,
			element: overlay ?? undefined,
			host,
			persistentAttribute: VUI_PERSISTENT_ATTRIBUTE,
			onRequestClose: (reason) => {
				if (
					reason === "escape" &&
					allowsVuiDismiss(
						"escape",
						dismissRef.current.dismissOnEscape,
						dismissRef.current.dismissOnScrim,
					)
				)
					closeRef.current?.("escape");
			},
		});
		const unlock = scrollLockForDocument(documentRef).acquire();
		const trap = createFocusTrap<HTMLElement>({
			members: () => getVuiFocusable(dialog),
			opener: openerRef.current ?? undefined,
		});
		(documentRef.activeElement instanceof HTMLElement ? documentRef.activeElement : dialog).blur();
		(dialog.querySelector<HTMLElement>("[autofocus]") ?? trap.activate() ?? dialog).focus();
		return () => {
			release();
			unlock();
			trap.release();
		};
	}, [documentRef, host, id, mounted, open, kind]);
	const isTop = (): boolean =>
		documentRef != null &&
		overlayStackForDocument(documentRef).top()?.element === host?.firstElementChild;
	const dismiss = (reason: VuiDismissReason): void => {
		if (isTop() && allowsVuiDismiss(reason, dismissOnEscape, dismissOnScrim))
			onRequestClose?.(reason);
	};
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
		/* Only the TOP overlay acts, and when it does the event stops here.
		 *
		 * A nested overlay is a React child of the one beneath it, so its key
		 * events bubble through the parent's handler too — portals do not change
		 * the React tree. Without this, one Escape inside a sheet closed the sheet
		 * AND the editor underneath it, losing the edit. Bubbling runs inner
		 * first, so the inner overlay claims the key and the outer never sees it;
		 * an overlay that is not top has already been handled by one that is. */
		if (!isTop()) return;
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			overlayStackForDocument(documentRef!).handleKey("Escape");
			return;
		}
		if (event.key !== "Tab" || !dialogRef.current) return;
		event.stopPropagation();
		const elements = getVuiFocusable(dialogRef.current);
		if (elements.length === 0) {
			event.preventDefault();
			return;
		}
		const first = elements[0]!;
		const last = elements.at(-1)!;
		if (event.shiftKey && documentRef?.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && documentRef?.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	};
	if (!open || !documentRef || !host || !mounted) return null;
	/* `data-vui-slot` on both halves, because a consumer has to be able to name
	 * the scrim and the dialog separately — dismissing by clicking away is a test
	 * about the scrim, and focus containment is a test about the dialog — and the
	 * class names they used to be reached by are this library's private styling. */
	return createPortal(
		<div
			className={className ? `vui-overlay ${className}` : "vui-overlay"}
			data-vui-root
			data-vui-overlay
			data-vui-slot="overlay"
			data-vui-overlay-kind={kind}
			data-vui-mode={mode}
			style={style}
			onPointerDown={(event) => {
				if (
					event.target === event.currentTarget &&
					allowsVuiDismiss("scrim", dismissOnEscape, dismissOnScrim)
				) {
					event.preventDefault();
					dismiss("scrim");
				}
			}}
		>
			<div
				ref={dialogRef}
				className="vui-overlay-dialog"
				data-vui-slot="dialog"
				role="dialog"
				aria-modal="true"
				aria-label={label}
				tabIndex={-1}
				onKeyDown={onKeyDown}
			>
				{children}
			</div>
		</div>,
		host,
	);
}
