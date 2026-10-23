/* The two bags `TimelineTracks` takes, and its props.
 *
 * Split out of `timeline-tracks.tsx` so the region's contract reads on its own;
 * that module re-exports every name here, so importers keep their path. */
import type {
	Dispatch,
	MouseEvent as ReactMouseEvent,
	MutableRefObject,
	SetStateAction,
} from "react";
import type {
	BaseTrackClip,
	TimelineClip,
	OverlayTimelineClip,
} from "@models/timeline/timeline-clips.ts";
import type { PrimaryClipSource, Selection } from "@models/timeline/selection-model.ts";
import type { EditorChromeStore } from "@stores/editor-chrome-store.ts";
import type { TimelineDocumentStore } from "@stores/timeline-document-store.ts";
import type { Scene, TrackFlags, TextPreset, TemplateParams } from "@maleo/shared";
import type { HookVariant } from "@models/content/content-types.ts";
import type { UndoStack } from "@hooks/editor/use-command-stack.ts";
import type { DocumentWriters } from "@stores/document-writers.ts";
import type { ReferenceLibraryState } from "@hooks/editor/use-reference-library.ts";
import type { CompositionConfig } from "@models/clip-templates/composition-config.ts";
import type { SetFreeClipPos } from "@hooks/timeline/use-clip-position.ts";
import type { useClipOps } from "@hooks/timeline/use-clip-ops.ts";
import type { useAudioOps } from "@hooks/timeline/use-audio-ops.ts";
import type { useVideoOverlayOps } from "@hooks/timeline/use-video-overlay-ops.ts";
import type { useVisualClipOps } from "@hooks/timeline/use-visual-clip-ops.ts";
import type { useSceneOps } from "@hooks/timeline/use-scene-ops.ts";
import type { useTransitionOps } from "@hooks/timeline/use-transition-ops.ts";
import type { useEffectOps } from "@hooks/timeline/use-effect-ops.ts";
import type { useTimelineZoom } from "@hooks/timeline/use-timeline-zoom.ts";
import type { useBeatGrid } from "@hooks/timeline/use-beat-grid.ts";
import type { usePacingInsights } from "@hooks/timeline/use-pacing-insights.ts";
import type { usePreviewComposition } from "@hooks/timeline/use-preview-composition.ts";
import type { SelectionStore } from "@stores/selection-store.ts";
import type { PlayheadHandle } from "@models/timeline/playhead-handle.ts";

/** Signatures come from the hooks that produce these values rather than being
 *  restated here. A hand-written copy of a hook's signature is a second source
 *  of truth that drifts silently; `ReturnType` cannot. */
type ClipOpsApi = ReturnType<typeof useClipOps>;
type AudioApi = ReturnType<typeof useAudioOps>;
type VideoApi = ReturnType<typeof useVideoOverlayOps>;
type VisualClipApi = ReturnType<typeof useVisualClipOps>;
type SceneOpsApi = ReturnType<typeof useSceneOps>;
type TransitionApi = ReturnType<typeof useTransitionOps>;
type EffectApi = ReturnType<typeof useEffectOps>;
type ZoomApi = ReturnType<typeof useTimelineZoom>;
type BeatApi = ReturnType<typeof useBeatGrid>;
type PacingApi = ReturnType<typeof usePacingInsights>;
type PreviewApi = ReturnType<typeof usePreviewComposition>;

/** The actions the timeline invokes. Everything here mutates the document, the
 *  selection or the playhead — none of it can be derived from a store. */
export interface TimelineTracksOps {
	importFiles: import("@hooks/editor/use-media-import.ts").MediaImportControls["enqueue"];
	/** Null while readiness loads; file drops are refused visibly until import is available. */
	importReadiness: import("@hooks/editor/use-media-import.ts").MediaImportControls["readiness"];
	selectScene: (sceneId: number) => void;
	selectFreeClip: (
		source: PrimaryClipSource | "caption",
		refId: number | string,
		start: number,
	) => void;
	toggleFreeClip: (
		source: "video" | "text" | "audio" | "effect" | "scene" | "caption",
		refId: number | string,
	) => void;
	isClipSelected: (id: string) => boolean;
	clearSelection: () => void;
	setSelection: Dispatch<SetStateAction<Selection>>;
	openAddMenu: (e: ReactMouseEvent<HTMLDivElement>, row: number) => void;
	openClipMenu: ClipOpsApi["openClipMenu"];
	openSceneMenu: (e: ReactMouseEvent<HTMLElement>, sceneId: number) => void;
	splitAtPlayhead: ClipOpsApi["splitAtPlayhead"];
	trimAtPlayhead: ClipOpsApi["trimAtPlayhead"];
	duplicateSelection: ClipOpsApi["duplicateSelection"];
	/** Delete the selection as the ripple mode says; `shift` inverts it. */
	deleteByMode: (shift: boolean) => void;
	toggleTrackFlag: (row: number, key: "hidden" | "muted" | "locked") => void;
	trackLocked: (row?: number) => boolean;
	editTargetFor: (c: OverlayTimelineClip) => { type: "broll" | "audio" | "text"; id: number };
	removeVisualClip: VisualClipApi["removeVisualClip"];
	extendVisualClipDur: VisualClipApi["extendVisualClipDur"];
	addVisualClip: VisualClipApi["addVisualClip"];
	addSceneWithMedia: (url: string, mediaAssetId?: string) => void;
	/** Admit a dropped asset and answer with its identity. Every drop path calls
	 *  it before creating a clip, so placing is what puts an asset in the
	 *  project rather than a save the operator had to remember to make. */
	ensureMediaAsset: ReferenceLibraryState["ensureMediaAsset"];
	mediaAssets: ReferenceLibraryState["mediaAssets"];
	addVideoOverlay: VideoApi["addVideoOverlay"];
	addAudio: AudioApi["addAudio"];
	addOverlay: (
		at?: number,
		track?: number,
		preset?: TextPreset,
		paramsOverride?: TemplateParams,
	) => void;
	removeEffect: EffectApi["removeEffect"];
	placeComposition: (
		config: CompositionConfig,
		label?: string,
		at?: number,
		track?: number,
	) => void;
	updateAudio: AudioApi["updateAudio"];
	updateVideoOverlay: VideoApi["updateVideoOverlay"];
	upd: (id: number, f: keyof Scene, v: unknown) => void;
	reorder: SceneOpsApi["reorder"];
	sceneAt: (t: number) => Scene | undefined;
	transAt: TransitionApi["transAt"];
	upsertTransition: TransitionApi["upsertTransition"];
	seekPreview: PreviewApi["seekPreview"];
	togglePlay: PreviewApi["togglePlay"];
	setAspectRatio: (format: string) => void;
	saveHookVariant: () => void;
	applyHookVariant: (variant: HookVariant) => void;
	removeHookVariant: (id: number) => void;
	zoomIn: ZoomApi["zoomIn"];
	zoomOut: ZoomApi["zoomOut"];
	setZoomPercent: ZoomApi["setZoomPercent"];
	setSelectedFreeIds: Dispatch<SetStateAction<ReadonlySet<string>>>;
	/** Where a clip ends up when a drag commits. Owned by the editor because the
	 *  keyboard nudge and the clip operations write through it too. */
	setFreeClipPos: SetFreeClipPos;
	sceneStart: (id: number) => number;
	setTrackFlags: Dispatch<SetStateAction<TrackFlags>>;
}

/** What the timeline reads but does not own. Derived in the editor because the
 *  preview stage reads the same values. */
export interface TimelineTracksView {
	/** The position, as a handle. The timeline deliberately does NOT subscribe:
	 *  the playhead is drawn by a direct style write and every other consumer
	 *  here reads it inside a handler. See `playhead-handle.ts`. */
	playhead: PlayheadHandle;
	playing: boolean;
	total: number;
	pxPerSec: number;
	freeClips: TimelineClip[];
	freeRows: number;
	baseClips: BaseTrackClip[];
	selectedFreeId: string | null;
	selectedFreeIds: Set<string>;
	selectedSceneId?: number;
	selectedTransition?: number | null;
	editorSceneId?: number;
	gen: Record<number, boolean>;
	pacing: PacingApi["pacing"];
	insightsOn: boolean;
	setInsightsOn: PacingApi["setInsightsOn"];
	musicClip: BeatApi["musicClip"];
	beatGridOn: boolean;
	setBeatGridOn: BeatApi["setBeatGridOn"];
	timelineBeats: BeatApi["timelineBeats"];
	currentAspect: string;
	aspectOptions: readonly { id: string; label: string; icon: string }[];
	hookVariants: HookVariant[];
	zoomPercent: number;
	canZoomIn: boolean;
	canZoomOut: boolean;
	undoStack: UndoStack;
	/** Spans of the current selection, so a scrub can decide whether to keep it. */
	selectionSpansRef: { current: { start: number; end: number }[] };
}

export interface TimelineTracksProps {
	store: TimelineDocumentStore;
	chromeStore: EditorChromeStore;
	trackFlags: TrackFlags;
	/** Owned by the editor: `useTimelineZoom` is keyed on it and the stage reads
	 *  the `pxPerSec` it publishes. */
	trackRef: MutableRefObject<HTMLDivElement | null>;
	/** The document's write interface. Needed here because row compaction and
	 *  organize commit through it, and both key on the drag this component owns. */
	writers: DocumentWriters;
	/** The selection, as a store rather than a value: a clip subscribes to its
	 *  own selected state, so changing the selection re-renders the clips whose
	 *  answer flipped and nothing else. */
	selection: SelectionStore;
	ops: TimelineTracksOps;
	view: TimelineTracksView;
}
