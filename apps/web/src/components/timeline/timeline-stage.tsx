import type { ClipLayout } from "@models/timeline/clip-layout.ts";
/* The preview stage: the Remotion player, the clip boxes and hit areas drawn
 * over it, the project-references popover, the docked clip inspector, and the
 * three right-click menus that open from the timeline.
 *
 * Split out of `timeline-editor.tsx` alongside `timeline-tracks.tsx`. Same rule:
 * the document, the chrome and the reference library are read from their
 * stores here, so the two bags below carry only what the editor derives.
 *
 * The context menus render here rather than in the tracks because they are
 * fixed-position overlays anchored to viewport coordinates — they belong to
 * whichever surface paints on top, not to the lane that opened them. Their
 * state stays in the editor because `useClipOps` and the keyboard shortcuts
 * both close them.
 */
import { useCallback, useMemo, useState } from "react";
import type { CSSProperties, Dispatch, JSX, SetStateAction } from "react";
import { cssVars } from "@models/core/css-vars.ts";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { Note } from "@design-system/components/note.tsx";
import { type PlayerRef } from "@remotion/player";
import { StoryboardReel } from "@maleo/video/composition";
import { VuiPreviewStage } from "@components/editor-workspace/primitives.tsx";
import { VuiRemotionPreview } from "./remotion-preview.tsx";
import { AnimatedClipBox } from "./animated-clip-box.tsx";
import { TimelineStageMenus } from "./timeline-stage-menus.tsx";

import { previewFrameAt, sceneSpans } from "@models/timeline/preview-frame.ts";
import { boundaryTimes, segmentIndexAt } from "@models/timeline/time-segments.ts";
import { canvasHitClipsAt } from "@models/timeline/canvas-hit-clips.ts";
import type { EditorDoc } from "@models/storyboard/editor-doc.ts";
import type { CanvasSelection } from "@hooks/timeline/use-canvas-selection.ts";
import { collectPreloadAssets } from "@models/timeline/preload-assets.ts";
import { useTimelineAssetPreload } from "@hooks/timeline/remotion-preload.ts";
import { usePlayheadSelector } from "@hooks/timeline/use-playhead.ts";
import type { PlayheadHandle } from "@models/timeline/playhead-handle.ts";
import { countRender } from "@models/timeline/render-probe.ts";
import { type PrimaryClipSource, type Selection } from "@models/timeline/selection-model.ts";
import {
	useChromeField,
	useChromeSetter,
	type EditorChromeStore,
} from "@stores/editor-chrome-store.ts";
import {
	selectDerivedArrays,
	selectDocMaterials,
	useDocumentSelector,
	type TimelineDocumentStore,
} from "@stores/timeline-document-store.ts";
import type { DocumentWriters } from "@stores/document-writers.ts";
import type { ReferenceLibraryState } from "@hooks/editor/use-reference-library.ts";
import type { CreativeSettings } from "@hooks/editor/use-creative-settings.ts";
import { useProjectMaterialsContext } from "@hooks/editor/use-project-materials-context.ts";
import { ProjectMaterialsDrawer, filledMaterialCount } from "./project-materials-drawer.tsx";
import { useActiveWorkspace } from "@hooks/workspace/use-active-workspace.ts";
import { rulesSettingsSummary } from "@models/materials/material-vocabulary.ts";
import type { Scene, TextOverlay, TextPreset, TrackFlags, TemplateParams } from "@maleo/shared";
import type { ChatLogMessage } from "@models/chat/chat-log.ts";
import { useAudioOps } from "@hooks/timeline/use-audio-ops.ts";
import { useVideoOverlayOps } from "@hooks/timeline/use-video-overlay-ops.ts";
import { useEffectOps } from "@hooks/timeline/use-effect-ops.ts";
import { useTransitionOps } from "@hooks/timeline/use-transition-ops.ts";
import { useSceneOps } from "@hooks/timeline/use-scene-ops.ts";
import { useSceneGeneration } from "@hooks/timeline/use-scene-generation.ts";
import { useVisualClipOps } from "@hooks/timeline/use-visual-clip-ops.ts";
import { useClipOps } from "@hooks/timeline/use-clip-ops.ts";
import { usePreviewComposition } from "@hooks/timeline/use-preview-composition.ts";

/* Option lists the selects below render from, so the control and its handler
 * read the same array and cannot disagree about which values exist. */

type AudioApi = ReturnType<typeof useAudioOps>;
type VideoApi = ReturnType<typeof useVideoOverlayOps>;
type EffectApi = ReturnType<typeof useEffectOps>;
type TransitionApi = ReturnType<typeof useTransitionOps>;
type SceneOpsApi = ReturnType<typeof useSceneOps>;
type SceneGenApi = ReturnType<typeof useSceneGeneration>;
type VisualClipApi = ReturnType<typeof useVisualClipOps>;
type ClipOpsApi = ReturnType<typeof useClipOps>;
type PreviewApi = ReturnType<typeof usePreviewComposition>;

/** A viewport-anchored right-click menu. */
export interface MenuAt {
	x: number;
	y: number;
}

/** The actions the stage invokes. */
export interface TimelineStageOps {
	selectScene: (sceneId: number) => void;
	setAspectRatio: (format: string) => void;
	selectFreeClip: (
		source: PrimaryClipSource | "caption",
		refId: number | string,
		start: number,
	) => void;
	clearSelection: () => void;
	setSelection: Dispatch<SetStateAction<Selection>>;
	openSceneEditor: (sceneId: number) => void;
	showInChat: (label: string, ref?: ChatLogMessage["ref"]) => void;
	setSceneLayout: (id: number, patch: Partial<ClipLayout>) => void;
	setSceneVisual: VisualClipApi["setSceneVisual"];
	upd: (id: number, f: keyof Scene, v: unknown) => void;
	trackLocked: (row?: number) => boolean;
	addOverlay: (
		at?: number,
		track?: number,
		preset?: TextPreset,
		paramsOverride?: TemplateParams,
	) => void;
	updateOverlay: (id: number, patch: Partial<TextOverlay>) => void;
	addAudio: AudioApi["addAudio"];
	updateAudio: AudioApi["updateAudio"];
	regenAudio: AudioApi["regenAudio"];
	updateVideoOverlay: VideoApi["updateVideoOverlay"];
	addEffect: EffectApi["addEffect"];
	removeEffect: EffectApi["removeEffect"];
	upsertTransition: TransitionApi["upsertTransition"];
	updateTransition: TransitionApi["updateTransition"];
	removeTransition: TransitionApi["removeTransition"];
	addSceneAt: SceneOpsApi["addSceneAt"];
	dupScene: SceneOpsApi["dupScene"];
	rmScene: SceneOpsApi["rmScene"];
	genFrame: SceneGenApi["genFrame"];
	animateScene: SceneGenApi["animateScene"];
	copySelection: ClipOpsApi["copySelection"];
	pasteClipboard: ClipOpsApi["pasteClipboard"];
	duplicateSelection: ClipOpsApi["duplicateSelection"];
	deleteSelection: ClipOpsApi["deleteSelection"];
	rippleDeleteSelection: ClipOpsApi["rippleDeleteSelection"];
	reorderSelection: ClipOpsApi["reorderSelection"];
	setCtxMenu: Dispatch<SetStateAction<MenuAt | null>>;
	setSceneMenu: Dispatch<SetStateAction<(MenuAt & { sceneId: number }) | null>>;
	setAddMenu: Dispatch<SetStateAction<(MenuAt & { t: number; row: number }) | null>>;
	clampMenuToViewport: (el: HTMLDivElement | null) => void;
}

/** What the stage reads but does not own. */
export interface TimelineStageView {
	stalled: boolean;
	/** The position, as a handle. The stage subscribes on its own behalf: the
	 *  canvas frame changes with time, and deriving it in the editor above is
	 *  what re-rendered the whole tree at frame rate. */
	playhead: PlayheadHandle;
	playerRef: React.MutableRefObject<PlayerRef | null>;
	previewFps: number;
	previewDims: { w: number; h: number };
	previewProps: PreviewApi["previewProps"];
	previewForDoc: PreviewApi["previewForDoc"];
	previewStoryboard: PreviewApi["previewStoryboard"];
	aspect: PreviewApi["aspect"];
	currentAspect: string;
	previewFrames: number;
	brandPalette: PreviewApi["brandPalette"];
	gen: Record<number, boolean>;
	animateBusy: Record<number, boolean>;
	selectedClip: CanvasSelection["selectedClip"];
	selectedClipLocked: boolean;
	selectedScene: Scene | null;
	selectedOverlay: TextOverlay | null;
	selectedAudio: AudioApi["selectedAudio"];
	selectedVideoOverlay: VideoApi["selectedVideoOverlay"];
	selectedEffectId?: number | null;
	selectedTransition?: number | null;
	selectedFreeIds: Set<string>;
	selectionIds: ClipOpsApi["selectionIds"];
	selectionOverlayIds: number[];
	selection: Selection;
	clipboard: ClipOpsApi["clipboard"];
	ttsBusy: AudioApi["ttsBusy"];
	ttsVoiceOptions: AudioApi["ttsVoiceOptions"];
	ctxMenu: MenuAt | null;
	sceneMenu: (MenuAt & { sceneId: number }) | null;
	addMenu: (MenuAt & { t: number; row: number }) | null;
	drag: { id: number; overId: number | null } | null;
	seekPreview: PreviewApi["seekPreview"];
}

export interface TimelineStageProps {
	store: TimelineDocumentStore;
	writers: DocumentWriters;
	chromeStore: EditorChromeStore;
	library: ReferenceLibraryState;
	creative: CreativeSettings;
	projectId: string | null;
	trackFlags: TrackFlags;
	canvasRef: React.MutableRefObject<HTMLDivElement | null>;
	ops: TimelineStageOps;
	view: TimelineStageView;
}

/* Module-scoped: an inline object here is a new prop identity on every render of
 * the stage, which is a re-render of the Player subtree for a style that never
 * changes. */
const PLAYER_STYLE: CSSProperties = { width: "100%", height: "100%" };

export function TimelineStage({
	store,
	writers,
	chromeStore,
	library,
	creative,
	projectId,
	trackFlags,
	canvasRef,
	ops,
	view,
}: TimelineStageProps): JSX.Element {
	/* The preview. The selection requirement says changing it must not repaint
	 * this subtree, so the tally is how that is checked (render-probe.ts). */
	countRender("stage");
	/* The workspace whose narration writer style the materials drawer edits. It is
	 * workspace config, so it comes from the active workspace rather than from the
	 * project. */
	const activeWorkspace = useActiveWorkspace();
	const { selectScene, selectFreeClip, clearSelection, trackLocked, genFrame } = ops;
	const {
		playhead,
		playerRef,
		previewFps,
		previewDims,
		previewProps,
		previewForDoc,
		previewFrames,
		gen,
		selectedClip,
		selectedClipLocked,
		selectedOverlay,
		selectedVideoOverlay,
		aspect,
	} = view;
	const selectedKey = selectedClip ? `${selectedClip.target.source}:${selectedClip.target.id}` : "";
	const [draft, setDraft] = useState<{ key: string; doc: EditorDoc } | null>(null);
	const draftProps = useMemo(
		() =>
			draft?.key === selectedKey && selectedClip && !selectedClipLocked
				? previewForDoc(draft.doc)
				: previewProps,
		[draft, selectedKey, selectedClip, selectedClipLocked, previewForDoc, previewProps, store],
	);
	const derived = useDocumentSelector(store, selectDerivedArrays);
	const scenes = derived.scenes;
	const overlays = derived.textOverlays;
	const audioOverlays = derived.audioOverlays;
	const videoOverlays = derived.videoOverlays;
	const { setMaterials } = writers;
	const { pool } = library;
	const { settings, elementSources, setElementSources, activePresetId } = creative;
	const materials = useDocumentSelector(store, selectDocMaterials);
	const {
		preset: activePreset,
		library: materialLibrary,
		reload: reloadMaterials,
	} = useProjectMaterialsContext(activePresetId);
	/* The preview's subscription to the playhead — and deliberately not to the
	 * TIME.
	 *
	 * Everything below changes with time: which scene the canvas paints, which
	 * image inside a multi-image beat, which clips are pickable on the preview.
	 * None of it changes at frame rate. Subscribing to the second meant deriving
	 * the same answers thirty times a second, each derivation walking every clip
	 * — so playback stuttered as the clip count grew even though the timeline
	 * had stopped re-rendering entirely (p99 frame time 10ms at 40 clips, 20ms
	 * at 240, worst frame 38ms).
	 *
	 * So this subscribes to the SEGMENT: the gap between two consecutive clip
	 * boundaries, inside which every answer below is constant by construction
	 * (`time-segments.ts`). Finding it is a binary search, so the per-frame cost
	 * no longer grows with the timeline, and the re-render happens when the
	 * picture actually changes. */
	const segmentBoundaries = useMemo(
		() =>
			boundaryTimes([
				...sceneSpans(scenes),
				...videoOverlays.map((v) => ({ start: v.start, end: v.start + v.dur })),
				...overlays.map((o) => ({ start: o.start, end: o.start + o.dur })),
			]),
		[scenes, videoOverlays, overlays],
	);
	const selectSegment = useCallback(
		(sec: number) => segmentIndexAt(segmentBoundaries, sec),
		[segmentBoundaries],
	);
	const segment = usePlayheadSelector(playhead, selectSegment);
	/* The preload window moves slowly and reaches fourteen seconds ahead, so it
	 * is quantised to the second rather than keyed on the segment: a run of short
	 * clips would otherwise re-run it on every one of them. */
	const selectSecond = useCallback((sec: number) => Math.floor(sec), []);
	const second = usePlayheadSelector(playhead, selectSecond);
	/* Where the Player opens. Captured once because that is the only moment it
	 * is read; as a live value it was a prop change on every frame event. */
	const [initialFrame] = useState(() => Math.max(0, Math.round(playhead.get() * previewFps)));

	/* Read at the moment the segment changes, and constant until it changes
	 * again — which is what makes reading the handle inside a memo sound here. */
	const frame = useMemo(() => previewFrameAt(scenes, playhead.get()), [scenes, segment, playhead]);
	const baseScene = frame.scene;
	const baseVisualUrl = frame.visualUrl;
	const isGen = baseScene ? gen[baseScene.id] : false;
	const canvasHitClips = useMemo(
		() =>
			canvasHitClipsAt(
				{
					overlays,
					videoOverlays,
					trackFlags,
					selectedOverlayId: selectedOverlay?.id ?? null,
					selectedVideoOvId: selectedVideoOverlay?.id ?? null,
				},
				playhead.get(),
			),
		[overlays, videoOverlays, trackFlags, selectedOverlay, selectedVideoOverlay, segment, playhead],
	);
	const preloadAssets = useMemo(
		() => collectPreloadAssets(scenes, videoOverlays, audioOverlays),
		[audioOverlays, scenes, videoOverlays],
	);
	useTimelineAssetPreload(preloadAssets, second, 14);

	const [materialsOpen, setMaterialsOpen] = useChromeField(chromeStore, "materialsOpen");
	const [materialsGroup, setMaterialsGroup] = useChromeField(chromeStore, "materialsGroup");

	/* Regenerating a scene image reads Visual materials, so the drawer is opened on
	 * that group as the action fires. The spec's requirement is that the materials
	 * used are REACHABLE before or during the regeneration — an operator who does
	 * not like the result should not have to go looking for what produced it. */
	const regenScene = (id: number): void => {
		setMaterialsGroup("visual");
		setMaterialsOpen(true);
		genFrame(id);
	};
	const [playbackRate] = useChromeField(chromeStore, "playbackRate");
	/* Written from here, drawn elsewhere: the stage opens the edit modal but does
	 * not render it, so it takes the setter and subscribes to nothing. */
	const setEditTarget = useChromeSetter(chromeStore, "editTarget");
	const setRail = useChromeSetter(chromeStore, "rail");
	const setPanelOpen = useChromeSetter(chromeStore, "panelOpen");
	/* Captions are drawn by the renderer, not by a ClipBox, so the rendered caption
	 * box is the hit target: measured at the pointer, it is exact, costs nothing per
	 * frame, and claims only clicks inside it. Capture phase, because the base
	 * scene's full-canvas hit button sits above the player. */
	const pickableCaptionAt = (x: number, y: number): string | null => {
		for (const el of canvasRef.current?.querySelectorAll<HTMLElement>("[data-caption-cue]") ?? []) {
			const r = el.getBoundingClientRect();
			if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
			const clip = store.getDoc().clips.find((item) => item.id === el.dataset.captionCue);
			if (clip?.type === "caption" && !trackFlags[clip.track]?.locked) return clip.id;
		}
		return null;
	};

	return (
		<>
			{view.stalled && (
				<Note tone="error" role="status">
					Preview cannot play this clip. Press Play to try again.
				</Note>
			)}
			<div className="tl2-stage-top">
				<div className="tl2-preview">
					<div className="tl2-projectrefs">
						<button
							className={`tl2-projectrefs-btn ${materialsOpen ? "on" : ""}`}
							title="Edit Project Materials"
							onClick={() => setMaterialsOpen((o) => !o)}
						>
							{Ic.spark(ICON.sm)}
							<span>Project Materials</span>
							<em>{filledMaterialCount(materials)}</em>
						</button>
						{materialsOpen && (
							<ProjectMaterialsDrawer
								materials={materials}
								setMaterials={setMaterials}
								sources={elementSources}
								setSources={setElementSources}
								preset={activePreset}
								library={materialLibrary}
								pool={pool}
								onLibraryChanged={reloadMaterials}
								settingsSummary={rulesSettingsSummary(settings)}
								initialGroup={materialsGroup}
								workspace={activeWorkspace}
								onClose={() => {
									setMaterialsOpen(false);
									setMaterialsGroup(null);
								}}
							/>
						)}
					</div>
					<div
						ref={canvasRef}
						className="tl2-canvas"
						style={{ aspectRatio: String(aspect), ...cssVars({ "--tl2-canvas-aspect": aspect }) }}
						onPointerDown={(e) => {
							if (e.target === canvasRef.current) clearSelection();
						}}
						onPointerDownCapture={(e) => {
							const id = pickableCaptionAt(e.clientX, e.clientY);
							if (!id) return;
							e.preventDefault();
							e.stopPropagation();
							// The current time, so selecting from the preview never moves the playhead.
							selectFreeClip("caption", id, playhead.get());
						}}
						onDoubleClickCapture={(e) => {
							const id = pickableCaptionAt(e.clientX, e.clientY);
							if (!id) return;
							e.preventDefault();
							e.stopPropagation();
							setRail("captions");
							setPanelOpen(true);
							focusCaptionRow(id);
						}}
					>
						<VuiPreviewStage className="tl2-remotion-stage">
							<VuiRemotionPreview
								playerRef={playerRef}
								component={StoryboardReel}
								inputProps={draftProps}
								durationInFrames={previewFrames}
								fps={previewFps}
								compositionWidth={previewDims.w}
								compositionHeight={previewDims.h}
								style={PLAYER_STYLE}
								playbackRate={playbackRate}
								clickToPlay={false}
								spaceKeyToPlayOrPause={false}
								loop={false}
								acknowledgeRemotionLicense
								currentFrame={Math.max(0, Math.min(previewFrames - 1, initialFrame))}
							/>
						</VuiPreviewStage>
						{baseScene && !baseVisualUrl && !isGen && (
							<button className="tl2-canvas-gen" onClick={() => regenScene(baseScene.id)}>
								{Ic.spark(ICON.md)} Generate frame
							</button>
						)}
						{baseScene && !trackLocked(-1) && (
							<button
								type="button"
								className="tl2-canvas-hit scene"
								title="Select scene"
								onPointerDown={(e) => {
									e.preventDefault();
									e.stopPropagation();
									selectScene(baseScene.id);
								}}
							/>
						)}
						{/* Click-to-select layer: transparent hit boxes over every overlay live
				    at the playhead, so you can pick an element directly on the canvas
				    (like the timeline) and then drag it. The selected clip is skipped —
				    its ClipBox owns the drag. Painted before ClipBox so it stays underneath. */}
						{canvasHitClips.map((c) => (
							<button
								key={`${c.source}-${c.id}`}
								type="button"
								className="tl2-canvas-hit"
								style={{
									left: `${c.box.xPct}%`,
									top: `${c.box.yPct}%`,
									width: `${c.box.widthPct}%`,
									height: `${c.box.heightPct}%`,
									rotate: `${c.box.rotationDeg ?? 0}deg`,
								}}
								title="Select on canvas"
								onPointerDown={(e) => {
									e.preventDefault();
									e.stopPropagation();
									selectFreeClip(c.source, c.id, c.start);
								}}
							/>
						))}
						{/* Preview canvas edits POSITION only (drag/resize the box). Double-click
				    opens the content popover — text content and style are never edited
				    inline on the canvas. */}
						{selectedClip && (
							<AnimatedClipBox
								key={selectedKey}
								target={selectedClip.target}
								store={store}
								writers={writers}
								playhead={playhead}
								chromeStore={chromeStore}
								kind={selectedClip.kind}
								canvasRef={canvasRef}
								onPreview={(doc) => setDraft(doc ? { key: selectedKey, doc } : null)}
								locked={selectedClipLocked}
								onActivate={
									selectedClip.kind === "text" && selectedOverlay
										? () =>
												setEditTarget({
													type: "text",
													id: selectedOverlay.id,
												})
										: undefined
								}
							/>
						)}
					</div>

					<TimelineStageMenus
						store={store}
						writers={writers}
						chromeStore={chromeStore}
						projectId={projectId}
						scenes={scenes}
						ops={ops}
						view={view}
					/>
				</div>
			</div>
		</>
	);
}

/** Focus a cue's text once the Captions panel has rendered it; gives up after a
 *  few frames rather than waiting on a panel that did not open. */
function focusCaptionRow(id: string, frames = 10): void {
	const field = document.querySelector<HTMLTextAreaElement>(
		`[data-caption-row="${CSS.escape(id)}"] textarea`,
	);
	if (field) field.focus();
	else if (frames > 0) requestAnimationFrame(() => focusCaptionRow(id, frames - 1));
}
