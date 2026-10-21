import {
	createContext,
	useContext,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
	type RefObject,
} from "react";
import { createFocusTrap, scrollLockForDocument } from "@controllers/overlay/focus-trap.ts";
import { backDismissalForWindow } from "@controllers/overlay/back-dismissal.ts";
import { overlayStackForDocument } from "@controllers/overlay/overlay-stack.ts";

const FOCUSABLE =
	'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/* Where a floating popup (popover, menu, tooltip) opened from inside an overlay
 * must render: the overlay's own host.
 *
 * While a modal overlay is open the stack marks every other child of <body>
 * inert. A popup portalled to <body> — the default — is one of those children,
 * so it only ever worked when it happened to mount after the last sync, and its
 * Tab and Escape were taken by the overlay's handler below. Inside the host it
 * is part of the live subtree, and the handler stands aside for it. Null outside
 * any overlay, where <body> is right. */
export const OverlayHostContext = createContext<HTMLElement | null>(null);

/** The element a floating popup should portal into, or undefined for <body>. */
export function useFloatingContainer(): HTMLElement | undefined {
	return useContext(OverlayHostContext) ?? undefined;
}

/** Marks an interactive floating popup's positioner, so an overlay knows one is
 *  open inside it. Tooltips do not carry it: they hold no focus and must not
 *  absorb the Escape that closes the dialog under them. */
export const FLOATING_ATTR = "data-floating";

export interface UseOverlayOptions {
	open: boolean;
	onClose: () => void;
	zOrder: number;
	aboveCurrent?: boolean;
	persistentAttribute?: string;
	/** Back closes this overlay when it owns the key (`controllers/overlay/back-dismissal.ts`). */
	dismissOnBack?: boolean;
	/** Resolve current routed opener after reload or catalog refresh. */
	returnFocus?: () => HTMLElement | null | undefined;
}

/** What a portalled overlay needs: where to render, whether that host is in the
 *  document yet, and the panel the focus trap and stack registration act on. */
export interface UseOverlayResult<T extends HTMLElement> {
	host: HTMLElement | null;
	mounted: boolean;
	panelRef: RefObject<T | null>;
}

export function useOverlay<T extends HTMLElement>({
	open,
	onClose,
	zOrder,
	aboveCurrent = false,
	persistentAttribute,
	dismissOnBack = false,
	returnFocus,
}: UseOverlayOptions): UseOverlayResult<T> {
	const id = useId();
	const closeRef = useRef(onClose);
	closeRef.current = onClose;
	const returnFocusRef = useRef(returnFocus);
	returnFocusRef.current = returnFocus;
	const panelRef = useRef<T>(null);
	const [host] = useState(() => {
		if (typeof document === "undefined") return null;
		const element = document.createElement("div");
		element.style.position = "fixed";
		element.style.width = "0";
		element.style.height = "0";
		return element;
	});
	const [mounted, setMounted] = useState(false);

	useLayoutEffect(() => {
		if (!host) return;
		document.body.append(host);
		setMounted(true);
		return () => {
			setMounted(false);
			host.remove();
		};
	}, [host]);

	useEffect(() => {
		const panel = panelRef.current;
		if (!open || !host || !panel) return;
		const opener =
			document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
		const stack = overlayStackForDocument(document);
		const declaredOrder = aboveCurrent
			? Math.max(zOrder, (stack.top()?.zOrder ?? zOrder - 20) + 20)
			: zOrder;
		const release = stack.push({
			id,
			zOrder: declaredOrder,
			modal: true,
			element: host,
			host,
			persistentAttribute,
			dismissOnBack,
			onRequestClose: () => closeRef.current(),
		});
		const giveBackEntry = dismissOnBack ? backDismissalForWindow(window).hold(id) : undefined;
		const unlock = scrollLockForDocument(document).acquire();
		const trap = createFocusTrap<HTMLElement>({
			members: () => [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)],
			opener: { focus: () => (returnFocusRef.current?.() ?? opener)?.focus() },
		});
		(panel.querySelector<HTMLElement>("[autofocus]") ?? trap.activate() ?? panel).focus();
		const onKeyDown = (event: KeyboardEvent): void => {
			/* A popup open inside this overlay owns the key: Escape closes the popup,
			 * not the dialog, and Tab moves inside it. */
			const floating =
				host.querySelector(`[${FLOATING_ATTR}]`) ??
				[...host.querySelectorAll<HTMLElement>('[role="menu"]')].find(
					(menu) =>
						menu.getClientRects().length > 0 && !menu.closest('[inert], [aria-hidden="true"]'),
				);
			// Native fullscreen and embedded ARIA menus own Escape before the dialog.
			if (event.key === "Escape" && document.fullscreenElement) return;
			if (floating && (event.key === "Escape" || floating.contains(document.activeElement))) return;
			if (event.key === "Escape" && stack.keyOwner()?.id === id) {
				event.preventDefault();
				event.stopImmediatePropagation();
				stack.handleKey("Escape");
				return;
			}
			if (event.key !== "Tab" || stack.focusOwner()?.id !== id) return;
			const members = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
			if (members.length === 0) {
				event.preventDefault();
				return;
			}
			event.preventDefault();
			/* Identity search rather than `indexOf` on a narrowed `activeElement`:
			 * focus may sit outside the panel, and -1 is the answer the trap wants
			 * for that — it means "start from the edge". */
			const active = document.activeElement;
			trap.moveFocus(
				members.findIndex((member) => member === active),
				event.shiftKey,
			);
		};
		document.addEventListener("keydown", onKeyDown, true);
		return () => {
			document.removeEventListener("keydown", onKeyDown, true);
			giveBackEntry?.();
			release();
			unlock();
			trap.release();
		};
	}, [aboveCurrent, dismissOnBack, host, id, mounted, open, persistentAttribute, zOrder]);

	return { host, mounted, panelRef };
}
