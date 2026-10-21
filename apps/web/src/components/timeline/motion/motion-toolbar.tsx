/* Motion Studio's strip between the preview and the timeline.
 *
 * The same frame the main editor and Template Studio draw, so the transport
 * lands in the same place on all three — centred by grid track rather than by a
 * flexible spacer, which is what used to make this studio's timecode sit further
 * right than Template Studio's purely because three buttons preceded it.
 *
 * Its own file because the studio was over the line ceiling with it inline, and
 * because adding a layer is a different concern from editing one.
 */
import { useState, type JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { Button } from "@design-system/components/button.tsx";
import { VuiSheet } from "@components/editor-workspace/sheet.tsx";
import { TimelineToolbarFrame } from "../timeline-toolbar-frame.tsx";
import { JumpIcon } from "../timeline-editor-icons.tsx";
import { TransportControls } from "@design-system/patterns/transport.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";

/** The layer kinds this bar can add. The studio owns what they mean. */
export type MotionLayerKind = "title" | "shape-rect" | "shape-circle";

/* One list, read by the phone's sheet and the desktop's button row, so a fourth
 * kind is one entry rather than two places to remember. */
const LAYER_KINDS: readonly {
	kind: MotionLayerKind;
	label: string;
	icon: (s?: number) => JSX.Element;
}[] = [
	{ kind: "title", label: "Text", icon: Ic.type },
	{ kind: "shape-rect", label: "Rectangle", icon: Ic.box },
	{ kind: "shape-circle", label: "Circle", icon: Ic.spark },
];

export interface MotionToolbarProps {
	compact: boolean;
	addLayer: (kind: MotionLayerKind) => void;
	playing: boolean;
	currentSec: number;
	durationSec: number;
	onTogglePlay: () => void;
	/** Return the playhead to the start. Behind the disclosure — see below. */
	onStop: () => void;
	/** Close the inspector sheet. Called before either of this toolbar's sheets
	 *  opens, because the surface allows exactly one bottom sheet at a time and
	 *  these two are reached from different chrome. */
	onCloseInspector: () => void;
	/** True while the inspector sheet is up, so this toolbar can stand its own
	 *  sheets down rather than stacking on it. */
	inspectorOpen: boolean;
}

export function MotionToolbar({
	compact,
	addLayer,
	playing,
	currentSec,
	durationSec,
	onTogglePlay,
	onStop,
	onCloseInspector,
	inspectorOpen,
}: MotionToolbarProps): JSX.Element {
	/* Local, unlike the content editor's, which routes through the chrome store
	 * because three sheets share that surface's bottom edge and must not stack.
	 * The studio has one sheet on this edge and its inspector sheet is a
	 * different layer entirely, so a store entry would be ceremony. */
	const [sheet, setSheet] = useState<"none" | "add" | "more">("none");
	const close = (): void => setSheet("none");
	/* One sheet on this edge at a time. The inspector's is opened from the bottom
	 * bar and these two from the toolbar, so neither knows about the other unless
	 * told — and two stacked sheets both claiming the same scrim is what the
	 * content editor's single `bottomSheet` field exists to prevent. */
	const open = (which: "add" | "more"): void => {
		onCloseInspector();
		setSheet(which);
	};
	const showing = inspectorOpen ? "none" : sheet;

	/* Jump to start sits beside play at desktop width, as it does on the content
	 * editor. It is the same command the phone keeps behind More; removing it
	 * from the studios entirely — which the first cut of this did — took away a
	 * control the desktop had, in a change meant to add one. */
	const jumpStart = (
		<IconButton size="xs" type="button" title="Jump to start" onClick={onStop}>
			{JumpIcon(15, false)}
		</IconButton>
	);
	const transport = (before?: JSX.Element): JSX.Element => (
		<TransportControls
			playing={playing}
			onTogglePlay={onTogglePlay}
			currentSec={currentSec}
			durationSec={durationSec}
			before={before}
		/>
	);

	if (!compact) {
		return (
			<TimelineToolbarFrame
				leading={LAYER_KINDS.map(({ kind, label }) => (
					<Button key={kind} size="sm" variant="ghost" onClick={() => addLayer(kind)}>
						{Ic.plus(ICON.xs)} {label}
					</Button>
				))}
				centre={transport(jumpStart)}
			/>
		);
	}

	return (
		<>
			<TimelineToolbarFrame
				/* One control, not three. Three add-layer buttons crowded a 393px strip
				   against the transport, and a control per kind does not survive a
				   fourth kind — the content editor answered the same problem the same
				   way when nineteen controls would not fit. */
				leading={
					<IconButton
						type="button"
						size="xs"
						on={showing === "add"}
						onClick={() => open("add")}
						title="Add layer"
						aria-label="Add layer"
					>
						{Ic.plus(ICON.md)}
					</IconButton>
				}
				/* The editor's own play button and timecode, not the package's headless
				   default. `VuiTransport` renders the literal strings "▶" and "||" and a
				   text Stop button — fine as a library default, wrong beside the
				   editor's control in the same row of the same workspace. */
				centre={transport()}
				/* The disclosure holds one control today, and that is worth stating so
				   the next reader does not take it for an oversight. Stop is all this
				   surface has to displace: the studios have no zoom, no aspect, no
				   density toggle. It earns its place by being the shape the content
				   editor already has — where the same command is called "Jump to
				   start" and lives behind the same disclosure — rather than by what it
				   currently holds. If a second control never arrives, the honest change
				   is to remove the disclosure, not to invent contents for it. */
				trailing={
					<IconButton
						type="button"
						size="xs"
						on={showing === "more"}
						onClick={() => open("more")}
						title="More tools"
						aria-label="More tools"
					>
						{Ic.more(ICON.md)}
					</IconButton>
				}
			/>
			{/* The package's sheet, not the app's. The app's `Sheet` portals to the
			    body at z-index 701 and this studio is a VUI workspace overlay at
			    1000, so an app sheet opened from in here renders UNDERNEATH the
			    timeline it came from — the ruler was intercepting its clicks. The
			    package's sheet lives inside the workspace's own stacking, takes the
			    same band as the inspector sheet, and inherits the body padding
			    token with it. */}
			<VuiSheet
				open={showing === "add"}
				title="Add layer"
				onRequestClose={close}
				className="tl2-studio-toolsheet"
			>
				<div className="tl2-clipactions">
					{LAYER_KINDS.map(({ kind, label, icon }) => (
						<button
							key={kind}
							type="button"
							className="tl2-clipaction"
							onClick={() => {
								close();
								addLayer(kind);
							}}
						>
							{icon(16)}
							<span>{label}</span>
						</button>
					))}
				</div>
			</VuiSheet>
			<VuiSheet
				open={showing === "more"}
				title="Tools"
				onRequestClose={close}
				className="tl2-studio-toolsheet"
			>
				<div className="tl2-clipactions">
					<button
						type="button"
						className="tl2-clipaction"
						onClick={() => {
							close();
							onStop();
						}}
					>
						{JumpIcon(16, false)}
						<span>Jump to start</span>
					</button>
				</div>
			</VuiSheet>
		</>
	);
}
