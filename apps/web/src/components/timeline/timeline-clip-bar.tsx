/* The contextual bottom bar: what the tool rail becomes while a clip is
 * selected at phone width.
 *
 * This replaced a long-press context menu, and the reason is worth keeping.
 * Long press is a timing-sensitive gesture racing the drag threshold — the
 * press that opens a menu is the press that begins a drag — and separating them
 * is a tuning problem with no clean answer, one that emulated touch cannot
 * verify, so it would only ever have been settled on hardware. A bar has no
 * timing at all.
 *
 * It also fixes something selection highlighting does badly on a phone: a clip's
 * "selected" outline is a few pixels wide at normal zoom, easy to miss and
 * impossible to read as an affordance. A whole bar changing is unmissable, and
 * it says what the selection lets you DO rather than only that it happened.
 *
 * It swaps the RAIL, not the transport. Undo, redo, play/pause and the timecode
 * live in `timeline-toolbar.tsx`, which is a separate bar and stays put — which
 * matters most in the seconds after an accidental edit.
 */
import type { JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { PanelHeader } from "@design-system/patterns/panel-header.tsx";
import { Sheet } from "@design-system/components/sheet.tsx";
import type { BottomSheet } from "@stores/editor-chrome-store.ts";
import {
	clipPropertyGroups,
	type ClipGroupOptions,
	type ClipPropertyGroupKey,
	type ClipSubject,
} from "./clip-property-groups.tsx";
import { usePendingUpload } from "@hooks/editor/use-pending-upload.ts";
import { pendingUploadLabel } from "@models/core/pending-media-sources.ts";
import { ClipUploadBadge } from "./media/pending-upload.tsx";
import { PreviewClipBadge, PreviewClipActions } from "./media/preview-clip-state.tsx";

export interface ClipBarActions {
	captions?: () => void;
	transition?: () => void;
	splitAtPlayhead: () => void;
	trimAtPlayhead: (side: "before" | "after") => void;
	duplicate: () => void;
	remove: () => void;
}

export function TimelineClipBar({
	subject,
	groupOptions,
	activeGroup,
	sheet,
	onSheet,
	onOpenGroup,
	onDeselect,
	actions,
}: {
	subject: ClipSubject;
	groupOptions: ClipGroupOptions;
	activeGroup: string;
	/* Which bottom sheet is showing, across all three that use this edge. Held
	 * by the store rather than here precisely so this bar cannot open its
	 * actions on top of a properties sheet it does not know about. */
	sheet: BottomSheet;
	onSheet: (next: BottomSheet) => void;
	onOpenGroup: (k: ClipPropertyGroupKey) => void;
	onDeselect: () => void;
	actions: ClipBarActions;
}): JSX.Element {
	const actionsOpen = sheet === "clip-actions";
	const upload = usePendingUpload(subject.mediaUrl);
	/* Any sheet, not only this bar's own. The tools sheet opens from the
	 * transport but covers the same layer, so the leading control has to offer
	 * the way out of that one too — otherwise it would offer to deselect while
	 * something was still open on top of everything. */
	const sheetOpen = sheet !== "none";
	/* The same list the desktop inspector rail draws. A clip kind gaining a
	 * group changes one file, not two — see clip-property-groups.tsx. */
	const groups = clipPropertyGroups(subject.kind, groupOptions);

	const act = (run: () => void): void => {
		onSheet("none");
		run();
	};

	return (
		<nav
			className="tl2-clipbar tl2-bottombar"
			aria-label={`${subject.title} controls`}
			data-app-overlay-persistent
		>
			{/* One control, two jobs, because there are two things to leave and
			    they nest. With a sheet open the nearest layer is the sheet, so this
			    goes BACK one level and the clip stays selected. With nothing open
			    the nearest layer is the selection itself, so it CLOSES that and the
			    tool rail returns.

			    Collapsing the two into an always-deselect control meant putting a
			    sheet down threw the selection away with it; splitting them into two
			    controls would leave a dead one on screen half the time. Deselect is
			    explicit rather than "tap elsewhere" because on a dense timeline that
			    means tapping another clip by accident. */}
			{sheetOpen ? (
				<button
					type="button"
					className="tl2-clipbar-btn tl2-clipbar-lead"
					onClick={() => onSheet("none")}
					aria-label="Back"
					title="Back"
				>
					{Ic.chevronLeft(ICON.lg)}
				</button>
			) : (
				<button
					type="button"
					className="tl2-clipbar-btn tl2-clipbar-lead"
					onClick={onDeselect}
					aria-label="Close"
					title="Close — deselect clip"
				>
					{Ic.x(ICON.lg)}
				</button>
			)}
			<span className="tl2-clipbar-subject" title={subject.title}>
				{subject.title}
				{upload && (
					<span className="tl2-clipbar-upload">
						<ClipUploadBadge state={upload} />
					</span>
				)}
				{!upload && subject.clipId && (
					<span className="tl2-clipbar-upload">
						<PreviewClipBadge id={subject.clipId} />
					</span>
				)}
			</span>
			<span className="tl2-clipbar-groups">
				{groups.map((g) => (
					<button
						key={g.k}
						type="button"
						className={`tl2-clipbar-btn ${activeGroup === g.k ? "on" : ""}`}
						onClick={() => onOpenGroup(g.k)}
						aria-label={g.label}
						title={g.label}
					>
						{g.icon(20)}
					</button>
				))}
			</span>
			{/* Two ellipsis controls end up on screen — this one and the transport's.
			    Accepted rather than designed around: they sit in different bars with
			    different contents, and text labels were rejected in favour of icons. */}
			<button
				type="button"
				className={`tl2-clipbar-btn tl2-clipbar-more ${actionsOpen ? "on" : ""}`}
				onClick={() => onSheet("clip-actions")}
				aria-label="Clip actions"
				title="Clip actions"
			>
				{Ic.more(ICON.lg)}
			</button>
			{/* No `size`: the height comes from `.tl2-clipactions-sheet`, which sizes
			    to the action list. Passing both would be two sources for one number,
			    and the class wins anyway — feature layer beats chrome.

			    Same band as the properties sheet. Both open from this bar, and a
			    bar that survives one of them and is swallowed by the other reads
			    as a bug rather than as two deliberate behaviours. */}
			<Sheet
				edge="bottom"
				open={actionsOpen}
				onClose={() => onSheet("none")}
				offset="var(--tl2-sheet-bottom, var(--tl2-bottombar-h))"
				headroom="var(--tl2-sheet-top, 0px)"
				label={`${subject.title} actions`}
				className="tl2-clipactions-sheet"
			>
				<PanelHeader title={subject.title} onClose={() => onSheet("none")} />
				{upload && (
					<p className="tl2-clipactions-status" role="status">
						{pendingUploadLabel(upload)}
					</p>
				)}
				<div className="tl2-clipactions">
					{subject.clipId && (
						<PreviewClipActions ids={[subject.clipId]} onDone={() => onSheet("none")} />
					)}
					{actions.captions && (
						<button type="button" className="tl2-clipaction" onClick={() => act(actions.captions!)}>
							{Ic.type(ICON.md)}
							<span>Captions</span>
						</button>
					)}
					<button
						type="button"
						className="tl2-clipaction"
						onClick={() => act(actions.splitAtPlayhead)}
					>
						{Ic.cut(ICON.md)}
						<span>Split at playhead</span>
					</button>
					<button
						type="button"
						className="tl2-clipaction"
						onClick={() => act(() => actions.trimAtPlayhead("before"))}
					>
						{Ic.cut(ICON.md)}
						<span>Trim before playhead</span>
					</button>
					<button
						type="button"
						className="tl2-clipaction"
						onClick={() => act(() => actions.trimAtPlayhead("after"))}
					>
						{Ic.cut(ICON.md)}
						<span>Trim after playhead</span>
					</button>
					{actions.transition && (
						<button
							type="button"
							className="tl2-clipaction"
							onClick={() => act(actions.transition!)}
						>
							{Ic.layers(ICON.md)}
							<span>Transition to next clip</span>
						</button>
					)}
					<button type="button" className="tl2-clipaction" onClick={() => act(actions.duplicate)}>
						{Ic.copy(ICON.md)}
						<span>Duplicate</span>
					</button>
					{/* Separated and styled apart: delete is the only entry here that
					    cannot be undone by repeating the gesture. */}
					<span className="tl2-clipactions-sep" aria-hidden />
					<button
						type="button"
						className="tl2-clipaction danger"
						onClick={() => act(actions.remove)}
					>
						{Ic.trash(ICON.md)}
						<span>Delete</span>
					</button>
				</div>
			</Sheet>
		</nav>
	);
}
