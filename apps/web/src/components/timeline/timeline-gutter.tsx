/* The timeline's track gutter: the sticky head, the scene row, and one row per
 * free track with its group icon and its eye / mute / lock toggles.
 *
 * There is no text label any more. A lane's group is drawn as an icon tinted
 * with the hue its clips already wear, which says the same thing in 20px that
 * two lines of text said in 176px — and the lane itself carries a ghost label
 * when it is empty, which is the only case the icon cannot cover.
 *
 * There is no drag grip either. It used the HTML5 drag-and-drop API, which does
 * not fire on touch AT ALL, so reorder was silently desktop-only. Reorder is now
 * a pointer gesture gated on selection, the same rule clips use: an unselected
 * header scrolls the timeline, a selected one moves the lane.
 *
 * `moveFreeRow`, `toggleTrackFlag` and the flags themselves stay injected: the
 * gutter calls them, it does not own them. */
import { Fragment, useRef, useState } from "react";
import type { JSX, ReactNode, RefObject, PointerEvent as ReactPointerEvent } from "react";
import type { TrackFlags, LaneGroup } from "@maleo/shared";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { HeadIc } from "./timeline-editor-icons.tsx";
import { laneGroupHue, laneGroupOf, laneLabel } from "@models/timeline/timeline-clips.ts";

/* The glyph a lane wears, resolved through ONE total map.
 *
 * Total because a missing icon key is a runtime CRASH rather than a type error —
 * `Ic` is a `Record<string, ...>`, so `Ic.nosuchthing(ICON.sm)` type-checks and then
 * takes the editor down, which is exactly how `Ic.more` did once. Naming every
 * group here means adding a sixth group fails to compile instead. An untyped
 * lane falls back to the neutral `layers` mark.
 *
 * `spark` is already the in-clip icon for effect, so the
 * gutter and the clip body agree without anyone maintaining that they do. */
const LANE_GROUP_GLYPH = {
	visual: "film",
	audio: "waveform",
	text: "type",
	caption: "captions",
	effect: "spark",
} satisfies Record<LaneGroup, string>;

function laneGroupGlyph(group: LaneGroup | undefined): (size?: number) => JSX.Element {
	const key = group ? LANE_GROUP_GLYPH[group] : "layers";
	const glyph = Ic[key];
	if (!glyph) throw new Error(`icon registry has no "${key}" glyph`);
	return glyph;
}

export function TimelineGutter({
	gutterRef,
	tailRef,
	rowsHoldingSelection,
	freeRows,
	trackFlags,
	toggleTrackFlag,
	moveFreeRow,
	showInsightSpacer,
	showMarkSpacer,
	showBookmarkSpacer = false,
	coarse,
	selectedRow,
	onSelectRow,
	afterRow,
}: {
	/** Rendered directly under a row (`-1` is the scene row): the selected clip's expanded key-lane labels. */
	afterRow?: (row: number) => ReactNode;
	/** The gutter column, which scrolls vertically in step with the lanes. */
	gutterRef: RefObject<HTMLDivElement | null>;
	/** The spacer that evens out the two columns' scroll ranges. */
	tailRef: RefObject<HTMLDivElement | null>;
	/** Rows holding a selected clip, tinted like their lanes; -1 is the scene row. */
	rowsHoldingSelection: ReadonlySet<number>;
	freeRows: number;
	trackFlags: TrackFlags;
	toggleTrackFlag: (row: number, key: "hidden" | "muted" | "locked") => void;
	moveFreeRow: (from: number, to: number) => number;
	showInsightSpacer: boolean;
	showMarkSpacer: boolean;
	showBookmarkSpacer?: boolean;
	/** Finger or mouse. Decides whether reorder needs a prior selection. */
	coarse: boolean;
	/** The lane whose header is selected, or null. */
	selectedRow: number | null;
	onSelectRow: (row: number | null) => void;
}): JSX.Element {
	/* The live reorder drag, held in REFS and mirrored into state.
	 *
	 * The refs are what the handlers read; the state is only what the rows paint
	 * with. They cannot be one thing: a pointermove can arrive in the same task
	 * as the pointerdown that started the drag, before React has re-rendered, and
	 * a handler reading `rowDrag` from render state then sees `null` and drops
	 * the move. Every dropped move leaves `moved` false, so the whole gesture
	 * degrades to a tap and the lane silently does not reorder — which is exactly
	 * what it did. A ref is current the instant it is written. */
	const dragRef = useRef<number | null>(null);
	const overRef = useRef<number | null>(null);
	// Whether the pointer actually left the row it pressed. A press that did not
	// is a tap, and a tap selects rather than reorders.
	const movedRef = useRef(false);
	const [rowDrag, setRowDrag] = useState<number | null>(null);
	const [rowDragOver, setRowDragOver] = useState<number | null>(null);

	/* Selection arms manipulation, exactly as it does for clips.
	 *
	 * On a coarse pointer an unselected header keeps `touch-action: pan-y` and
	 * its drag scrolls the timeline; a selected header takes `touch-action: none`
	 * and its drag moves the lane. There is no press-and-hold: a hold would put
	 * back a timing threshold racing the gesture it shares a surface with, which
	 * this editor has twice declined to tune and cannot verify without hardware.
	 *
	 * With a mouse the press is unambiguous — the pointer is already on the row
	 * and scrolling is a different device — so reorder stays direct. */
	const dragArmed = (row: number): boolean => !coarse || selectedRow === row;

	const beginDrag =
		(row: number) =>
		(e: ReactPointerEvent<HTMLDivElement>): void => {
			if (e.button !== 0 || !dragArmed(row)) return;
			movedRef.current = false;
			dragRef.current = row;
			overRef.current = row;
			setRowDrag(row);
			setRowDragOver(row);
			// Capture can be refused for a pointer the browser no longer considers
			// active; the drag does not depend on it, so a failure must not abort the
			// gesture that has already been armed above.
			try {
				e.currentTarget.setPointerCapture(e.pointerId);
			} catch {
				/* not capturable */
			}
		};

	const trackDrag = (e: ReactPointerEvent<HTMLDivElement>): void => {
		if (dragRef.current == null) return;
		// The capture keeps events on the row the drag STARTED on, so the row under
		// the pointer has to be hit-tested rather than read off the event.
		const under = document
			.elementFromPoint(e.clientX, e.clientY)
			?.closest<HTMLElement>("[data-gutter-row]");
		const row = under ? Number(under.dataset.gutterRow) : Number.NaN;
		if (!Number.isFinite(row) || row < 0) return;
		if (row !== dragRef.current) movedRef.current = true;
		overRef.current = row;
		setRowDragOver(row);
	};

	const endDrag =
		(row: number) =>
		(e: ReactPointerEvent<HTMLDivElement>): void => {
			if (e.currentTarget.hasPointerCapture(e.pointerId))
				e.currentTarget.releasePointerCapture(e.pointerId);
			const from = dragRef.current;
			const to = overRef.current;
			const moved = movedRef.current;
			dragRef.current = null;
			overRef.current = null;
			movedRef.current = false;
			setRowDrag(null);
			setRowDragOver(null);
			// A press that never left its row is a tap: select, and move nothing.
			if (from == null || !moved || to == null || to === from) {
				onSelectRow(selectedRow === row ? null : row);
				return;
			}
			/* Follow the lane to wherever it landed. A lane's identity on this surface
			 * is its INDEX, so leaving the selection on `from` after a move does not
			 * keep the selection where it was — it silently transfers it to whichever
			 * lane shifted into that slot. */
			onSelectRow(moveFreeRow(from, to));
		};

	return (
		<div ref={gutterRef} className="tl2-gutter">
			<div className="tl2-gutter-body">
				<div className="tl2-stick tl2-gutter-head">
					<div className="tl2-gutter-spacer" />
					{showBookmarkSpacer && <div className="tl2-bookmark-band" />}
					{showInsightSpacer && <div className="tl2-gutter-insightspace" />}
					{showMarkSpacer && <div className="tl2-gutter-markspace" />}
				</div>
				<div
					data-lane-base=""
					className={`tl2-gutter-row ${rowsHoldingSelection.has(-1) ? "holds" : ""} ${trackFlags[-1]?.locked ? "locked" : ""}`}
				>
					<span className="tl2-track-ic" style={{ color: laneGroupHue("visual") }} title="Scenes">
						{Ic.film(ICON.sm)}
					</span>
					<button
						className={`tl2-track-tg ${trackFlags[-1]?.hidden ? "on" : ""}`}
						title={trackFlags[-1]?.hidden ? "Show scene track" : "Hide scene track"}
						onClick={() => toggleTrackFlag(-1, "hidden")}
					>
						{HeadIc.eye(Boolean(trackFlags[-1]?.hidden))}
					</button>
					<button
						className={`tl2-track-tg ${trackFlags[-1]?.muted ? "on" : ""}`}
						title={trackFlags[-1]?.muted ? "Unmute scene track" : "Mute scene track"}
						onClick={() => toggleTrackFlag(-1, "muted")}
					>
						{HeadIc.mute(Boolean(trackFlags[-1]?.muted))}
					</button>
					<button
						className={`tl2-track-tg ${trackFlags[-1]?.locked ? "on" : ""}`}
						title={trackFlags[-1]?.locked ? "Unlock scene track" : "Lock scene track"}
						onClick={() => toggleTrackFlag(-1, "locked")}
					>
						{HeadIc.lock(Boolean(trackFlags[-1]?.locked))}
					</button>
				</div>
				{afterRow?.(-1)}
				{Array.from({ length: freeRows }).map((_, i) => {
					const f = trackFlags[i] ?? {};
					const group = laneGroupOf(trackFlags, i);
					const rowLabel = laneLabel(group, i);
					const selected = selectedRow === i;
					return (
						<Fragment key={`g${i}`}>
							<div
								data-gutter-row={i}
								/* Same attribute the lane carries, read by the same CSS rule: the row
					   and its lane cannot resolve to different heights. */
								data-lane-group={group}
								className={`tl2-gutter-row ${rowDragOver === i && rowDrag != null ? "droptarget" : ""} ${selected ? "on" : ""} ${rowsHoldingSelection.has(i) ? "holds" : ""} ${rowDrag === i ? "dragging" : ""} ${f.locked ? "locked" : ""}`}
								title={`${rowLabel.label} — ${coarse ? "tap to select, then drag to reorder" : "drag to reorder"}`}
								onPointerDown={beginDrag(i)}
								onPointerMove={trackDrag}
								onPointerUp={endDrag(i)}
								onPointerCancel={endDrag(i)}
							>
								<span
									className="tl2-track-ic"
									style={{ color: laneGroupHue(group) }}
									aria-label={rowLabel.label}
								>
									{laneGroupGlyph(group)(14)}
								</span>
								<button
									className={`tl2-track-tg ${f.hidden ? "on" : ""}`}
									title={f.hidden ? "Show track" : "Hide track"}
									onPointerDown={(e) => e.stopPropagation()}
									onClick={() => toggleTrackFlag(i, "hidden")}
								>
									{HeadIc.eye(Boolean(f.hidden))}
								</button>
								<button
									className={`tl2-track-tg ${f.muted ? "on" : ""}`}
									title={f.muted ? "Unmute track" : "Mute track"}
									onPointerDown={(e) => e.stopPropagation()}
									onClick={() => toggleTrackFlag(i, "muted")}
								>
									{HeadIc.mute(Boolean(f.muted))}
								</button>
								<button
									className={`tl2-track-tg ${f.locked ? "on" : ""}`}
									title={f.locked ? "Unlock track" : "Lock track"}
									onPointerDown={(e) => e.stopPropagation()}
									onClick={() => toggleTrackFlag(i, "locked")}
								>
									{HeadIc.lock(Boolean(f.locked))}
								</button>
							</div>
							{afterRow?.(i)}
						</Fragment>
					);
				})}
			</div>
			{/* Sized by `useGutterScrollSync` so this column's scroll range matches the
		    lanes', whose viewport loses its horizontal scrollbar's height. */}
			<div ref={tailRef} className="tl2-gutter-tail" aria-hidden="true" />
		</div>
	);
}
