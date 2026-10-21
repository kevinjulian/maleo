/* Keeping the chat at the latest content without stealing the reader's place.
 *
 * New events follow the bottom only when the reader is already there. Scrolled
 * up, the position holds and the panel reports unread content instead, with a
 * jump back. */
import { useLayoutEffect, useRef, useState } from "react";
import type { RefObject, UIEvent } from "react";

/** Pixels from the bottom that still count as "at the latest". */
const AT_BOTTOM_SLACK = 24;

export function isNearBottom(
	el: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">,
): boolean {
	return el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_SLACK;
}

export interface ChatScroll {
	onScroll: (event: UIEvent<HTMLElement>) => void;
	unread: boolean;
	jumpToLatest: () => void;
}

export function useChatScroll(ref: RefObject<HTMLElement | null>, contentKey: unknown): ChatScroll {
	const atBottomRef = useRef(true);
	const [unread, setUnread] = useState(false);

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		if (atBottomRef.current) el.scrollTop = el.scrollHeight;
		else setUnread(true);
	}, [ref, contentKey]);

	return {
		onScroll: (event) => {
			const at = isNearBottom(event.currentTarget);
			atBottomRef.current = at;
			if (at) setUnread(false);
		},
		unread,
		jumpToLatest: () => {
			const el = ref.current;
			if (!el) return;
			const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
			el.scrollTo({ top: el.scrollHeight, behavior: reduced ? "auto" : "smooth" });
			atBottomRef.current = true;
			setUnread(false);
		},
	};
}
