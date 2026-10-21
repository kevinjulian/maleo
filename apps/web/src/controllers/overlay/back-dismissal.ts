/* Back closes the overlay that owns the key, when that overlay opted in.
 *
 * On a phone Back is the gesture reached for first, and a sheet is a place the
 * operator went, so Back should be the way out of it rather than out of the
 * editor. This used to live in the app's Sheet primitive with its own list of
 * open sheets, which was a second overlay stack: with a modal open above a
 * sheet, Back closed the hidden sheet and left the modal. Asking the one stack
 * for its key owner is what makes "topmost" mean the same thing for Back as it
 * does for Escape.
 *
 * One history entry stands for every open Back-dismissable overlay, and it is
 * refcounted. A per-overlay entry broke the moment one sheet replaced another:
 * React runs the closing sheet's cleanup and the opening sheet's effect in the
 * same commit, so the cleanup's `history.back()` was still queued when the
 * replacement pushed, and the resulting popstate closed the new sheet the
 * instant it opened. So the release of an entry, and its decrement, are both
 * deferred to a microtask: by then the count reflects the end of the commit,
 * and a replacement keeps the entry. */
import type { OverlayId, OverlayStack } from "./overlay-stack.ts";
import { overlayStackForDocument } from "./overlay-stack.ts";

/** The slice of `window` this needs, so a test can drive it. */
export interface BackEnvironment {
	readonly history: { pushState(data: unknown, unused: string): void; back(): void };
	readonly location: { readonly pathname: string; readonly search: string };
	addEventListener(type: "popstate", listener: () => void): void;
}

export interface BackDismissal {
	/** Hold the shared entry for overlay `id` (already on the stack, with
	 *  `dismissOnBack`). Returns its release, which is safe to call twice. */
	hold(id: OverlayId): () => void;
}

const ENTRY = { uiOverlay: true };

export function backDismissal(env: BackEnvironment, stack: OverlayStack): BackDismissal {
	let depth = 0;
	const held = new Set<OverlayId>();
	const consumedByBack = new Set<OverlayId>();
	const route = (): string => `${env.location.pathname}${env.location.search}`;

	env.addEventListener("popstate", () => {
		if (depth === 0) return;
		const owner = stack.keyOwner();
		if (owner?.dismissOnBack && held.has(owner.id)) {
			consumedByBack.add(owner.id);
			/* The browser took the shared entry; others still open need it back. */
			if (held.size > 1) env.history.pushState(ENTRY, "");
			owner.onRequestClose?.("back");
			return;
		}
		/* The key owner did not opt in (a confirmation above a sheet): nothing
		 * closes, and the entry the open overlays stand on is restored. */
		env.history.pushState(ENTRY, "");
	});

	return {
		hold(id) {
			const routeAtOpen = route();
			if (depth === 0) env.history.pushState(ENTRY, "");
			depth += 1;
			held.add(id);
			let released = false;
			return () => {
				if (released) return;
				released = true;
				held.delete(id);
				/* Back already consumed the entry; popping again would take a real
				 * one and walk the operator out of the page they meant to stay on. */
				if (consumedByBack.delete(id)) {
					depth = Math.max(0, depth - 1);
					return;
				}
				queueMicrotask(() => {
					depth = Math.max(0, depth - 1);
					if (depth > 0 || route() !== routeAtOpen) return;
					env.history.back();
				});
			};
		},
	};
}

declare global {
	/* `var` is the only declaration form that adds a property to `globalThis`. */
	var __maleoBackDismissal: WeakMap<Window, BackDismissal> | undefined;
}

/* One per window, on `globalThis` for the same reason as the overlay stack: a
 * module re-evaluated by hot reload must find the listener already installed,
 * not install a second one that restores entries twice. */
const perWindow = (globalThis.__maleoBackDismissal ??= new WeakMap<Window, BackDismissal>());

export function backDismissalForWindow(win: Window): BackDismissal {
	const existing = perWindow.get(win);
	if (existing) return existing;
	const created = backDismissal(win, overlayStackForDocument(win.document));
	perWindow.set(win, created);
	return created;
}
