/* Focus containment, opener restoration, and the body scroll lock.
 *
 * Three mechanics that look small and are where dialogs actually break:
 *
 *   - **Containment** is arithmetic over the focusable elements, so it is tested
 *     as arithmetic rather than by driving a browser and hoping.
 *   - **Restoration** has to happen for EVERY close path, not just the button.
 *     Escape, the scrim, a programmatic close and an unmount all end with focus
 *     back where it came from, or a person tabbing after closing a dialog starts
 *     from the top of the document.
 *   - **The scroll lock is reference-counted.** Two overlays that each set and
 *     clear `overflow: hidden` leave the page unscrollable when the first one
 *     closes and the second is still open — or scrollable while the second still
 *     needs it, depending on the order. Counting is the only version that
 *     survives nesting.
 */

/** Anything focus can be moved to. Structural, so this is testable without a DOM. */
export interface FocusableLike {
	focus(): void;
	/** Whether it can currently take focus. */
	readonly disabled?: boolean;
	readonly tabIndex?: number;
}

/** Where the next Tab goes within a contained region. */
export function nextFocusIndex(count: number, current: number, backwards: boolean): number {
	if (count <= 0) return -1;
	/* Wraps in both directions, which is the containment: Tab from the last
	 * element goes to the first rather than out of the dialog and into the page
	 * behind it. */
	const next = backwards ? current - 1 : current + 1;
	return ((next % count) + count) % count;
}

/** The focusable members of a region, in tab order. */
export function focusableMembers<E extends FocusableLike>(candidates: readonly E[]): E[] {
	return candidates.filter(
		(candidate) => candidate.disabled !== true && (candidate.tabIndex ?? 0) >= 0,
	);
}

/** What a trap needs to know, without knowing what an element is. */
export interface FocusTrapOptions<E extends FocusableLike> {
	/** The focusables inside the region, read fresh on every move. */
	members(): readonly E[];
	/** Where focus was before the region opened. */
	readonly opener?: FocusableLike;
	/** Which member takes focus when the region opens. The first by default. */
	readonly initialIndex?: number;
}

export interface FocusTrap<E extends FocusableLike> {
	/** Move focus into the region. */
	activate(): E | undefined;
	/** Handle a Tab. Returns the member focused, or none when there are none. */
	moveFocus(currentIndex: number, backwards: boolean): E | undefined;
	/** Return focus to the opener. Safe to call more than once. */
	release(): void;
	/** Whether the opener has already been restored. */
	released(): boolean;
}

export function createFocusTrap<E extends FocusableLike>(
	options: FocusTrapOptions<E>,
): FocusTrap<E> {
	let released = false;
	return {
		activate() {
			const members = focusableMembers(options.members());
			const target = members[options.initialIndex ?? 0];
			target?.focus();
			return target;
		},
		moveFocus(currentIndex, backwards) {
			/* Read fresh: a dialog whose content changed while it was open has
			 * different focusables, and a cached list sends Tab to an element that
			 * is no longer there. */
			const members = focusableMembers(options.members());
			const index = nextFocusIndex(members.length, currentIndex, backwards);
			const target = members[index];
			target?.focus();
			return target;
		},
		release() {
			/* Idempotent, because several close paths can run for one close — the
			 * scrim press that also blurs, the Escape that also unmounts — and
			 * restoring twice would move focus after the person had moved it. */
			if (released) return;
			released = true;
			options.opener?.focus();
		},
		released: () => released,
	};
}

/* ---- The scroll lock ------------------------------------------------------- */

/** Whatever the lock is applied to. `document.body` in a browser. */
export interface ScrollLockTarget {
	style: { overflow: string };
}

/** A lock that survives nesting because it counts. */
export interface ScrollLock {
	acquire(): () => void;
	/** How many holders there are. Zero means the page scrolls. */
	count(): number;
	readonly locked: boolean;
}

export function createScrollLock(target: ScrollLockTarget): ScrollLock {
	let holders = 0;
	let previous = "";
	const lock: ScrollLock = {
		acquire() {
			if (holders === 0) {
				/* The previous value, restored on the last release. Setting it back to
				 * an empty string would discard a consumer's own `overflow` on the
				 * body, which is theirs and not ours. */
				previous = target.style.overflow;
				target.style.overflow = "hidden";
			}
			holders += 1;
			let released = false;
			return () => {
				if (released) return;
				released = true;
				holders -= 1;
				if (holders === 0) target.style.overflow = previous;
			};
		},
		count: () => holders,
		get locked() {
			return holders > 0;
		},
	};
	return lock;
}

/* On `globalThis` for the reason `overlay-stack.ts` explains at length: this
 * file is inlined into more than one built subpath, so module scope would give
 * each copy its own lock and the nesting count would be split between them —
 * the first overlay to close would restore `overflow` while another was still
 * open. */
declare global {
	/* `var` is the only declaration form that adds a property to `globalThis`. */
	var __maleoVuiScrollLocks: WeakMap<Document, ScrollLock> | undefined;
}

const documentLocks = (globalThis.__maleoVuiScrollLocks ??= new WeakMap<Document, ScrollLock>());

/** One nesting-safe body lock per document. */
export function scrollLockForDocument(document: Document): ScrollLock {
	const existing = documentLocks.get(document);
	if (existing) return existing;
	const created = createScrollLock(document.body);
	documentLocks.set(document, created);
	return created;
}
