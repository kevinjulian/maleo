/* The timeline editor's selection, clip-edit and keyboard wiring, and the
 * ops/view bags its regions take: the second half of the hooks TimelineEditor
 * composes, reading the first half's values (use-timeline-editor-state.ts). */
import { useDocumentSelector, selectDerivedArrays } from "@stores/timeline-document-store.ts";
import { editCaptions } from "@maleo/shared/editor";
import { useMemo } from "react";
import { buildFreeClips, freeRowCount, clipId } from "@models/timeline/timeline-clips.ts";
import { firstClipUsing } from "@models/timeline/media-usage.ts";
import { useFreeClipActions } from "@hooks/timeline/use-free-clip-actions.ts";
import { deleteModeFor } from "@models/timeline/timeline-toggles.ts";
import { useClipOps } from "@hooks/timeline/use-clip-ops.ts";
import { useKeyboardShortcuts } from "@hooks/timeline/use-keyboard-shortcuts.ts";
import { useOverlayAuthoring } from "@hooks/timeline/use-overlay-authoring.ts";
import { useSelectionActions } from "@hooks/timeline/use-selection-actions.ts";
import { useBaseTrack } from "@hooks/timeline/use-base-track.ts";
import { useClipPosition } from "@hooks/timeline/use-clip-position.ts";
import { useFollowPlayhead } from "@hooks/timeline/use-follow-playhead.ts";
import { asOneStep } from "@stores/as-one-step.ts";
import { useTransitionTarget } from "@hooks/timeline/use-transition-target.ts";

import { type TimelinePanelOps, type TimelinePanelView } from "./timeline-panel-host.tsx";
import { type TimelineTracksOps, type TimelineTracksView } from "./timeline-tracks.tsx";
import { type TimelineStageOps, type TimelineStageView } from "./timeline-stage.tsx";
import type { TimelineEditorProps } from "./timeline-editor.tsx";
import type { TimelineEditorState } from "./use-timeline-editor-state.ts";

export function useTimelineEditorActions(
	{ writers, undoStack, setTrackFlags, chat, store }: TimelineEditorProps,
	{
		hookVariants,
		ensureMediaAsset,
		mediaAssets,
		imports,
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
		chromeStore,
		setRail,
		setPanelOpen,
		setPreviewSceneId,
		lockedMediaAssetIds,
		deleteRef,
		trackRef,
		pxPerSec,
		zoomPercent,
		setZoomPercent,
		zoomIn,
		zoomOut,
		canZoomIn,
		canZoomOut,
		fitToWidth,
		toggleTrackFlag,
		trackLocked,
		drag,
		aspect,
		previewFps,
		previewDims,
		previewStoryboard,
		previewProps,
		previewForDoc,
		brandPalette,
		previewFrames,
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
	}: TimelineEditorState,
) {
	/* Where a clip sits: the write path a drag ends in (see use-clip-position.ts —
	 * the scene case deliberately keeps the array path, because moving one scene
	 * re-sequences the whole run). */
	const setFreeClipPos = useClipPosition({ writers, setScenes });

	/* And the view that tracks the renderer. Live here, exactly as on the studios.
	 *
	 * This carried a comment calling it inert, and the comment was wrong. It was
	 * written from a measurement at 1440x900 where `.tl2-tlmain` reports
	 * `scrollWidth === clientWidth` and `scrollLeft = 200` reads back 0 — read at
	 * the time as proof the kernel windows the content and the element can never
	 * scroll. It is not: the fixture project is three SECONDS long, so even at
	 * maximum zoom its ~720px of content fits a 954px lane area, and an element
	 * with nothing to scroll correctly clamps `scrollLeft` to 0.
	 *
	 * Driven at phone width, where 393px cannot hold it, the same call follows:
	 * `scrollWidth` 745 against `clientWidth` 393, `scrollLeft` running 0 → 15 →
	 * 191 → 352 while the playhead holds ~96px off the right edge, which is this
	 * hook's own padding. Covered in `mobile-editor.spec.ts` rather than beside
	 * the studios' desktop checks, because that is the width where the claim can
	 * fail.
	 *
	 * The lesson is the one worth keeping: "nothing to scroll here" is not
	 * "cannot scroll anywhere", and a surface whose content happens to fit proves
	 * nothing either way. */
	useFollowPlayhead({
		scroller: trackRef.current,
		playhead,
		playing,
		pxPerSec,
		gutterSelector: null,
	});

	/* Memoized, and this one is load-bearing rather than tidy: `freeClips` is the
	 * input every lane's clip list is derived from, so rebuilding it on every
	 * render gives every lane new props and no memo boundary downstream can ever
	 * hold. The same trap as the eight selection Sets — protection that reads as
	 * present and provides nothing. The document's arrays keep their identity
	 * while the document does, so this recomputes exactly when the clips change. */
	const captionClips = useDocumentSelector(store, selectDerivedArrays).captionClips;
	const freeClips = useMemo(
		() => buildFreeClips(videoOverlays, overlays, audioOverlays, effects, captionClips),
		[videoOverlays, overlays, audioOverlays, effects, captionClips],
	);
	const freeRows = Math.max(4, freeRowCount(freeClips));

	/* Placing text and motion: the preset table, the motion-template layouts and
	 * the Motion Studio composition path (see use-overlay-authoring.ts). */
	const { addOverlay, placeComposition, selectionOverlayIds } = useOverlayAuthoring({
		setOverlays,
		setSelection,
		freeClips,
		selectedFreeIds: selectedFreeIdSet,
		playhead,
		total,
		aspect,
	});
	/* The drag and the row bookkeeping that keys on it live in TimelineTracks
	 * now, not here.
	 *
	 * They were the last per-gesture state in the editor's root, and every
	 * pointer-down on a clip wrote it — so a press re-rendered the editor, the
	 * preview and everything else the root is the parent of, and a drag did it
	 * on every pointer move. The timeline is where the gesture happens and where
	 * every one of their outputs is drawn, which is the same argument that moved
	 * the hover cursor and the marquee there. */

	const setSelectedFreeIds = selectionSlot("freeIds");
	const selectedFreeId =
		selectedVideoOvId != null
			? clipId("video", selectedVideoOvId)
			: selectedOverlayId != null
				? clipId("text", selectedOverlayId)
				: selectedAudioId != null
					? clipId("audio", selectedAudioId)
					: selectedFreeIds.size === 1 && [...selectedFreeIds][0]?.startsWith("caption:")
						? [...selectedFreeIds][0]!
						: null;

	/* The selection actions every surface invokes. They share one rule that is
	 * easy to get wrong per call site: selecting seeks the playhead only when the
	 * playhead is outside what was selected (see use-selection-actions.ts). */
	const {
		selectScene,
		selectFreeClip,
		toggleFreeClip,
		clearSelection,
		isClipSelected,
		removeFreeClipById,
		openSceneEditor,
		showInChat,
		jumpToClip,
		toggleSceneRef,
	} = useSelectionActions({
		removeCaption: (id) => writers.apply(editCaptions({ action: "delete", ids: [id] })),
		scenes,
		overlays,
		audioOverlays,
		videoOverlays,
		effects,
		setScenes,
		setSelection,
		setPreviewSceneId,
		setInspectorOpen,
		setRail,
		setPanelOpen,
		sceneStart,
		seekPreview,
		playhead,
		selectedFreeIds: selectedFreeIdSet,
		selectedFreeId,
		chat,
		removeVideoOverlay,
		removeOverlay,
		removeAudio,
		removeEffect,
	});

	/* The base row, plus the two lane menus whose snap magnets are that same
	 * derivation (see use-base-track.ts). */
	const { baseClips, openAddMenu, openSceneMenu, sceneMenu, setSceneMenu, addMenu, setAddMenu } =
		useBaseTrack({
			scenes,
			sceneStart,
			gen,
			freeClips,
			playhead,
			total,
			pxPerSec,
			beatGridOn,
			timelineBeats,
			selectScene,
			setCtxMenu,
		});

	// Keep the scrub guard's span cache in sync with the live selection. A free
	// clip contributes its [start, end]; a selected scene contributes its timeline
	// span. Scrubbing inside any of these keeps the selection (see scrubAndGuard).
	selectionSpansRef.current = [
		...freeClips
			.filter((c) => selectedFreeIds.has(c.id) || c.id === selectedFreeId)
			.map((c) => ({ start: c.start, end: c.start + c.dur })),
		...(selectedScene
			? [
					{
						start: sceneStart(selectedScene.id),
						end: sceneStart(selectedScene.id) + Math.max(1, selectedScene.dur),
					},
				]
			: []),
	];

	// Timeline tracks are derived per-scene: one video clip (frame), one
	// voiceover clip (vo), one music/SFX clip (sfx). Many scenes therefore fill
	// the storyboard across all three tracks.
	// Clip-first timeline: the base scene reel is one special row
	// (sequential, drives the render); every other clip lives in a shared generic
	// track space where rows are layers and any clip can move to any row.
	const { editTargetFor, isLockedClip } = useFreeClipActions({
		removeCaption: (id) => writers.apply(editCaptions({ action: "delete", ids: [id] })),
		freeClips,
		trackLocked,
		removeVideoOverlay,
		removeAudio,
		removeOverlay,
	});

	// NLE clip operations (clipboard, split, ripple/lift delete, z-order, ctx menu)
	// live in their own hook; the parent-owned clip arrays + selection setters are
	// injected. clipboard state stays in the parent (read by the keyboard effect).
	const {
		clipboard,
		selectionIds,
		copySelection,
		transitionAfterSelection,
		pasteClipboard: pasteClipboardOp,
		duplicateSelection: duplicateSelectionOp,
		splitAtPlayhead,
		trimAtPlayhead,
		rippleDeleteSelection: rippleDeleteSelectionOp,
		deleteSelection: deleteSelectionOp,
		reorderSelection: reorderSelectionOp,
		openClipMenu,
	} = useClipOps({
		captionClips: captionClips ?? [],
		playhead,
		total,
		freeRows,
		freeClips,
		videoOverlays,
		overlays,
		audioOverlays,
		effects,
		selectedFreeIds: selectedFreeIdSet,
		selectedFreeId,
		selectedEffectId,
		selectedSceneId,
		setVideoOverlays,
		setOverlays,
		setAudioOverlays,
		setEffects,
		setScenes,
		setPreviewSceneId,
		setSelectedVideoOvId: selectionSlot("videoOverlayId"),
		setSelectedOverlayId: selectionSlot("overlayId"),
		setSelectedAudioId: selectionSlot("audioId"),
		setSelectedEffectId: selectionSlot("effectId"),
		setSelectedTransition: selectionSlot("transitionId"),
		setSelectedFreeIds,
		setEditorSceneId: selectionSlot("editorSceneId"),
		setCtxMenu,
		isLockedClip,
		isClipSelected,
		clearSelection,
		removeFreeClipById,
		updateVideoOverlay,
		updateAudio,
		updateOverlay,
		setFreeClipPos,
		selectFreeClip,
		sceneAt,
		sceneStart,
		trackLocked,
		writers,
		openAnimationPair: (fromClipId, toClipId) =>
			chromeStore.patch("animationInspector", { fromClipId, toClipId }),
	});

	/* Each of these loops over the writers, so each recorded one ledger entry
	 * per clip until the bracket went round it (see as-one-step.ts). */
	/* moveFreeRow and organizeRange are NOT wrapped here. Both trigger row
	 * compaction, which runs in an effect, so a synchronous bracket would close
	 * before compaction wrote and leave its commands in a second undo entry.
	 * use-timeline-rows brackets them across its own effects instead. */
	const pasteClipboard = asOneStep(writers, pasteClipboardOp);
	const duplicateSelection = asOneStep(writers, duplicateSelectionOp);
	const rippleDeleteSelection = asOneStep(writers, rippleDeleteSelectionOp);
	const deleteSelection = asOneStep(writers, deleteSelectionOp);
	/* The one way a Delete is decided — keyboard and toolbar alike — so the two
	 * cannot disagree about whether the gap closes. Read at press time. */
	const deleteByMode = (shift: boolean): void => {
		if (deleteModeFor(chromeStore.get().rippleEditing, shift) === "ripple") rippleDeleteSelection();
		else deleteSelection();
	};
	const reorderSelection = asOneStep(writers, reorderSelectionOp);

	// All NLE keyboard shortcuts (copy/paste/dup, split, play, delete, nudge) are
	// wired in one hook; it consumes the clip-ops handlers above.
	useKeyboardShortcuts({
		importFiles: imports.enqueue,
		editTarget,
		clipboard,
		selectedFreeIds: selectedFreeIdSet,
		selectedFreeId,
		selectedOverlayId,
		selectedAudioId,
		selectedVideoOvId,
		selectedEffectId,
		selectedTransition,
		editorScene,
		freeClips,
		total,
		togglePlay,
		zoomIn,
		zoomOut,
		fitToWidth,
		seekTo: seekPreview,
		stepPlaybackRate: stepRate,
		selectionIds,
		copySelection,
		pasteClipboard,
		duplicateSelection,
		splitAtPlayhead,
		trimAtPlayhead,
		deleteByMode,
		clearSelection,
		removeTransition,
		removeEffect,
		removeOverlay,
		removeAudio,
		removeVideoOverlay,
		rmScene,
		trackLocked,
		isLockedClip,
		setFreeClipPos,
		setSelectedTransition: selectionSlot("transitionId"),
		setSelectedEffectId: selectionSlot("effectId"),
		setCtxMenu,
	});

	/* Which boundary a transition edits, resolved once for both the panel's
	 * preview and its apply button (see use-transition-target.ts — they have to
	 * agree or the preview shows one boundary and the click edits another). */
	const transitionTarget = useTransitionTarget({
		transitions,
		videoOverlays,
		scenes,
		active,
		selectedTransition,
		selectedFreeId,
		baseClips,
		freeClips,
		upd,
		upsertTransition,
		updateTransition,
		setSelection,
	});
	/* What the preview stage needs, in the same two kinds as the timeline's. */
	const stageOps: TimelineStageOps = {
		selectScene,
		selectFreeClip,
		clearSelection,
		setSelection,
		openSceneEditor,
		showInChat,
		setAspectRatio,
		setSceneLayout,
		setSceneVisual,
		upd,
		trackLocked,
		addOverlay,
		updateOverlay,
		addAudio,
		updateAudio,
		regenAudio,
		updateVideoOverlay,
		addEffect,
		removeEffect,
		upsertTransition,
		updateTransition,
		removeTransition,
		addSceneAt,
		dupScene,
		rmScene,
		genFrame,
		animateScene,
		copySelection,
		pasteClipboard,
		duplicateSelection,
		deleteSelection,
		rippleDeleteSelection,
		reorderSelection,
		setCtxMenu,
		setSceneMenu,
		setAddMenu,
		clampMenuToViewport,
	};
	const stageView: TimelineStageView = {
		stalled,
		playhead,
		playerRef,
		previewFps,
		previewDims,
		previewProps,
		previewForDoc,
		previewFrames,
		brandPalette,
		gen,
		animateBusy,
		selectedClip,
		selectedClipLocked,
		selectedScene,
		selectedOverlay,
		selectedAudio,
		selectedVideoOverlay,
		selectedEffectId,
		selectedTransition,
		selectedFreeIds: selectedFreeIdSet,
		selectionIds,
		selectionOverlayIds,
		selection,
		clipboard,
		ttsBusy,
		ttsVoiceOptions,
		ctxMenu,
		sceneMenu,
		addMenu,
		drag,
		seekPreview,
		previewStoryboard,
		aspect,
		currentAspect,
	};

	/* What the timeline needs from the editor, in the same two kinds as the left
	 * panel's: the actions it invokes, and the values the editor derives because
	 * the preview stage reads them too. Everything else — the document, the
	 * chrome, the track flags — it reads from the stores itself. */
	const trackOps: TimelineTracksOps = {
		importFiles: imports.enqueue,
		importReadiness: imports.readiness,
		selectScene,
		selectFreeClip,
		toggleFreeClip,
		isClipSelected,
		clearSelection,
		setSelection,
		openAddMenu,
		openClipMenu,
		openSceneMenu,
		splitAtPlayhead,
		trimAtPlayhead,
		duplicateSelection,
		deleteByMode,
		toggleTrackFlag,
		trackLocked,
		editTargetFor,
		removeVisualClip,
		extendVisualClipDur,
		addVisualClip,
		addSceneWithMedia,
		addVideoOverlay,
		addAudio,
		addOverlay,
		removeEffect,
		ensureMediaAsset,
		mediaAssets,
		placeComposition,
		updateAudio,
		updateVideoOverlay,
		upd,
		reorder,
		sceneAt,
		transAt,
		upsertTransition,
		seekPreview,
		togglePlay,
		setAspectRatio,
		saveHookVariant,
		applyHookVariant,
		removeHookVariant,
		zoomIn,
		zoomOut,
		setZoomPercent,
		setSelectedFreeIds,
		setFreeClipPos,
		sceneStart,
		setTrackFlags,
	};
	const trackView: TimelineTracksView = {
		playhead,
		playing,
		total,
		pxPerSec,
		freeClips,
		freeRows,
		baseClips,
		selectedFreeId,
		selectedFreeIds: selectedFreeIdSet,
		selectedSceneId,
		selectedTransition,
		editorSceneId,
		gen,
		pacing,
		insightsOn,
		setInsightsOn,
		musicClip,
		beatGridOn,
		setBeatGridOn,
		timelineBeats,
		currentAspect,
		aspectOptions,
		hookVariants,
		zoomPercent,
		canZoomIn,
		canZoomOut,
		undoStack,
		selectionSpansRef,
	};

	/* What the left panel needs from the editor, split by kind: the actions a
	 * panel invokes and the values the editor derives. Everything else it reads —
	 * the document, the chrome, the reference library, the creative settings, the
	 * chat session, the templates — it takes as the same group the editor does. */
	const panelOps: TimelinePanelOps = {
		addOverlay,
		updateOverlay,
		placeComposition,
		addEffect: (kind) => addEffect(kind),
		addAutoInterrupts,
		addSceneWithMedia,
		applyTransition: transitionTarget.apply,
		deleteRef,
		jumpToClip,
		selectFreeClip,
		seekPreview,
		// Reveal, not delete: the media panel lists what the document references,
		// so the actionable answer to "get rid of this" is the clip holding it.
		revealMediaAsset: (mediaAssetId) => {
			const ref = firstClipUsing(mediaAssetId, { scenes, videoOverlays, audioOverlays });
			if (ref) jumpToClip(ref);
		},
	};
	const panelView: TimelinePanelView = {
		aspect,
		previewWidth: previewDims.w,
		previewHeight: previewDims.h,
		brandPalette,
		playhead,
		total,
		active,
		allImageRefs,
		lockedMediaAssetIds,
		ttsStatus,
		selectedOverlayId,
		activeTransitionType: transitionTarget.activeTransitionType,
		canApplyTransition: transitionTarget.canApply,
		transitionTargetName: transitionTarget.targetName,
		transitionPreviewFrames: transitionTarget.previewFrames,
		buildPacingInputs,
	};

	return {
		clearSelection,
		toggleSceneRef,
		transitionAfterSelection,
		duplicateSelectionOp,
		splitAtPlayhead,
		trimAtPlayhead,
		deleteSelectionOp,
		stageOps,
		stageView,
		trackOps,
		trackView,
		panelOps,
		panelView,
	};
}
