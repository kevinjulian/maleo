/* Who is on top, who owns focus, and who gets the key.
 *
 * An explicit registry rather than "whichever component's handler runs first".
 * Nested overlays are where the implicit version fails: a sheet inside a dialog
 * both listen for `Escape`, both close, and the person who wanted to dismiss the
 * inner one loses the outer one too — a bug that only appears with two of them
 * open and is therefore never seen in the fixture that has one.
 *
 * Three separable questions, answered separately: which overlay is painted on
 * top, which one owns focus, and which one receives a key. They usually have the
 * same answer, and a non-modal overlay is exactly the case where they do not.
 */

/** A consumer-owned identity for one overlay. */
export type OverlayId = string;

/** What an overlay declares when it registers. */
export interface OverlayRegistration {
	readonly id: OverlayId;
	/** Painting order within the VUI root. Higher is nearer the viewer. */
	readonly zOrder: number;
	/** Element whose paint order this registration owns. */
	readonly element?: HTMLElement;
	/** Direct body child containing a portalled overlay. */
	readonly host?: HTMLElement;
	/** Body children carrying this attribute stay interactive. */
	readonly persistentAttribute?: string;
	/** Whether this overlay takes focus while it is open. */
	readonly modal: boolean;
	/**
	 * Whether keys reach it even when it is not on top.
	 *
	 * False for the ordinary case. A toast that stays keyboard-inert while a
	 * dialog is open is the reason this is a declaration and not an assumption.
	 */
	readonly keyTransparent?: boolean;
	/**
	 * Whether the browser's Back closes it when it owns the key (see
	 * `back-dismissal.ts`). A place the operator went, such as a sheet, opts in;
	 * a confirmation does not, so Back over it closes nothing beneath it.
	 */
	readonly dismissOnBack?: boolean;
	/** Told to close, with the reason. */
	onRequestClose?(reason: OverlayCloseReason): void;
}

/** Why an overlay was asked to close. */
export type OverlayCloseReason = "escape" | "scrim" | "close-button" | "back" | "programmatic";

export interface OverlayStack {
	/** Register an overlay. Returns its release. */
	push(registration: OverlayRegistration): () => void;
	/** The overlay painted on top, if any. */
	top(): OverlayRegistration | undefined;
	/** The overlay that owns focus: the topmost modal one. */
	focusOwner(): OverlayRegistration | undefined;
	/** The overlay a key goes to. */
	keyOwner(): OverlayRegistration | undefined;
	/** Route a key. Returns the overlay that handled it, if any. */
	handleKey(key: string): OverlayRegistration | undefined;
	/** Everything open, bottom to top. */
	entries(): readonly OverlayRegistration[];
	/** Whether this overlay is beneath the focus owner, and so inert. */
	isInert(id: OverlayId): boolean;
}

type InertElement = HTMLElement & { inert?: boolean };
type InertRecord = { inert: boolean; ariaHidden: string | null };

function inertElement(element: HTMLElement): InertElement {
	// SAFETY: HTMLElement.inert is standard DOM, absent only from older TypeScript libs.
	return element as InertElement;
}

function syncDocumentBackground(
	document: Document,
	stack: OverlayStack,
	baseline: Map<HTMLElement, InertRecord>,
): void {
	const owner = stack.focusOwner();
	if (!owner?.host) {
		for (const [element, record] of baseline) {
			if (!element.isConnected) continue;
			inertElement(element).inert = record.inert;
			if (record.ariaHidden == null) element.removeAttribute("aria-hidden");
			else element.setAttribute("aria-hidden", record.ariaHidden);
		}
		baseline.clear();
		return;
	}
	const persistentAttribute = owner.persistentAttribute;
	const apply = (element: HTMLElement): void => {
		if (!baseline.has(element))
			baseline.set(element, {
				inert: Boolean(inertElement(element).inert),
				ariaHidden: element.getAttribute("aria-hidden"),
			});
		const persistent = Boolean(
			persistentAttribute &&
			(element.hasAttribute(persistentAttribute) ||
				element.querySelector(`[${persistentAttribute}]`)),
		);
		const active = element === owner.host || persistent;
		inertElement(element).inert = !active;
		if (active) element.removeAttribute("aria-hidden");
		else element.setAttribute("aria-hidden", "true");
		if (persistent && element !== owner.host && !element.hasAttribute(persistentAttribute!)) {
			for (const child of Array.from(element.children))
				if (child instanceof HTMLElement) apply(child);
		}
	};
	for (const element of Array.from(document.body.children)) {
		if (!(element instanceof HTMLElement)) continue;
		apply(element);
	}
}

export function createOverlayStack(onChange?: (stack: OverlayStack) => void): OverlayStack {
	/* An array rather than a map: order is the whole state, and a map plus a
	 * separate order array is two things that can disagree. */
	let open: OverlayRegistration[] = [];

	function sorted(): OverlayRegistration[] {
		/* Stable by z-order, then by the order they opened, so two overlays at the
		 * same z-order stack the way a person expects rather than the way the sort
		 * happens to land. */
		return [...open].sort((a, b) => a.zOrder - b.zOrder || open.indexOf(a) - open.indexOf(b));
	}

	const stack: OverlayStack = {
		push(registration) {
			open = [...open, registration];
			if (registration.element) registration.element.style.zIndex = String(registration.zOrder);
			onChange?.(stack);
			let released = false;
			return () => {
				if (released) return;
				released = true;
				/* Released by identity, so unwinding out of order — an outer overlay
				 * closing while an inner one is still open — removes the right one
				 * rather than the last one. */
				open = open.filter((entry) => entry !== registration);
				onChange?.(stack);
			};
		},
		entries: () => sorted(),
		top: () => sorted()[sorted().length - 1],
		focusOwner: () => [...sorted()].reverse().find((entry) => entry.modal),
		keyOwner() {
			const ordered = [...sorted()].reverse();
			/* The topmost overlay that is not key-transparent. A transparent one is
			 * skipped rather than swallowing the key it declared no interest in. */
			return ordered.find((entry) => entry.keyTransparent !== true);
		},
		handleKey(key) {
			if (key !== "Escape") return undefined;
			const owner = stack.keyOwner();
			if (!owner) return undefined;
			owner.onRequestClose?.("escape");
			return owner;
		},
		isInert(id) {
			const owner = stack.focusOwner();
			if (!owner) return false;
			if (owner.id === id) return false;
			const entries = sorted();
			const ownerIndex = entries.findIndex((entry) => entry.id === owner.id);
			const index = entries.findIndex((entry) => entry.id === id);
			/* Everything beneath the focus owner is inert, including other
			 * overlays: a dialog over a sheet makes the sheet unreachable, which is
			 * what "modal" means. */
			return index < ownerIndex;
		},
	};
	return stack;
}

/* The registry hangs off `globalThis`, and that is not defensive coding.
 *
 * It was introduced while this file shipped in `@maleo/vui`, whose build
 * emitted each subpath with `splitting: false`, so `dist/dom` and `dist/react`
 * each carried their own inlined copy. The app imported both, and therefore
 * ran two instances of this module. Inside the app's own bundle that cause is
 * gone (migrate-editor-to-shared-rust-core task 3.1). The key stays for the
 * case that remains (task 3.2): a hot reload re-evaluates this module while
 * overlays registered by the old instance are still open, and a module-scope
 * registry would start empty beside them — the same split, in development. Module scope would give each one its own
 * registry, and "one overlay stack per host document" would be false in the one
 * arrangement it has to hold for: an app modal opened over a VUI sheet. The
 * observed failure is not subtle — each stack thinks its own overlay is on top,
 * both claim Escape, and the app's capture-phase listener stops the key before
 * the VUI overlay ever sees it.
 *
 * A single well-known key is what makes the instances agree. */
declare global {
	/* `var` is the only declaration form that adds a property to `globalThis`. */
	var __maleoVuiOverlayStacks: WeakMap<Document, OverlayStack> | undefined;
}

const documentStacks = (globalThis.__maleoVuiOverlayStacks ??= new WeakMap<
	Document,
	OverlayStack
>());

/** One host-neutral overlay registry per document. */
export function overlayStackForDocument(document: Document): OverlayStack {
	const existing = documentStacks.get(document);
	if (existing) return existing;
	const baseline = new Map<HTMLElement, InertRecord>();
	const created = createOverlayStack((stack) => syncDocumentBackground(document, stack, baseline));
	documentStacks.set(document, created);
	return created;
}
