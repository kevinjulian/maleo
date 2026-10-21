import "./editor-workspace.css";
import "@design-system/components/modal.css";
import { IconButton } from "@design-system/components/icon-button.tsx";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import {
	useCallback,
	useLayoutEffect,
	useRef,
	useState,
	type CSSProperties,
	type JSX,
	type ReactNode,
	type Ref,
} from "react";
import { createPortal } from "react-dom";
import { VuiOverlay, type VuiDismissReason } from "./overlay.tsx";
import { VUI_PERSISTENT_ATTRIBUTE } from "@controllers/overlay/persistent.ts";
import { VuiSheet, type VuiSheetPlacement } from "./sheet.tsx";

export type VuiWorkspaceMode = "embedded" | "modal" | "fullscreen";
/** A style object that also carries custom properties.
 *
 * `CSSProperties` has no index signature for `--*`, so setting one otherwise
 * needs an assertion at every call site. React passes them through at runtime;
 * this states that in the type instead of asserting past it. */
type VuiStyleWithCustomProperties = CSSProperties & Record<`--${string}`, string>;
export interface VuiMobilePanelState {
	open: boolean;
	title: string;
	content?: ReactNode;
	onRequestClose: (reason: VuiDismissReason) => void;
	placement?: VuiSheetPlacement;
}
/**
 * The workspace contract's version, declared by the consumer.
 *
 * Here rather than in a shared contract module: this is the SHELL's contract —
 * which regions exist and what they are named — and it versions on its own
 * schedule, separately from the renderer and document contracts a host adapter
 * declares.
 */
export type VuiWorkspaceContractVersion = 1;
const WORKSPACE_CONTRACT_VERSION: VuiWorkspaceContractVersion = 1;

/** Refuse a version this build does not speak, by name rather than by symptom. */
export function assertVuiWorkspaceContractVersion(
	version: number,
): asserts version is VuiWorkspaceContractVersion {
	if (version !== WORKSPACE_CONTRACT_VERSION)
		throw new Error(
			`@maleo/vui: this workspace declares contract version ${version}, expected ${WORKSPACE_CONTRACT_VERSION}.`,
		);
}

export interface VuiEditorWorkspaceProps {
	contractVersion: VuiWorkspaceContractVersion;
	mode: VuiWorkspaceMode;
	label: string;
	open?: boolean;
	onRequestClose?: (reason: VuiDismissReason) => void;
	header?: ReactNode;
	preview: ReactNode;
	transport?: ReactNode;
	timelineToolbar?: ReactNode;
	timeline: ReactNode;
	inspector?: ReactNode;
	tools?: ReactNode;
	status?: ReactNode;
	footer?: ReactNode;
	mobilePanel?: VuiMobilePanelState;
	/**
	 * The workspace's own element.
	 *
	 * A consumer that sizes a region against the workspace needs to measure the
	 * workspace, and without this the only way to reach it is
	 * `document.querySelector`. The content editor's splitter is the case that
	 * asked for it: it resolves a timeline height from the workspace's bottom
	 * edge, and when the workspace became a package component the ref it used to
	 * hold went nowhere, so the drag ran and computed nothing.
	 *
	 * A ref to the root only. Descendants stay private; `data-vui-slot` is how a
	 * consumer addresses a region.
	 */
	rootRef?: Ref<HTMLDivElement>;
	/**
	 * The header carries its own dismissal, so the workspace should not add one.
	 *
	 * `onRequestClose` still governs Escape and the scrim; this is only about the
	 * button. A consumer whose compact header is a back control and a title ends
	 * up with two controls that both close the same surface and announce the same
	 * name, which is worse than either alone.
	 */
	headerProvidesClose?: boolean;
	/**
	 * A persistent action surface at the bottom safe-area edge, on a compact
	 * viewport.
	 *
	 * It exists because a consumer in `modal` or `fullscreen` mode has nothing
	 * outside the workspace to attach a bar to — the surface is inside an
	 * overlay — and because `mobilePanel` is a sheet: dismissable, and covering
	 * the timeline, which is the opposite of what a resident bar has to be.
	 *
	 * Neutral: it takes nodes and names no consumer concept. Which controls
	 * belong on it, and what they mean, is the adapter's.
	 */
	mobileActions?: ReactNode;
	ownerDocument?: Document;
	className?: string;
	style?: CSSProperties;
}

function useCompactWorkspace(
	rootRef: { current: HTMLDivElement | null },
	ownerDocument?: Document,
): boolean {
	const [compact, setCompact] = useState(false);
	useLayoutEffect(() => {
		const root = rootRef.current;
		const documentRef = ownerDocument ?? root?.ownerDocument;
		const windowRef = documentRef?.defaultView;
		if (!root || !windowRef) return;
		const media = windowRef.matchMedia(
			"(max-width: 700px), (max-height: 500px) and (pointer: coarse)",
		);
		const update = (): void => {
			setCompact(root.getBoundingClientRect().width <= 700 || media.matches);
		};
		update();
		const observer =
			typeof windowRef.ResizeObserver === "function" ? new windowRef.ResizeObserver(update) : null;
		observer?.observe(root);
		windowRef.addEventListener("resize", update);
		return () => {
			observer?.disconnect();
			windowRef.removeEventListener("resize", update);
		};
	}, [ownerDocument, rootRef]);
	return compact;
}

/**
 * The action region's height, published so the package's own sheets can clear
 * it.
 *
 * Measured rather than declared: the region holds consumer content, so its
 * height is whatever that content is, and a constant here would be wrong for
 * every consumer but the one it was measured from. The sheet is portalled out
 * of the workspace, so the value reaches it as an inline custom property rather
 * than by inheritance.
 */
function useActionsHeight(ref: { current: HTMLDivElement | null }, enabled: boolean): number {
	const [height, setHeight] = useState(0);
	useLayoutEffect(() => {
		const node = ref.current;
		if (!enabled || !node) {
			setHeight(0);
			return;
		}
		const windowRef = node.ownerDocument.defaultView;
		const update = (): void => {
			setHeight(node.getBoundingClientRect().height);
		};
		update();
		const observer =
			typeof windowRef?.ResizeObserver === "function" ? new windowRef.ResizeObserver(update) : null;
		observer?.observe(node);
		return () => observer?.disconnect();
	}, [enabled, ref]);
	return height;
}

/**
 * A body-level host for the action region, marked so no overlay inerts it.
 *
 * The region cannot live inside the workspace. An overlay makes every body child
 * but its own host `inert`, the workspace is one of those children, and `inert`
 * has no opt-out for descendants — so a region rendered in the surface sat clear
 * of the scrim with the right label and did nothing. A sibling of the sheet can
 * be exempted; a descendant of the workspace cannot.
 */
function usePersistentHost(enabled: boolean, ownerDocument?: Document): HTMLDivElement | null {
	const documentRef = ownerDocument ?? (typeof document === "undefined" ? null : document);
	const [host] = useState(() => documentRef?.createElement("div") ?? null);
	const [mounted, setMounted] = useState(false);
	useLayoutEffect(() => {
		if (!enabled || !documentRef || !host) {
			setMounted(false);
			return;
		}
		host.setAttribute(VUI_PERSISTENT_ATTRIBUTE, "");
		/* A root in its own right. The region's rules and every token they read are
		   scoped beneath `[data-vui-root]`, and once the region is portalled out of
		   the workspace it has no such ancestor — so the host becomes one, and a
		   consumer's token overrides reach it the same way they reach the surface. */
		host.setAttribute("data-vui-root", "");
		host.setAttribute("data-vui-slot", "actions-host");
		host.className = "vui-workspace-actions-host";
		documentRef.body.appendChild(host);
		setMounted(true);
		return () => {
			setMounted(false);
			if (host.parentNode) host.parentNode.removeChild(host);
		};
	}, [documentRef, enabled, host]);
	return mounted ? host : null;
}

function WorkspaceSurface({ props }: { props: VuiEditorWorkspaceProps }): JSX.Element {
	const {
		mode,
		label,
		header,
		preview,
		transport,
		timelineToolbar,
		timeline,
		inspector,
		tools,
		status,
		footer,
		mobileActions,
		mobilePanel,
		onRequestClose,
		headerProvidesClose,
		className,
		style,
	} = props;
	const rootRef = useRef<HTMLDivElement>(null);
	const compact = useCompactWorkspace(rootRef, props.ownerDocument);
	/* Both refs from one callback. The internal one is what the compact
	 * observer measures, so handing the element only to the consumer would
	 * break composition to hand out a node. */
	const consumerRef = props.rootRef;
	const attachRoot = useCallback(
		(node: HTMLDivElement | null) => {
			rootRef.current = node;
			if (typeof consumerRef === "function") consumerRef(node);
			else if (consumerRef) consumerRef.current = node;
		},
		[consumerRef],
	);
	const actionsRef = useRef<HTMLDivElement>(null);
	const actionsHost = usePersistentHost(Boolean(mobileActions), props.ownerDocument);
	/* Gated on the HOST, not just on the content. The region is portalled, so on
	 * the first render there is nowhere for it to go and the ref is still empty —
	 * measuring then yields zero, and with nothing in the dependencies changing
	 * afterwards the effect never ran again. The sheet then cleared a bar of zero
	 * height and painted straight over it. */
	const actionsHeight = useActionsHeight(
		actionsRef,
		Boolean(mobileActions) && Boolean(actionsHost),
	);
	/* Republished onto the sheet, which is portalled out of the workspace and so
	 * cannot inherit it. */
	const sheetStyle: VuiStyleWithCustomProperties = {
		"--vui-mobile-actions-height": `${actionsHeight}px`,
	};
	return (
		<div
			ref={attachRoot}
			className={className ? `vui-workspace ${className}` : "vui-workspace"}
			data-vui-root
			data-vui-mode={mode}
			data-vui-compact={compact ? "true" : "false"}
			data-vui-slot="workspace"
			aria-label={label}
			style={mobileActions ? { ...style, paddingBottom: `${actionsHeight}px` } : style}
		>
			{(header || (mode !== "embedded" && onRequestClose && !headerProvidesClose)) && (
				<header className="vui-workspace-header" data-vui-slot="header">
					{header}
					{mode !== "embedded" && onRequestClose && !headerProvidesClose && (
						<IconButton
							type="button"
							data-vui-slot="close"
							onClick={() => onRequestClose("close-button")}
							title="Close"
							aria-label={`Close ${label}`}
						>
							{Ic.x(ICON.md)}
						</IconButton>
					)}
				</header>
			)}
			<main className="vui-workspace-main" data-vui-slot="main">
				<section className="vui-workspace-preview" data-vui-slot="preview">
					{preview}
					{transport && (
						<div className="vui-workspace-transport" data-vui-slot="transport">
							{transport}
						</div>
					)}
				</section>
				{inspector && !compact && (
					<aside className="vui-workspace-inspector" data-vui-slot="inspector">
						{inspector}
					</aside>
				)}
				{tools && !compact && (
					<aside className="vui-workspace-tools" data-vui-slot="tools">
						{tools}
					</aside>
				)}
				<section className="vui-workspace-timeline" data-vui-slot="timeline">
					{timelineToolbar && (
						<div className="vui-workspace-timeline-toolbar" data-vui-slot="timeline-toolbar">
							{timelineToolbar}
						</div>
					)}
					{timeline}
				</section>
			</main>
			{(status || footer) && (
				<footer className="vui-workspace-footer" data-vui-slot="footer">
					{status}
					<div className="vui-workspace-actions" data-vui-slot="actions">
						{footer}
					</div>
				</footer>
			)}
			{/* Portalled to a marked host rather than rendered here — see
		    `usePersistentHost`. The slot name and the height token are unchanged,
		    which is what a consumer addresses; what moved is which subtree it sits
		    in, and that is the difference between a bar that works under a sheet
		    and one that only looks like it does. */}
			{mobileActions &&
				actionsHost &&
				createPortal(
					<div
						ref={actionsRef}
						className="vui-workspace-mobile-actions"
						data-vui-slot="mobile-actions"
					>
						{mobileActions}
					</div>,
					actionsHost,
				)}
			{mobilePanel && (
				<VuiSheet
					open={mobilePanel.open}
					title={mobilePanel.title}
					placement={mobilePanel.placement}
					onRequestClose={mobilePanel.onRequestClose}
					ownerDocument={props.ownerDocument}
					style={sheetStyle}
				>
					{mobilePanel.content ?? (compact ? inspector : null)}
				</VuiSheet>
			)}
		</div>
	);
}
export function VuiEditorWorkspace(props: VuiEditorWorkspaceProps): JSX.Element | null {
	assertVuiWorkspaceContractVersion(props.contractVersion);
	if (props.open === false) return null;
	if (props.mode === "embedded") return <WorkspaceSurface props={props} />;
	return (
		<VuiOverlay
			open
			kind="workspace"
			mode={props.mode}
			label={props.label}
			onRequestClose={props.onRequestClose}
			ownerDocument={props.ownerDocument}
			className={`vui-workspace-${props.mode}`}
		>
			<WorkspaceSurface props={props} />
		</VuiOverlay>
	);
}
