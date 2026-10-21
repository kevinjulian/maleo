/* The timeline's transport bar: undo/redo, split, trim, duplicate, delete,
 * bookmarks and A/B hook takes; playback and timecode; then the snapping and
 * ripple modes, scene count, the aspect menu, organize, the insight and
 * beat-grid toggles, density, and zoom.
 *
 * A region rather than a slice taken to make room: `abOpen` — the hook-takes
 * popover — is read here and nowhere else, so the state travels with the markup.
 * Everything else it draws is already an op, a view value, or a chrome field it
 * subscribes to itself. */
import { Select } from "@design-system/components/select.tsx";
import { useState } from "react";
import type { JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { PanelHeader } from "@design-system/patterns/panel-header.tsx";
import { Sheet } from "@design-system/components/sheet.tsx";
import { usePhoneLayout } from "@hooks/editor/use-phone-layout.ts";
import { Button } from "@design-system/components/button.tsx";
import { useChromeField, type EditorChromeStore } from "@stores/editor-chrome-store.ts";
import {
	selectDerivedArrays,
	useDocumentSelector,
	type TimelineDocumentStore,
} from "@stores/timeline-document-store.ts";
import { PLAYBACK_RATES } from "@models/timeline/timeline-editor-model.ts";
import { storeRippleEnabled, storeSnapEnabled } from "@models/timeline/timeline-toggles.ts";
import { TransportControls } from "@design-system/patterns/transport.tsx";
import { UndoIcon, JumpIcon, AspectIcon } from "./timeline-editor-icons.tsx";
import { usePlayheadSec } from "@hooks/timeline/use-playhead.ts";
import type { TimelineTracksOps, TimelineTracksView } from "./timeline-tracks.tsx";
import { TimelineToolbarFrame } from "./timeline-toolbar-frame.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";
import { Slider } from "@design-system/components/slider.tsx";
import { ToolbarAction, ToolbarGroup } from "@design-system/patterns/toolbar.tsx";
import { Menu, MenuItem } from "@design-system/components/menu.tsx";
import { buttonClass } from "@design-system/components/button-recipe.ts";

export function TimelineToolbar({
	store,
	chromeStore,
	ops,
	view,
	gutterOn,
	toggleGutter,
	organizeRange,
	organizeResult,
	openBookmarks,
}: {
	store: TimelineDocumentStore;
	chromeStore: EditorChromeStore;
	ops: TimelineTracksOps;
	view: TimelineTracksView;
	/* Gutter visibility. Owned by the tracks region that draws the gutter, and
	   handed down rather than re-read here: two components reading the stored
	   preference independently would each hold their own copy and desync the
	   moment either one toggled. */
	gutterOn: boolean;
	toggleGutter: () => void;
	/* Organize lives with the drag it keys on, which is the tracks region rather
	   than the editor — so it arrives as its own prop instead of riding in the
	   editor's ops bag. */
	organizeRange: () => void;
	organizeResult: string | null;
	openBookmarks: () => void;
}): JSX.Element {
	const {
		splitAtPlayhead,
		trimAtPlayhead,
		duplicateSelection,
		deleteByMode,
		seekPreview,
		togglePlay,
		setAspectRatio,
		zoomIn,
		zoomOut,
		setZoomPercent,
		saveHookVariant,
		applyHookVariant,
		removeHookVariant,
	} = ops;
	const {
		playing,
		playhead,
		total,
		undoStack,
		selectedFreeId,
		selectedFreeIds,
		hookVariants,
		currentAspect,
		aspectOptions,
		insightsOn,
		setInsightsOn,
		musicClip,
		beatGridOn,
		setBeatGridOn,
		zoomPercent,
		canZoomIn,
		canZoomOut,
	} = view;

	/* The one surface in the timeline that DISPLAYS the time, so the one that
	 * subscribes to it. Taken here rather than by the tracks above: a
	 * subscription there would re-render every lane and every clip to update a
	 * timecode, which is the arrangement this change removed. */
	const playheadSec = usePlayheadSec(playhead);

	const scenes = useDocumentSelector(store, selectDerivedArrays).scenes;
	const [timelineDensity, setTimelineDensity] = useChromeField(chromeStore, "timelineDensity");
	const [playbackRate, setPlaybackRate] = useChromeField(chromeStore, "playbackRate");
	const [snapping, setSnapping] = useChromeField(chromeStore, "snapping");
	const [rippleEditing, setRippleEditing] = useChromeField(chromeStore, "rippleEditing");
	/* Duplicate and delete act on the free-clip selection, as their shortcuts do. */
	const hasSelection = selectedFreeIds.size > 0 || selectedFreeId != null;

	// The hook-takes popover. Nothing outside this bar reads it.
	const [abOpen, setAbOpen] = useState(false);
	/* The tools sheet is NOT local state, unlike the popover above. It shares the
	 * bottom edge with clip properties and clip actions, which live in two other
	 * components — as three private booleans, nothing stopped two being open at
	 * once, and two stacked sheets fought over one scrim. */
	const [bottomSheet, setBottomSheet] = useChromeField(chromeStore, "bottomSheet");
	const moreOpen = bottomSheet === "tools";

	const phone = usePhoneLayout();

	/* Groups, so the phone bar and the More sheet share one tree. Duplicating
	 * these would duplicate every disabled/active binding they carry. */
	const undoRedo = (
		<ToolbarGroup label="History">
			<ToolbarAction
				label="Undo"
				hint="Undo (⌘Z)"
				icon={UndoIcon(15, false)}
				disabled={!undoStack.canUndo}
				onAction={undoStack.undo}
			/>
			<ToolbarAction
				label="Redo"
				hint="Redo (⇧⌘Z)"
				icon={UndoIcon(15, true)}
				disabled={!undoStack.canRedo}
				onAction={undoStack.redo}
			/>
		</ToolbarGroup>
	);
	const splitAndTakes = (
		<ToolbarGroup label="Edit">
			<ToolbarAction
				label="Split at playhead"
				hint="Trim / split at playhead (S)"
				icon={Ic.cut(ICON.sm)}
				onAction={splitAtPlayhead}
			/>
			<Menu
				label="Trim clip"
				trigger="Trim"
				triggerClassName={buttonClass({ variant: "ghost", size: "xs" })}
			>
				<MenuItem onSelect={() => trimAtPlayhead("before")}>
					Trim before playhead <kbd>Q</kbd>
				</MenuItem>
				<MenuItem onSelect={() => trimAtPlayhead("after")}>
					Trim after playhead <kbd>W</kbd>
				</MenuItem>
			</Menu>
			<ToolbarAction
				label="Duplicate"
				hint="Duplicate selection (⌘D)"
				icon={Ic.copy(ICON.sm)}
				disabled={!hasSelection}
				onAction={duplicateSelection}
			/>
			<ToolbarAction
				label="Delete"
				hint={
					rippleEditing
						? "Delete and close the gap (Delete) — Shift+Delete leaves it"
						: "Delete selection (Delete) — Shift+Delete closes the gap"
				}
				icon={Ic.trash(ICON.sm)}
				danger
				disabled={!hasSelection}
				onAction={() => deleteByMode(false)}
			/>
			<ToolbarAction
				label="Bookmarks"
				icon={Ic.book(ICON.sm)}
				onAction={() => {
					setBottomSheet("none");
					openBookmarks();
				}}
			/>
			<span className="tl2-ab">
				<ToolbarAction
					label="Hook takes"
					hint="A/B hook takes — save and swap first-scene variants"
					icon={Ic.abTest(ICON.md)}
					on={abOpen}
					onAction={() => setAbOpen((v) => !v)}
				/>
				{abOpen && (
					<div className="tl2-ab-pop">
						<div className="tl2-ab-h">Hook takes</div>
						<p className="tl2-ab-note">
							Snapshot the first scene, rewrite the hook (chat → Hook writer), then swap takes and
							export each to compare.
						</p>
						<Button
							variant="primary"
							size="sm"
							style={{ justifyContent: "center" }}
							disabled={!scenes.length}
							onClick={saveHookVariant}
						>
							{Ic.plus(ICON.xs)} Save current hook
						</Button>
						{hookVariants.map((v) => (
							<div key={v.id} className="tl2-ab-row">
								<span className="tl2-ab-label">{v.label}</span>
								<span className="tl2-ab-vo" title={v.scene.vo}>
									{v.scene.vo || v.scene.name || "—"}
								</span>
								<Button size="sm" onClick={() => applyHookVariant(v)}>
									Apply
								</Button>
								<IconButton size="xs" title="Delete take" onClick={() => removeHookVariant(v.id)}>
									{Ic.x(ICON.xs)}
								</IconButton>
							</div>
						))}
					</div>
				)}
			</span>
		</ToolbarGroup>
	);
	const rate = (
		<Select
			aria-label="Playback speed"
			width="auto"
			phoneBreakpoint={860}
			value={String(playbackRate)}
			onValueChange={(value) => {
				const rate = PLAYBACK_RATES.find((rate) => String(rate) === value);
				if (rate !== undefined) setPlaybackRate(rate);
			}}
			options={PLAYBACK_RATES.map((rate) => ({ value: String(rate), label: `${rate}×` }))}
			trigger={
				<Button variant="ghost" size="xs" title="Playback speed — J slower / L faster">
					{playbackRate}×
				</Button>
			}
		/>
	);

	const jumpStart = (
		<ToolbarAction
			label="Jump to start"
			icon={JumpIcon(15, false)}
			onAction={() => seekPreview(0)}
		/>
	);
	const jumpEnd = (
		<ToolbarAction
			label="Jump to end"
			icon={JumpIcon(15, true)}
			onAction={() => seekPreview(total)}
		/>
	);
	/* One tree for the desktop strip and the phone's More sheet; it used to be
	 * written out twice, differing by one button. The density toggle is dropped
	 * on a phone, not sheeted: `pointer: coarse` already forces the compact
	 * metrics (tracks.css), so there the control is inert, and a button that
	 * silently does nothing is worse than an absent one. The gutter toggle stays:
	 * it is what gives the 120px back to the timeline. On the desktop strip
	 * Organize is icon-only until it has a result to report: its label did not
	 * fit beside eighteen other controls. */
	const viewGroups = (density: boolean): JSX.Element => (
		<>
			<ToolbarGroup label="Editing">
				<ToolbarAction
					label="Snapping"
					hint={
						snapping
							? "Snapping on — clips snap to the playhead, cuts and clip edges"
							: "Snapping off"
					}
					icon={Ic.magnet(ICON.md)}
					on={snapping}
					onAction={() => {
						const next = !snapping;
						storeSnapEnabled(next);
						setSnapping(next);
					}}
				/>
				<ToolbarAction
					label="Ripple editing"
					hint={
						rippleEditing
							? "Ripple editing on — trims and deletes close the gap"
							: "Ripple editing off"
					}
					icon={Ic.ripple(ICON.md)}
					on={rippleEditing}
					onAction={() => {
						const next = !rippleEditing;
						storeRippleEnabled(next);
						setRippleEditing(next);
					}}
				/>
			</ToolbarGroup>
			<ToolbarGroup label="Composition">
				<span className="tl2-flow" title="Generated scenes">
					{scenes.length} scenes
				</span>
				<Select
					aria-label="Aspect ratio"
					width="auto"
					phoneBreakpoint={860}
					value={currentAspect}
					onValueChange={setAspectRatio}
					options={aspectOptions.map((option) => ({
						value: option.id,
						label: option.id,
						description: option.label,
						icon: AspectIcon({ kind: option.icon, s: ICON.md }),
					}))}
					trigger={
						<Button variant="ghost" size="xs" title="Aspect ratio">
							{AspectIcon({
								kind: aspectOptions.find((option) => option.id === currentAspect)?.icon ?? "phone",
								s: ICON.sm,
							})}
							{currentAspect}
							{Ic.chevD(ICON.xs)}
						</Button>
					}
				/>
			</ToolbarGroup>
			<ToolbarGroup label="View">
				<ToolbarAction
					label="Organize range"
					hint="Organize selected clips, or current scene range, into semantic lanes. No clips are removed."
					icon={Ic.layers(ICON.xs)}
					onAction={organizeRange}
				>
					{organizeResult ?? (density ? null : "Organize range")}
				</ToolbarAction>
				<ToolbarAction
					label="Pacing insights"
					hint="Pacing insights — density lane, retention heatmap, lint badges"
					icon={Ic.pulse(ICON.md)}
					on={insightsOn}
					onAction={() => setInsightsOn((v) => !v)}
				/>
				<ToolbarAction
					label="Beat grid"
					hint={
						musicClip
							? "Beat grid — snap cuts to music beats"
							: "Beat grid (add a music clip first)"
					}
					icon={Ic.music(ICON.md)}
					on={beatGridOn}
					disabled={!musicClip}
					onAction={() => setBeatGridOn((v) => !v)}
				/>
				{density && (
					<ToolbarAction
						label="Comfortable density"
						hint="Toggle compact / comfortable timeline density"
						icon={Ic.density(ICON.md)}
						on={timelineDensity === "comfortable"}
						onAction={() =>
							setTimelineDensity((d) => (d === "comfortable" ? "compact" : "comfortable"))
						}
					/>
				)}
				<ToolbarAction
					label="Track headers"
					hint={gutterOn ? "Hide track headers" : "Show track headers"}
					icon={Ic.layers(ICON.md)}
					on={gutterOn}
					onAction={toggleGutter}
				/>
			</ToolbarGroup>
			<ToolbarGroup label="Timeline zoom" className="tl2-zoom">
				<ToolbarAction
					label="Zoom out"
					hint="Zoom out (-)"
					icon={Ic.zoomOut(ICON.sm)}
					disabled={!canZoomOut}
					onAction={zoomOut}
				/>
				<Slider
					className="tl2-zoom-slider"
					min={0}
					max={100}
					value={zoomPercent}
					onChange={(e) => setZoomPercent(Number(e.target.value))}
					aria-label="Timeline zoom"
				/>
				<ToolbarAction
					label="Zoom in"
					hint="Zoom in (+)"
					icon={Ic.zoomIn(ICON.sm)}
					disabled={!canZoomIn}
					onAction={zoomIn}
				/>
			</ToolbarGroup>
		</>
	);

	if (phone) {
		return (
			<>
				<TimelineToolbarFrame
					leading={undoRedo}
					centre={
						<TransportControls
							playing={playing}
							onTogglePlay={togglePlay}
							currentSec={playheadSec}
							durationSec={total}
						/>
					}
					trailing={
						<IconButton
							size="xs"
							on={moreOpen}
							title="More tools"
							aria-label="More tools"
							onClick={() => setBottomSheet("tools")}
						>
							{Ic.more(ICON.md)}
						</IconButton>
					}
				/>
				<Sheet
					edge="bottom"
					open={moreOpen}
					onClose={() => setBottomSheet("none")}
					offset="var(--tl2-sheet-bottom, var(--tl2-bottombar-h))"
					headroom="var(--tl2-sheet-top, 0px)"
					label="Timeline tools"
					className="tl2-more-sheet"
				>
					<PanelHeader title="Tools" onClose={() => setBottomSheet("none")} />
					<div className="tl2-more-body">
						<div className="tl2-more-row">
							{rate}
							{jumpStart}
							{jumpEnd}
						</div>
						<div className="tl2-more-row">{splitAndTakes}</div>
						<div className="tl2-more-row">{viewGroups(false)}</div>
					</div>
				</Sheet>
			</>
		);
	}

	return (
		<TimelineToolbarFrame
			leading={
				<>
					{undoRedo}
					{splitAndTakes}
				</>
			}
			centre={
				<TransportControls
					playing={playing}
					onTogglePlay={togglePlay}
					currentSec={playheadSec}
					durationSec={total}
					before={
						<>
							{rate}
							{jumpStart}
						</>
					}
					after={jumpEnd}
				/>
			}
			trailing={viewGroups(true)}
		/>
	);
}
