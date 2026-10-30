/* The timeline editor's document, chrome, preview and per-kind clip
 * operations: the first half of the hooks TimelineEditor composes, in the
 * order it calls them. Split from timeline-editor.tsx for size; the editor
 * still owns every value, it just reads them back from here. */
import { useEffect, useMemo, useRef, useState } from "react";
import { isPhoneViewport, usePhoneLayout } from "@hooks/editor/use-phone-layout.ts";
import { EMPTY_PROJECT_SELECTION } from "@maleo/shared";
import { selectDerivedArrays, useDocumentSelector } from "@stores/timeline-document-store.ts";
import { usePacingInsights } from "@hooks/timeline/use-pacing-insights.ts";
import { useBeatGrid } from "@hooks/timeline/use-beat-grid.ts";
import { useTimelineZoom } from "@hooks/timeline/use-timeline-zoom.ts";
import { useSceneGeneration } from "@hooks/timeline/use-scene-generation.ts";
import { useTransitionOps } from "@hooks/timeline/use-transition-ops.ts";
import { useEffectOps } from "@hooks/timeline/use-effect-ops.ts";
import { useAudioOps } from "@hooks/timeline/use-audio-ops.ts";
import { useVideoOverlayOps } from "@hooks/timeline/use-video-overlay-ops.ts";
import { useSceneOps } from "@hooks/timeline/use-scene-ops.ts";
import { useSceneTiming } from "@hooks/timeline/use-scene-timing.ts";
import { useHookVariants } from "@hooks/timeline/use-hook-variants.ts";
import { useTrackFlags } from "@hooks/timeline/use-track-flags.ts";
import { useClampMenu } from "@hooks/editor/use-clamp-menu.ts";
import { useAspectRatio } from "@hooks/timeline/use-aspect-ratio.ts";
import { useTextOverlayOps } from "@hooks/timeline/use-text-overlay-ops.ts";
import { usePlaybackRate } from "@hooks/timeline/use-playback-rate.ts";
import { useVisualClipOps } from "@hooks/timeline/use-visual-clip-ops.ts";
import { usePreviewComposition } from "@hooks/timeline/use-preview-composition.ts";
import { createEditorChromeStore, useChromeField } from "@stores/editor-chrome-store.ts";
import { rippleEnabled, snapEnabled } from "@models/timeline/timeline-toggles.ts";
import { useEditorCaptions } from "@hooks/timeline/use-captions.ts";
import { useSceneRefs } from "@hooks/timeline/use-scene-refs.ts";
import {
	clearSelection as clearSelectionIn,
	EMPTY_SELECTION,
} from "@models/timeline/selection-model.ts";
import { useSelection } from "@hooks/timeline/use-selection.ts";
import { useEditorPaneSizing } from "@hooks/timeline/use-editor-pane-sizing.ts";
import { useCanvasSelection } from "@hooks/timeline/use-canvas-selection.ts";
import { useReferenceUsage } from "@hooks/timeline/use-reference-usage.ts";
import { useAnimationInspector } from "@hooks/timeline/use-animation-inspector.ts";
import { usePlayheadEffect } from "@hooks/timeline/use-playhead.ts";

import { useProjectMediaImport } from "@hooks/editor/use-project-media-import.ts";
import type { TimelineEditorProps } from "./timeline-editor.tsx";

export function useTimelineEditorState({
	selectionStore,
	onPlayheadReady,
	config,
	setConfig,
	library,
	projectId,
	store,
	writers,
	creative,
	trackFlags,
	setTrackFlags,
}: TimelineEditorProps) {
	// The creative group arrives as one prop and is read here field by field, so
	// the panels below keep the call sites they had when it was ten props.
	const { settings, setSettings, hookVariants, setHookVariants, pacingDevices } = creative;
	const { refs, setRefs, pool, setPool, ensureMediaAsset, mediaAssets } = library;
	const imports = useProjectMediaImport(projectId, library, store, writers);
	// Upload progress patches rows at every percent; keep the map identity while its files are unchanged.
	const heldFiles = useRef<ReadonlyMap<string, File>>(new Map());
	const pendingFiles = useMemo(() => {
		const next = new Map(
			imports.rows.flatMap((row) => (row.file ? [[row.key, row.file] as const] : [])),
		);
		const held = heldFiles.current;
		if (next.size === held.size && [...next].every(([key, file]) => held.get(key) === file))
			return held;
		heldFiles.current = next;
		return next;
	}, [imports.rows]);
	// Per-type editor views, projected from the canonical clip document (source of
	// truth) by the store. Clip-native reads: no legacy derived-array props — the
	// same memoized projection the parent used, now sourced at the editor seam.
	const derived = useDocumentSelector(store, selectDerivedArrays);
	// One write interface, owned by `document-writers.ts` and shared with the
	// container. This module used to redefine the same eight setter shims, its own
	// `resolveNext`, and a second `mutateDoc` entry point into the same store.
	const {
		setScenes,
		setOverlays,
		setAudioOverlays,
		setVideoOverlays,
		setEffects,
		setProjectReferences,
		mutate: mutateDoc,
	} = writers;
	// Local names for the derived arrays; `projectReferences` is the only one that
	// needs a fallback, because a document written before references existed has none.
	const {
		scenes,
		textOverlays: overlays,
		audioOverlays,
		videoOverlays,
		effects,
		transitions,
	} = derived;
	const projectReferences = derived.projectReferences ?? EMPTY_PROJECT_SELECTION;
	const { captions, setCaptions } = useEditorCaptions({
		store,
		setCaptions: writers.setCaptions,
	});
	// Chrome lives in its own store so a panel can subscribe to the one field it
	// reads. See editor-chrome-store.ts for why not props and why not context.
	// Closed from the start on a phone, where an open chat panel IS the Chat view.
	const chromeStore = useMemo(
		() =>
			createEditorChromeStore({
				...(isPhoneViewport() ? { panelOpen: false } : {}),
				snapping: snapEnabled(),
				rippleEditing: rippleEnabled(),
			}),
		[],
	);
	// The rail owns which destination is open; the editor only needs the setters,
	// to route "show this in chat" and friends. See timeline-rail.tsx.
	const [, setRail] = useChromeField(chromeStore, "rail");
	const [panelOpen, setPanelOpen] = useChromeField(chromeStore, "panelOpen");

	/* Whether the panes are columns or sheets; the Editor | Chat views, and the
	 * phone landing on Editor, are TimelinePhoneWorkspace's. */
	const phone = usePhoneLayout();
	/* Two different questions, deliberately asked separately — see
	 * use-coarse-pointer.ts. `phone` decides what the layout is; `coarse`
	 * decides what a press means. */
	/* Read here only to hand to `organizeRange`; the ruler owns writing it. */
	const [previewSceneId, setPreviewSceneId] = useChromeField(chromeStore, "previewSceneId");
	// Explicit scene selection (nullable). previewSceneId follows the playhead for
	// rendering; selectedSceneId is set only by a deliberate click and drives the
	// clip highlight, so a scene can be deselected (clip-first) without losing preview.
	// Selection lives in one model (declared below); this is a read alias.

	/* The library's "used" badge and delete-impact warning, and the global delete
	 * itself (see use-reference-usage.ts). */
	const { lockedMediaAssetIds, deleteRef } = useReferenceUsage({
		scenes,
		videoOverlays,
		audioOverlays,
		projectReferences,
		setPool,
		setRefs,
		setProjectReferences,
	});

	/* Public VUI root supplies available desktop pane geometry. */
	const stageRef = useRef<HTMLDivElement | null>(null);
	const trackRef = useRef<HTMLDivElement | null>(null);
	const {
		pxPerSec,
		zoomPercent,
		setZoomPercent,
		zoomIn,
		zoomOut,
		canZoomIn,
		canZoomOut,
		fitToWidth,
	} = useTimelineZoom(trackRef);
	const paneSizing = useEditorPaneSizing(stageRef, phone, panelOpen);
	const { toggleTrackFlag, trackLocked } = useTrackFlags(trackFlags, setTrackFlags);
	const [genErr, setGenErr] = useState<string | null>(null);
	const [drag] = useState<{ id: number; overId: number | null } | null>(null);
	// settings now lifted to CreateContent (persisted in editor_state_json).

	// The preview surface: same storyboard object export renders, plus the
	// dimensions, duration and palette derived from it.
	const {
		aspect,
		previewFps,
		previewDims,
		previewStoryboard,
		previewProps,
		previewMedia,
		previewForDoc,
		brandPalette,
		previewDuration,
		previewFrames,
		playhead,
		playing,
		stalled,
		seekPreview,
		togglePlay,
		playerRef,
	} = usePreviewComposition({
		projectId,
		pendingFiles,
		onPlayheadReady,
		config,
		refs,
		getDoc: store.getDoc,
		settings,
		mediaAssets,
		trackFlags,
		captions,
		pacingDevices,
	});
	const { stepRate } = usePlaybackRate(chromeStore);
	/* One selection, one set of transitions — see `selection/selection-model.ts`.
	 * The reads below are aliases so the JSX and the panels keep their names; the
	 * writes all go through the model, which is where "selecting one kind clears
	 * the others" now lives instead of at seven call sites. */
	const {
		selection,
		setSelection,
		slot: selectionSlot,
	} = useSelection(EMPTY_SELECTION, selectionStore);
	const selectedOverlayId = selection.overlayId;
	const selectedAudioId = selection.audioId;
	const selectedVideoOvId = selection.videoOverlayId;
	const selectedEffectId = selection.effectId;
	const selectedTransition = selection.transitionId;
	const selectedFreeIds = selection.freeIds;
	/* One copy per selection, not eight per render.
	 *
	 * The model holds the multi-select as a `ReadonlySet`; eight consumers want a
	 * `Set`, and each of them used to build its own with `new Set(selectedFreeIds)`
	 * inline. Every one of those was a fresh identity on every render, so a memo
	 * boundary anywhere downstream could never hold — it would read as protection
	 * and provide nothing. Keyed on the model's set, so the identity survives
	 * exactly as long as the selection does. */
	const selectedFreeIdSet = useMemo(() => new Set(selectedFreeIds), [selectedFreeIds]);
	const selectedSceneId = selection.sceneId;
	const editorSceneId = selection.editorSceneId;
	// Selected transition clip id — click selects, double-click opens the edit popover.

	// Effect clip edit popover (type / duration / intensity).
	// Controls/inspector drawer opens only on demand (Controls button), not on
	// single click — clip-first click = select + preview only.
	const [, setInspectorOpen] = useChromeField(chromeStore, "inspectorOpen");
	// Docked clip panel (top-right): persistent inspector with an icon category
	// rail. `clipTab` is the active category key; it falls back to the kind's
	// first category when the selection changes to a kind that lacks it.
	const [clipTab, setClipTab] = useChromeField(chromeStore, "clipTab");
	useAnimationInspector({ store, selectionStore, chromeStore, phone });
	// Multi-select of free clips (ids like "video:3"). The single selected*Id states
	// remain the "primary" that Edit/Controls/preview act on; this Set drives bulk
	// move + delete.

	// Edit Timeline Item modal (double-click a clip) + per-scene frame history.
	const [editTarget] = useChromeField(chromeStore, "editTarget");
	// Right-click context menu over a free clip (viewport coords).
	const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
	// Right-click scene menu (base track clip): duplicate/delete live here, not in
	// the main toolbar.
	// Right-click "Add clip" menu over empty lane space: t is the snapped timeline
	// second under the cursor; row -1 = base scene reel, else the free-track index.
	const [, setAspectOpen] = useChromeField(chromeStore, "aspectOpen");
	// Inline text editing: the overlay id whose content is being typed on-canvas.
	// Transition edge popup: the LEFT scene id whose outgoing transition is edited.

	const sceneTotal = scenes.reduce((sum, s) => sum + Math.max(1, s.dur), 0);
	const total = Math.max(sceneTotal, previewDuration);

	// Pacing insights and the beat grid are self-contained; they read the derived
	// arrays and own their own toggles.
	const { insightsOn, setInsightsOn, buildPacingInputs, pacing } = usePacingInsights({
		scenes,
		overlays,
		videoOverlays,
		audioOverlays,
		effects,
		total,
		captionWords: (previewStoryboard.voiceover?.words ?? []).map((w) => ({
			startSec: w.startSec,
			endSec: w.endSec,
		})),
	});
	const { musicClip, beatGridOn, setBeatGridOn, timelineBeats } = useBeatGrid(audioOverlays, total);

	useEffect(() => {
		if (!scenes.find((s) => s.id === previewSceneId)) setPreviewSceneId(scenes[0]?.id);
		if (editorSceneId != null && !scenes.find((s) => s.id === editorSceneId))
			setSelection((prev) => ({ ...prev, editorSceneId: undefined }));
	}, [scenes, previewSceneId, editorSceneId]);

	const active = scenes.find((s) => s.id === previewSceneId) ?? scenes[0];
	const editorScene = scenes.find((s) => s.id === editorSceneId);
	const { currentAspect, aspectOptions, setAspectRatio } = useAspectRatio({
		settings,
		setSettings,
		config,
		setConfig,
		setAspectOpen,
		setElementSources: creative.setElementSources,
	});

	const { sceneStart, sceneAt } = useSceneTiming(scenes);

	/* The preview scene follows the playhead. A subscription rather than an
	 * effect keyed on a rendered time: it only ever writes chrome state, and the
	 * write already bails when the scene is unchanged, so the render this used to
	 * cost bought nothing. */
	usePlayheadEffect(playhead, (sec) => {
		const s = sceneAt(sec);
		if (s && s.id !== previewSceneId) setPreviewSceneId(s.id);
	});

	const { allImageRefs, refsFor, globalStyleRef, visualPromptFor, characterDesc } = useSceneRefs({
		pool,
		projectReferences,
		settings,
	});

	// Drag-and-drop: a media URL dropped from All Media / Stock becomes a scene's
	// frame (replaces the primary visual clip so it survives normalize).
	const { setSceneVisual, addVisualClip, removeVisualClip, extendVisualClipDur } = useVisualClipOps(
		setScenes,
		ensureMediaAsset,
	);
	// Full drag payload from All Media / Stock: url + media kind, plus the asset's
	// natural duration and label when the source knows them (audio placement).

	const { addSceneAt, dupScene, rmScene, reorder, upd, addSceneWithMedia } = useSceneOps({
		scenes,
		setScenes,
		setPreviewSceneId,
		setEditorSceneId: selectionSlot("editorSceneId"),
		editorSceneId,
		firstCastId: refs.speakers[0]?.id,
	});

	const canvasRef = useRef<HTMLDivElement | null>(null);
	// Ref callback for fixed-position context menus: after mount, nudge the menu
	// back inside the viewport so no option can render off-screen.
	const clampMenuToViewport = useClampMenu();
	/* The hover cursor, the drop ghost, the scrub handlers and the marquee used to
	 * live here. They are per-gesture state that only the timeline reads, so they
	 * moved into `timeline-tracks.tsx` with the region that draws them.
	 *
	 * What stays is the span cache they consult: the editor derives the selection,
	 * so it fills this, and the tracks read it to decide whether a scrub clears
	 * the selection. */
	const selectionSpansRef = useRef<{ start: number; end: number }[]>([]);

	const { updateOverlay, removeOverlay, selectedOverlay } = useTextOverlayOps({
		overlays,
		setOverlays,
		selectedOverlayId,
		clearSelection: () => setSelection(clearSelectionIn()),
	});

	// ── Free-form audio clips (voiceover + music), decoupled from scenes ──
	const {
		addAudio,
		updateAudio,
		regenAudio,
		removeAudio,
		selectedAudio,
		ttsBusy,
		ttsStatus,
		ttsVoiceOptions,
	} = useAudioOps({
		projectId,
		audioOverlays,
		setAudioOverlays,
		selectedAudioId,
		setSelectedAudioId: selectionSlot("audioId"),
		setEditorSceneId: selectionSlot("editorSceneId"),
		setSelectedOverlayId: selectionSlot("overlayId"),
		playhead,
		total,
		settings,
		setGenErr,
		setVideoOverlays,
		setOverlays,
		setEffects,
		setScenes,
		sceneStart,
		ensureMediaAsset,
	});

	// ── B-roll / overlay video clips (second video track, free-form) ──
	const { addVideoOverlay, updateVideoOverlay, removeVideoOverlay, selectedVideoOverlay } =
		useVideoOverlayOps({
			videoOverlays,
			setVideoOverlays,
			mediaAssets: library.mediaAssets,
			selectedVideoOvId,
			setSelectedVideoOvId: selectionSlot("videoOverlayId"),
			playhead,
			total,
			setEditorSceneId: selectionSlot("editorSceneId"),
			setSelectedOverlayId: selectionSlot("overlayId"),
			setSelectedAudioId: selectionSlot("audioId"),
		});

	// Scene frame generation (AI image gen + image-to-video) lives in its own hook;
	// the ref/prompt derivation closures above are injected so it stays self-contained.
	const { gen, genEnd, animateBusy, genFrame, animateScene } = useSceneGeneration({
		projectId,
		scenes,
		setScenes,
		setGenErr,
		upd,
		settings,
		config,
		refs,
		sceneStart,
		addVideoOverlay,
		visualPromptFor,
		refsFor,
		characterDesc,
		globalStyleRef,
		ensureMediaAsset,
	});

	/* The canvas's half of selection: which clip the bounding box edits and how
	 * to write its layout (see use-canvas-selection.ts). The hit boxes that let a
	 * clip be picked on the preview used to come from here too; they follow the
	 * playhead, so they are derived in the stage that draws them. */
	const { setSceneLayout, selectedScene, selectedClip, selectedClipLocked } = useCanvasSelection({
		scenes,
		mutateDoc,
		selectedSceneId,
		selectedOverlay,
		selectedAudio,
		selectedVideoOverlay,
		trackLocked,
	});

	// Effects: add at the playhead. Remotion Player previews the active effect from
	// the same storyboard object used by export.
	const { addEffect, removeEffect, addAutoInterrupts } = useEffectOps({
		mutateDoc,
		playhead,
		total,
	});

	const { saveHookVariant, applyHookVariant, removeHookVariant } = useHookVariants({
		scenes,
		setScenes,
		setHookVariants,
		seekPreview,
	});

	// Transition preview: near a scene boundary with a non-cut transition, fade the
	// incoming scene in over the outgoing one so the transition is visible on play
	// (the export uses Remotion's TransitionSeries for the same boundary).
	// Standalone transition helpers: a transition is its own clip keyed by the two
	// adjacent scene ids it joins.
	const { transAt, upsertTransition, updateTransition, removeTransition } = useTransitionOps(
		transitions,
		mutateDoc,
	);

	/* What the canvas paints — the scene under the playhead and, inside a
	 * multi-image beat, the visual clip live at it — is derived in the STAGE
	 * (`preview-frame.ts`), not here. It changes with time, and deriving it in
	 * the editor's root is what made the editor re-render at frame rate: the
	 * value is read by one subtree, so that subtree subscribes. */

	return {
		settings,
		hookVariants,
		ensureMediaAsset,
		mediaAssets,
		imports,
		derived,
		setScenes,
		setOverlays,
		setAudioOverlays,
		setVideoOverlays,
		setEffects,
		scenes,
		overlays,
		audioOverlays,
		videoOverlays,
		effects,
		transitions,
		projectReferences,
		captions,
		setCaptions,
		chromeStore,
		setRail,
		panelOpen,
		setPanelOpen,
		phone,
		setPreviewSceneId,
		lockedMediaAssetIds,
		deleteRef,
		stageRef,
		trackRef,
		pxPerSec,
		zoomPercent,
		setZoomPercent,
		zoomIn,
		zoomOut,
		canZoomIn,
		canZoomOut,
		fitToWidth,
		paneSizing,
		toggleTrackFlag,
		trackLocked,
		genErr,
		setGenErr,
		drag,
		aspect,
		previewFps,
		previewDims,
		previewStoryboard,
		previewProps,
		previewForDoc,
		brandPalette,
		previewFrames,
		previewMedia,
		playhead,
		playing,
		stalled,
		seekPreview,
		togglePlay,
		playerRef,
		stepRate,
		selection,
		setSelection,
		selectionSlot,
		selectedOverlayId,
		selectedAudioId,
		selectedVideoOvId,
		selectedEffectId,
		selectedTransition,
		selectedFreeIds,
		selectedFreeIdSet,
		selectedSceneId,
		editorSceneId,
		setInspectorOpen,
		clipTab,
		setClipTab,
		editTarget,
		ctxMenu,
		setCtxMenu,
		total,
		insightsOn,
		setInsightsOn,
		buildPacingInputs,
		pacing,
		musicClip,
		beatGridOn,
		setBeatGridOn,
		timelineBeats,
		active,
		editorScene,
		currentAspect,
		aspectOptions,
		setAspectRatio,
		sceneStart,
		sceneAt,
		allImageRefs,
		setSceneVisual,
		addVisualClip,
		removeVisualClip,
		extendVisualClipDur,
		addSceneAt,
		dupScene,
		rmScene,
		reorder,
		upd,
		addSceneWithMedia,
		canvasRef,
		clampMenuToViewport,
		selectionSpansRef,
		updateOverlay,
		removeOverlay,
		selectedOverlay,
		addAudio,
		updateAudio,
		regenAudio,
		removeAudio,
		selectedAudio,
		ttsBusy,
		ttsStatus,
		ttsVoiceOptions,
		addVideoOverlay,
		updateVideoOverlay,
		removeVideoOverlay,
		selectedVideoOverlay,
		gen,
		genEnd,
		animateBusy,
		genFrame,
		animateScene,
		setSceneLayout,
		selectedScene,
		selectedClip,
		selectedClipLocked,
		addEffect,
		removeEffect,
		addAutoInterrupts,
		saveHookVariant,
		applyHookVariant,
		removeHookVariant,
		transAt,
		upsertTransition,
		updateTransition,
		removeTransition,
	};
}

export type TimelineEditorState = ReturnType<typeof useTimelineEditorState>;
