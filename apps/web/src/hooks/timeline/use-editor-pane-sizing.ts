import {
	useEffect,
	useRef,
	useState,
	type CSSProperties,
	type RefObject,
	type PointerEvent as ReactPointerEvent,
	type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { loadEditorPaneShares, saveEditorPaneShares } from "@models/timeline/editor-pane-shares.ts";
import { clampEditorPanes, type EditorPaneSizes } from "@models/timeline/editor-chrome.ts";

export type EditorPane = keyof EditorPaneSizes;

function browserStorage(): Storage | null {
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}

/** Desktop panel shares belong to this browser, independent of project data. */
export function useEditorPaneSizing(
	root: RefObject<HTMLDivElement | null>,
	phone: boolean,
	toolsOpen: boolean,
) {
	const [preferred] = useState(() => loadEditorPaneShares(browserStorage()));
	const preferredRef = useRef(preferred);
	const [sizes, setSizes] = useState<EditorPaneSizes | null>(null);
	const cleanup = useRef<(() => void) | null>(null);
	const measure = () => {
		const node = root.current;
		if (!node || phone) return;
		const main = node.querySelector<HTMLElement>(':scope > [data-vui-slot="main"]');
		if (!main) return;
		const width = main.clientWidth,
			height = main.clientHeight;
		const shares = preferredRef.current;
		const next = clampEditorPanes(width, height, toolsOpen, {
			tools: shares.tools * Math.max(1, width - 32),
			inspector: shares.inspector * Math.max(1, width - 32),
			timeline: shares.timeline * Math.max(1, height - 24),
		});
		setSizes((previous) =>
			previous &&
			next.tools === previous.tools &&
			next.inspector === previous.inspector &&
			next.timeline === previous.timeline
				? previous
				: next,
		);
	};
	useEffect(() => {
		cleanup.current?.();
		if (phone || !root.current) return;
		const observer = new ResizeObserver(measure);
		observer.observe(root.current);
		measure();
		return () => {
			observer.disconnect();
			cleanup.current?.();
		};
	}, [phone, toolsOpen]);

	const resize = (pane: EditorPane, value: number) => {
		const main = root.current?.querySelector<HTMLElement>(':scope > [data-vui-slot="main"]');
		if (!main || !sizes) return;
		const next = clampEditorPanes(main.clientWidth, main.clientHeight, toolsOpen, {
			...sizes,
			[pane]: value,
		});
		preferredRef.current = {
			...preferredRef.current,
			[pane]:
				next[pane] /
				Math.max(1, pane === "timeline" ? main.clientHeight - 24 : main.clientWidth - 32),
		};
		saveEditorPaneShares(preferredRef.current, browserStorage());
		measure();
	};
	const start = (pane: EditorPane, event: ReactPointerEvent<HTMLElement>) => {
		if (phone || event.button !== 0 || !sizes) return;
		event.preventDefault();
		cleanup.current?.();
		const target = event.currentTarget,
			id = event.pointerId;
		const origin = pane === "timeline" ? event.clientY : event.clientX;
		const value = sizes[pane];
		const onMove = (move: PointerEvent) => {
			if (move.pointerId !== id) return;
			const delta = (pane === "timeline" ? move.clientY : move.clientX) - origin;
			resize(pane, value + (pane === "tools" ? delta : -delta));
		};
		const onFinish = () => cleanup.current?.();
		const cursor = document.body.style.cursor,
			selection = document.body.style.userSelect;
		cleanup.current = () => {
			cleanup.current = null;
			target.removeEventListener("pointermove", onMove);
			target.removeEventListener("pointerup", onFinish);
			target.removeEventListener("pointercancel", onFinish);
			target.removeEventListener("lostpointercapture", onFinish);
			window.removeEventListener("blur", onFinish);
			if (target.hasPointerCapture(id)) target.releasePointerCapture(id);
			document.body.style.cursor = cursor;
			document.body.style.userSelect = selection;
		};
		target.setPointerCapture(id);
		document.body.style.cursor = pane === "timeline" ? "row-resize" : "col-resize";
		document.body.style.userSelect = "none";
		target.addEventListener("pointermove", onMove);
		target.addEventListener("pointerup", onFinish);
		target.addEventListener("pointercancel", onFinish);
		target.addEventListener("lostpointercapture", onFinish);
		window.addEventListener("blur", onFinish);
	};
	const keyboard = (pane: EditorPane, event: ReactKeyboardEvent<HTMLElement>) => {
		if (phone || !sizes) return;
		const positive =
			pane === "timeline" ? "ArrowUp" : pane === "tools" ? "ArrowRight" : "ArrowLeft";
		const negative =
			pane === "timeline" ? "ArrowDown" : pane === "tools" ? "ArrowLeft" : "ArrowRight";
		if (event.key !== positive && event.key !== negative) return;
		event.preventDefault();
		event.stopPropagation();
		resize(pane, sizes[pane] + (event.key === positive ? 1 : -1) * (event.shiftKey ? 40 : 10));
	};
	const style: (CSSProperties & Record<`--${string}`, string>) | undefined =
		!phone && sizes
			? {
					"--tl2-tools-w": `${sizes.tools}px`,
					"--tl2-inspector-w": `${sizes.inspector}px`,
					"--tl2-tl-h": `${sizes.timeline}px`,
				}
			: undefined;
	const rect = root.current?.getBoundingClientRect();
	const bounds =
		sizes && rect
			? {
					min: clampEditorPanes(rect.width, rect.height, toolsOpen, {
						tools: 0,
						inspector: 0,
						timeline: 0,
					}),
					max: {
						tools: clampEditorPanes(rect.width, rect.height, toolsOpen, {
							...sizes,
							tools: Number.MAX_SAFE_INTEGER,
						}).tools,
						inspector: clampEditorPanes(rect.width, rect.height, toolsOpen, {
							...sizes,
							inspector: Number.MAX_SAFE_INTEGER,
						}).inspector,
						timeline: clampEditorPanes(rect.width, rect.height, toolsOpen, {
							...sizes,
							timeline: Number.MAX_SAFE_INTEGER,
						}).timeline,
					},
				}
			: null;
	return { sizes, bounds, style, start, keyboard };
}
