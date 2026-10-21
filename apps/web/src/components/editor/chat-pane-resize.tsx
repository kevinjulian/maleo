/* The chat pane's resize boundary: a vertical separator on the pane's trailing
 * edge. Dragged with a pointer or moved with the arrow keys (Home/End jump to
 * the bounds); either way the width stays within 380–520px and is remembered. */
import type { JSX, KeyboardEvent, PointerEvent } from "react";
import { CHAT_PANE_MAX, CHAT_PANE_MIN, CHAT_PANE_STEP } from "@models/chat/chat-pane-width.ts";
import { setChatPaneWidth, useChatPaneWidth } from "@hooks/editor/use-chat-pane-width.ts";

export function ChatPaneResizeHandle(): JSX.Element {
	const width = useChatPaneWidth();

	const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
		if (event.button !== 0) return;
		event.preventDefault();
		const startX = event.clientX;
		const startWidth = width;
		const handle = event.currentTarget;
		handle.setPointerCapture?.(event.pointerId);
		document.body.classList.add("fc-pane-resizing");
		const move = (e: globalThis.PointerEvent): void =>
			setChatPaneWidth(startWidth + e.clientX - startX);
		const end = (): void => {
			document.body.classList.remove("fc-pane-resizing");
			handle.removeEventListener("pointermove", move);
			handle.removeEventListener("pointerup", end);
			handle.removeEventListener("pointercancel", end);
		};
		handle.addEventListener("pointermove", move);
		handle.addEventListener("pointerup", end);
		handle.addEventListener("pointercancel", end);
	};

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
		const next =
			event.key === "ArrowLeft"
				? width - CHAT_PANE_STEP
				: event.key === "ArrowRight"
					? width + CHAT_PANE_STEP
					: event.key === "Home"
						? CHAT_PANE_MIN
						: event.key === "End"
							? CHAT_PANE_MAX
							: null;
		if (next === null) return;
		event.preventDefault();
		setChatPaneWidth(next);
	};

	return (
		<div
			className="fc-pane-resize"
			role="separator"
			tabIndex={0}
			aria-orientation="vertical"
			aria-label="Resize chat"
			aria-valuemin={CHAT_PANE_MIN}
			aria-valuemax={CHAT_PANE_MAX}
			aria-valuenow={width}
			onPointerDown={onPointerDown}
			onKeyDown={onKeyDown}
		/>
	);
}
