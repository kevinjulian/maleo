/* The export flow: menu, render job, in-progress button, info modal.
 *
 * The export button is one control with two jobs, which is why the intent is
 * derived rather than branched at the call site: while a render is in flight it
 * opens the status modal, and otherwise it toggles the export menu.
 *
 * The menu closes on a pointerdown outside it, captured at the document rather
 * than bubbled, so a click on a control elsewhere both closes the menu and
 * reaches that control.
 *
 * Split out of `create-content.tsx`.
 */
import { useEffect, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useRenderPoll } from "./use-render-poll.ts";
import { useActiveWorkspace } from "@hooks/workspace/use-active-workspace.ts";
import type { RenderQueueStatus } from "@models/render/render-queue.ts";
import { useShellChromeField, type ShellChromeStore } from "@stores/shell-chrome-store.ts";

export interface RenderFlowInput {
	/* The five values below used to be this hook's own `useState`s, which meant
	 * the shell had to receive them back out and hand them on to every region
	 * that reads one. They are shell chrome; the store owns them. */
	chrome: ShellChromeStore;
	projectId?: string;
	/** Read at click time, not at render time: the preflight depends on
	 *  `rendering`, which this hook owns, so passing the list eagerly would be a
	 *  cycle. It also means the blockers are the ones that hold when the button
	 *  is actually pressed. */
	getBlockers: () => string[];
	isVideo: () => boolean;
	/** Starts the render. Called only once the preflight is clear. */
	submit: () => void;
	setSaveError: Dispatch<SetStateAction<string | null>>;
}

export interface RenderFlow {
	renderJobId: string | null;
	setRenderJobId: Dispatch<SetStateAction<string | null>>;
	rendering: boolean;
	setRendering: Dispatch<SetStateAction<boolean>>;
	renderStatus: RenderQueueStatus | null;
	setRenderStatus: Dispatch<SetStateAction<RenderQueueStatus | null>>;
	renderInfoOpen: boolean;
	setRenderInfoOpen: Dispatch<SetStateAction<boolean>>;
	exportMenuOpen: boolean;
	setExportMenuOpen: Dispatch<SetStateAction<boolean>>;
	exportMenuRef: MutableRefObject<HTMLDivElement | null>;
	/** Opens the status modal mid-render, else toggles the export menu. */
	onRenderClick: () => void;
	confirmRender: () => void;
}

export function useRenderFlow({
	chrome,
	projectId,
	getBlockers,
	isVideo,
	submit,
	setSaveError,
}: RenderFlowInput): RenderFlow {
	const [exportOrigin] = useShellChromeField(chrome, "exportOrigin");
	const [renderJobId, setRenderJobId] = useShellChromeField(chrome, "renderJobId");
	const [renderInfoOpen, setRenderInfoOpen] = useShellChromeField(chrome, "renderInfoOpen");
	const [rendering, setRendering] = useShellChromeField(chrome, "rendering");
	const [renderStatus, setRenderStatus] = useShellChromeField(chrome, "renderStatus");
	const [exportMenuOpen, setExportMenuOpen] = useShellChromeField(chrome, "exportMenuOpen");
	// Stays a ref: the outside-pointerdown listener needs the live node, and a
	// DOM node is not state anything subscribes to.
	const exportMenuRef = useRef<HTMLDivElement | null>(null);

	// Poll the active render job; stop and flip the button back on a terminal state.
	const workspace = useActiveWorkspace();
	useEffect(() => {
		chrome.set((previous) => ({
			...previous,
			renderJobId: null,
			renderStatus: null,
			rendering: false,
			renderInfoOpen: false,
			exportMenuOpen: false,
			exportOrigin: "server",
			exportError: null,
		}));
	}, [projectId, workspace, chrome]);
	useRenderPoll({
		renderJobId,
		rendering,
		setRenderStatus,
		setRendering,
		projectId: exportOrigin === "browser" ? undefined : projectId,
		workspace,
		chrome,
	});

	useEffect(() => {
		if (!exportMenuOpen) return;
		const close = (e: PointerEvent): void => {
			const root = exportMenuRef.current;
			// A pointerdown whose target is not a Node cannot be inside the menu, so
			// it closes — which is what an outside click does anyway.
			const inside = e.target instanceof Node && root?.contains(e.target);
			if (root && !inside) setExportMenuOpen(false);
		};
		document.addEventListener("pointerdown", close, true);
		return () => document.removeEventListener("pointerdown", close, true);
	}, [exportMenuOpen]);

	const onRenderClick = (): void => {
		if (rendering || ["checking", "disconnected"].includes(chrome.get().exportConnection)) {
			setRenderInfoOpen(true);
			return;
		}
		setExportMenuOpen((v) => !v);
	};
	const confirmRender = (): void => {
		if (
			chrome.get().rendering ||
			["checking", "disconnected"].includes(chrome.get().exportConnection)
		)
			return;
		const blockers = getBlockers();
		if (isVideo() && blockers.length > 0) {
			setExportMenuOpen(false);
			setSaveError(blockers[0] ?? "Resolve export blockers before rendering.");
			return;
		}
		setExportMenuOpen(false);
		setRenderStatus(null);
		setRenderJobId(null);
		chrome.patch("exportOrigin", "server");
		setRendering(true);
		submit();
	};

	return {
		renderJobId,
		setRenderJobId,
		rendering,
		setRendering,
		renderStatus,
		setRenderStatus,
		renderInfoOpen,
		setRenderInfoOpen,
		exportMenuOpen,
		setExportMenuOpen,
		exportMenuRef,
		onRenderClick,
		confirmRender,
	};
}
