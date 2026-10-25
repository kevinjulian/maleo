/* The docked clip inspector: the category rail, the header, and the property
 * body for whichever clip is selected.
 *
 * Its own file, and its own region, for two reasons. It lived inside
 * timeline-stage.tsx as an IIFE in the middle of the stage's JSX, which put it
 * inside the workspace's PREVIEW slot -- so the "Inspector ready" empty state
 * rendered in the region that exists to show the video. The workspace has an
 * inspector slot; this is what goes in it.
 *
 * The second reason is size. As part of the stage it was 295 lines of an
 * 886-line file, over the repo's ceiling, and the two have little to do with
 * each other: one paints the composition, the other edits one clip's fields.
 *
 * It renders the inspector's CONTENT, not its housing. Desktop puts it in the
 * workspace's inspector slot and the phone puts it in a bottom sheet, and both
 * housings live in timeline-editor.tsx -- one inspector, two housings, so a
 * change to it cannot land on one surface and miss the other.
 */
import type { JSX } from "react";
import { Sheet } from "@design-system/components/sheet.tsx";
import { PanelHeader } from "@design-system/patterns/panel-header.tsx";
import { Tooltip } from "@design-system/components/tooltip.tsx";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { usePhoneLayout } from "@hooks/editor/use-phone-layout.ts";
import { EditTimelineItemModalHost } from "./edit-item-modal.tsx";
import {
	clipGroupOptions,
	clipPropertyGroups,
	activeClipPropertyGroup,
	resolveClipSubject,
	type ClipPropertyGroupKey,
} from "./clip-property-groups.tsx";
import { EMPTY_PROJECT_SELECTION, normalizeSceneClips } from "@maleo/shared";
import { inspectorSubjectLabel } from "@models/timeline/timeline-editor-model.ts";
import { VIDEO_ASPECTS } from "@models/timeline/timeline-editor-model.ts";
import { recordSettingsEdits } from "@models/presets/element-writes.ts";
import { SETTINGS_ELEMENT_PATHS } from "@models/presets/element-paths.ts";
import {
	useChromeField,
	useChromeSetter,
	type EditorChromeStore,
} from "@stores/editor-chrome-store.ts";
import {
	selectDerivedArrays,
	useDocumentSelector,
	type TimelineDocumentStore,
} from "@stores/timeline-document-store.ts";
import type { DocumentWriters } from "@stores/document-writers.ts";
import type { ReferenceLibraryState } from "@hooks/editor/use-reference-library.ts";
import type { CreativeSettings } from "@hooks/editor/use-creative-settings.ts";
import { Button } from "@design-system/components/button.tsx";
import { Select, onSelect } from "@design-system/components/select.tsx";
import type { TimelineStageOps, TimelineStageView } from "./timeline-stage.tsx";
import { Note } from "@design-system/components/note.tsx";
import { Input } from "@design-system/components/input.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";
import { InspectorSection, PropertyRow } from "@design-system/patterns/inspector.tsx";
import { ClipCompositingControl, type CompositingPart } from "./clip-compositing-control.tsx";
import { KeyGesture, KeyingError, useClipKeying } from "./keyed-property-row.tsx";
import { clipIdForTarget, type ClipAnimationTarget } from "@models/timeline/clip-animation-edit.ts";

import { ClipAnimationInspector } from "./clip-animation-inspector.tsx";
import { KeyframeCurveInspector } from "./keyframe-curve-inspector.tsx";
import type { ClipBodyContext } from "./clip-body-context.ts";
import { sceneClipBody } from "./scene-clip-body.tsx";
import { audioClipBody, brollClipBody, textClipBody } from "./overlay-clip-body.tsx";
import { effectClipBody } from "./effect-clip-body.tsx";

/** Groups that edit what the canvas draws; a locked track freezes them all. */
const LOCKABLE_GROUPS: ReadonlySet<string> = new Set([
	"transform",
	"blending",
	"masks",
	"adjust",
	"animation",
]);

/* The same two bags the stage takes. Deliberately not a narrower bespoke set:
 * the inspector edits every clip kind, so the narrow version would be most of
 * both bags restated, and would drift from them. */
export interface TimelineClipInspectorProps {
	projectId: string | null;
	onProcessingChange?: (key: string, label: string | null) => void;
	store: TimelineDocumentStore;
	writers: DocumentWriters;
	chromeStore: EditorChromeStore;
	library: ReferenceLibraryState;
	creative: CreativeSettings;
	ops: TimelineStageOps;
	view: TimelineStageView;
}

/* Desktop inspector stays beside every tool; phones use the existing sheet. */
export function useDockedInspector(
	props: TimelineClipInspectorProps,
	phone: boolean,
): JSX.Element | undefined {
	return phone ? undefined : <TimelineClipInspector {...props} />;
}

export function TimelineClipInspector({
	projectId,
	onProcessingChange,
	store,
	writers,
	chromeStore,
	library,
	creative,
	ops,
	view,
}: TimelineClipInspectorProps): JSX.Element {
	const compositing = (
		target: { source: "scene" | "video"; id: number },
		parts: readonly CompositingPart[],
	) => (
		<ClipCompositingControl
			target={target}
			parts={parts}
			store={store}
			writers={writers}
			chromeStore={chromeStore}
		/>
	);
	const blendMode = (target: { source: "scene" | "video"; id: number }) => (
		<ClipCompositingControl
			target={target}
			parts={["blend"]}
			inline
			store={store}
			writers={writers}
			chromeStore={chromeStore}
		/>
	);
	const {
		clearSelection,
		showInChat,
		setSceneVisual,
		upd,
		updateOverlay,
		updateAudio,
		regenAudio,
		updateVideoOverlay,
		genFrame,
		animateScene,
	} = ops;
	const {
		playhead,
		previewFps,
		previewDims,
		previewProps,
		previewFrames,
		brandPalette,
		gen,
		animateBusy,
		selectedScene,
		selectedOverlay,
		selectedAudio,
		selectedVideoOverlay,
		selectedEffectId,
		selectedTransition,
		selectedFreeIds,
		selectionOverlayIds,
		ttsBusy,
		ttsVoiceOptions,
		aspect,
	} = view;
	const totalSec = previewFrames / previewFps;
	const derived = useDocumentSelector(store, selectDerivedArrays);
	/* A scene's canvas edits land on its visual once the visual carries its own layout
	   (the engine's `canvas_edit`), so the rows read that same resolved layout. */
	const liveDoc = useDocumentSelector(store, (value) => value.getDoc());
	const scenes = derived.scenes;
	const overlays = derived.textOverlays;
	const audioOverlays = derived.audioOverlays;
	const videoOverlays = derived.videoOverlays;
	const effects = derived.effects;
	const transitions = derived.transitions;
	const { refs, pool } = library;
	const projectReferences = derived.projectReferences ?? EMPTY_PROJECT_SELECTION;
	const { settings, setSettings } = creative;
	const [animationRequest] = useChromeField(chromeStore, "animationInspector");
	const [clipTab, setClipTab] = useChromeField(chromeStore, "clipTab");
	const [, setBottomSheet] = useChromeField(chromeStore, "bottomSheet");
	const [, setMaterialsOpen] = useChromeField(chromeStore, "materialsOpen");
	const [, setMaterialsGroup] = useChromeField(chromeStore, "materialsGroup");
	const phone = usePhoneLayout();
	/* The selected clip's key controls: every Transform row keys itself. */
	const [keyVisual] = useChromeField(chromeStore, "clipKeyVisual");
	const sceneVisualId =
		selectedScene &&
		(keyVisual?.sceneId === selectedScene.id
			? keyVisual.visualId
			: normalizeSceneClips(selectedScene).visualClips?.[0]?.id);
	const keyTarget: ClipAnimationTarget | undefined = selectedOverlay
		? { source: "text", id: selectedOverlay.id }
		: selectedVideoOverlay
			? { source: "video", id: selectedVideoOverlay.id }
			: selectedAudio
				? { source: "audio", id: selectedAudio.id }
				: selectedScene && sceneVisualId
					? { source: "scene", id: selectedScene.id, visualId: sceneVisualId }
					: undefined;
	const {
		keying,
		rowKeying,
		error: keyError,
	} = useClipKeying({ target: keyTarget, store, writers, playhead, fps: previewFps });
	const transform = (section: JSX.Element) => (
		<KeyGesture writers={writers}>
			{section}
			<KeyingError error={keyError} />
		</KeyGesture>
	);
	/* Written from here, drawn elsewhere: the empty state offers a way into the
	 * media and chat rails, so it takes setters and subscribes to nothing. */
	const setRail = useChromeSetter(chromeStore, "rail");
	const setPanelOpen = useChromeSetter(chromeStore, "panelOpen");
	/* Regenerating a scene image reads Visual materials, so the drawer is opened on
	 * that group as the action fires. The requirement is that the materials used
	 * are REACHABLE before or during the regeneration — an operator who does not
	 * like the result should not have to go looking for what produced it.
	 *
	 * The drawer itself is mounted by the stage. Both surfaces reach it through
	 * the chrome store rather than through each other, which is why this can open
	 * a drawer it does not render. */
	const regenScene = (id: number): void => {
		setMaterialsGroup("visual");
		setMaterialsOpen(true);
		genFrame(id);
	};

	const clipSel = resolveClipSubject({
		videoOverlay: selectedVideoOverlay,
		audio: selectedAudio,
		text: selectedOverlay,
		effectId: selectedEffectId,
		transitionId: selectedTransition,
		scene: selectedScene,
	});
	/* The rail and the phone contextual bar read one list — see
		   clip-property-groups.tsx. It used to be computed here, inside this
		   closure, which is exactly why the bar could not reach it. */
	const cats = clipPropertyGroups(
		clipSel?.kind,
		clipGroupOptions({ videoOverlay: selectedVideoOverlay, scene: selectedScene }),
	);
	const tab: ClipPropertyGroupKey = activeClipPropertyGroup(cats, clipTab);
	const subjectLabel = inspectorSubjectLabel({
		kind: clipSel?.kind,
		title: clipSel?.title,
		selectedCount: selectedFreeIds.size > 1 ? selectedFreeIds.size : undefined,
	});
	const inspectorChatRef = selectedScene
		? { type: "scene" as const, id: selectedScene.id }
		: selectedVideoOverlay
			? { type: "broll" as const, id: selectedVideoOverlay.id }
			: selectedAudio
				? { type: "audio" as const, id: selectedAudio.id }
				: selectedOverlay
					? { type: "text" as const, id: selectedOverlay.id }
					: undefined;
	const editHost = (target: {
		type: "scene" | "broll" | "audio" | "text";
		id: number;
	}): JSX.Element => (
		<EditTimelineItemModalHost
			target={target}
			embedded
			playhead={playhead}
			keying={target.type === "text" ? rowKeying : undefined}
			selectionOverlayIds={selectionOverlayIds}
			scenes={scenes}
			videoOverlays={videoOverlays}
			audioOverlays={audioOverlays}
			overlays={overlays}
			refs={refs}
			pool={pool}
			projectReferences={projectReferences}
			aspect={aspect}
			renderPreview={{
				storyboard: previewProps,
				width: previewDims.w,
				height: previewDims.h,
				fps: previewFps,
			}}
			settings={settings}
			brand={brandPalette}
			voices={refs.speakers.map((c) => c.name)}
			ttsVoices={ttsVoiceOptions}
			gen={gen}
			onClose={clearSelection}
			onUpdScene={upd}
			onRegenScene={regenScene}
			onSetSceneVisual={setSceneVisual}
			onUpdAudio={updateAudio}
			onUpdOverlay={updateOverlay}
			onUpdVideoOverlay={updateVideoOverlay}
			onRegenAudio={regenAudio}
			ttsBusy={ttsBusy}
			onAnimateScene={animateScene}
			animateBusy={animateBusy}
			onShowInChat={showInChat}
		/>
	);
	const ctx: ClipBodyContext = {
		projectId,
		onProcessingChange,
		store,
		writers,
		chromeStore,
		library,
		creative,
		ops,
		view,
		tab,
		liveDoc,
		keying,
		rowKeying,
		keyError,
		totalSec,
		transform,
		compositing,
		blendMode,
		editHost,
	};
	// Each category renders a stack of accordion subcategories (see the
	// prop→category map). Editors are reused from the flat popovers.
	const body = (): JSX.Element | null => {
		if (
			(LOCKABLE_GROUPS.has(tab) || (clipSel?.kind === "shape" && tab === "timing")) &&
			view.selectedClipLocked
		)
			return <Note>Track locked. Unlock the track to edit this clip.</Note>;
		if (!clipSel) return null;
		if (tab === "animation") {
			if (!keyTarget) return <Note>Add an image or video to animate this clip.</Note>;
			const clipId = clipIdForTarget(liveDoc, keyTarget);
			const request =
				animationRequest &&
				("clipId" in animationRequest ? animationRequest.clipId : animationRequest.fromClipId) ===
					clipId
					? animationRequest
					: { clipId, edge: "in" as const };
			return (
				<ClipAnimationInspector
					key={clipId}
					request={request}
					store={store}
					writers={writers}
					ops={ops}
					view={view}
				/>
			);
		}
		if (clipSel.kind === "scene" && selectedScene) return sceneClipBody(ctx, selectedScene);
		if ((clipSel.kind === "text" || clipSel.kind === "shape") && selectedOverlay)
			return textClipBody(ctx, clipSel.kind, selectedOverlay);
		if (clipSel.kind === "broll" && selectedVideoOverlay)
			return brollClipBody(ctx, selectedVideoOverlay);
		if (clipSel.kind === "audio" && selectedAudio) return audioClipBody(ctx, selectedAudio);
		if (clipSel.kind === "effect" && selectedEffectId != null) {
			const fx = effects.find((x) => x.id === selectedEffectId);
			if (!fx) return null;
			return effectClipBody(ctx, fx);
		}
		if (clipSel.kind === "transition" && selectedTransition != null) {
			const tr = transitions.find((t) => t.id === selectedTransition);
			return tr ? (
				<ClipAnimationInspector
					key={tr.id}
					request={{ fromClipId: tr.fromClipId, toClipId: tr.toClipId }}
					store={store}
					writers={writers}
					ops={ops}
					view={view}
				/>
			) : null;
		}
		return null;
	};
	/* One inspector, two housings. The rail and the content are the same
		   tree either way; only what wraps them differs, so a change to the
		   inspector cannot land on one surface and miss the other. */
	const panelInner = (
		/* The class both housings hang their rules on. The panel is no longer an
		   element of either one — the desktop housing is the workspace's inspector
		   slot and the phone's is a bottom sheet — so the name travels with the
		   content rather than with whatever wraps it. */
		<div className="tl2-clippanel">
			<div className="tl2-clip-rail">
				{cats.map((c) => (
					<Tooltip key={c.k} side="right" label={c.label}>
						<button
							className={`tl2-clip-railbtn ${tab === c.k ? "on" : ""}`}
							aria-label={c.label}
							onClick={() => {
								chromeStore.patch("animationInspector", null);
								setClipTab(c.k);
							}}
						>
							{c.icon(17)}
						</button>
					</Tooltip>
				))}
			</div>
			<div className="tl2-clip-content">
				{/* Close only in the sheet. The docked desktop panel is always present
					    and has nothing to close, so a close control there would be an
					    exit from a pane that never goes away. In the sheet it is the one
					    explicit way out besides tapping the scrim. */}
				<PanelHeader
					density="compact"
					className="tl2-clip-head"
					title={
						tab === "animation" && animationRequest && "fromClipId" in animationRequest
							? "Transition"
							: clipSel
								? subjectLabel
								: "Canvas"
					}
					sub={
						clipSel
							? `${cats.find((cat) => cat.k === tab)?.label ?? "Properties"} properties`
							: "Project settings"
					}
					actions={
						clipSel ? (
							<IconButton
								size="xs"
								title="Show selected clip in chat"
								onClick={() => showInChat(subjectLabel, inspectorChatRef)}
							>
								{Ic.chat(ICON.sm)}
							</IconButton>
						) : undefined
					}
					onClose={phone ? () => setBottomSheet("none") : undefined}
				/>
				<div className="tl2-clip-panel-body">
					{clipSel ? (
						<>
							{body()}
							{tab !== "animation" && (
								<KeyframeCurveInspector
									target={keyTarget}
									store={store}
									chromeStore={chromeStore}
									writers={writers}
								/>
							)}
						</>
					) : (
						<>
							<InspectorSection title="Canvas">
								<PropertyRow label="Aspect ratio">
									<Select
										size="xs"
										value={view.currentAspect}
										onValueChange={onSelect(
											VIDEO_ASPECTS.map((a) => a.id),
											ops.setAspectRatio,
										)}
										aria-label={"Aspect ratio"}
										phoneBreakpoint={860}
										options={[...(VIDEO_ASPECTS.map((a) => ({ value: a.id, label: a.id })) ?? [])]}
									/>
								</PropertyRow>
								<PropertyRow label="Output size" as="div">
									<span>
										{previewDims.w} × {previewDims.h}
									</span>
								</PropertyRow>
								<PropertyRow label="Background">
									<Input
										size="xs"
										value={settings.backgroundFill || previewProps.bgColor || "#000000"}
										onChange={(e) => {
											const next = { ...settings, backgroundFill: e.target.value };
											creative.setElementSources((sources) =>
												recordSettingsEdits(settings, next, SETTINGS_ELEMENT_PATHS, sources),
											);
											setSettings(next);
										}}
									/>
								</PropertyRow>
								<Button
									variant="secondary"
									size="sm"
									onClick={() => {
										setRail("settings");
										setPanelOpen(true);
									}}
								>
									Project settings
								</Button>
							</InspectorSection>
							<InspectorSection title="Editing">
								<Note>Select a clip on canvas or timeline to edit its properties.</Note>
								<Button
									variant="secondary"
									size="sm"
									onClick={() => {
										setRail("media");
										setPanelOpen(true);
									}}
								>
									{Ic.image(ICON.xs)} All Media
								</Button>
								<Button
									variant="secondary"
									size="sm"
									onClick={() => {
										setRail("chat");
										setPanelOpen(true);
									}}
								>
									{Ic.chat(ICON.xs)} Chat
								</Button>
							</InspectorSection>
						</>
					)}
				</div>
			</div>
		</div>
	);

	return panelInner;
}

/* The phone's housing.
 *
 * A sheet rather than a stacked pane: stacked, the docked column and the
 * preview both collapsed and "Inspector ready" ended up where the video
 * belongs. It portals to <body>, so it sits outside the preview region however
 * the workspace composes.
 *
 * It reads its own open state rather than taking it, because everything it
 * needs is already in the bag the inspector takes — which keeps the editor's
 * side of this to one line per housing. */
export function TimelineClipInspectorSheet(props: TimelineClipInspectorProps): JSX.Element {
	const [bottomSheet, setBottomSheet] = useChromeField(props.chromeStore, "bottomSheet");
	const {
		selectedScene,
		selectedOverlay,
		selectedAudio,
		selectedVideoOverlay,
		selectedEffectId,
		selectedTransition,
		selectedFreeIds,
	} = props.view;
	const subject = resolveClipSubject({
		videoOverlay: selectedVideoOverlay,
		audio: selectedAudio,
		text: selectedOverlay,
		effectId: selectedEffectId,
		transitionId: selectedTransition,
		scene: selectedScene,
	});
	const label = inspectorSubjectLabel({
		kind: subject?.kind,
		title: subject?.title,
		selectedCount: selectedFreeIds.size > 1 ? selectedFreeIds.size : undefined,
	});
	return (
		<Sheet
			edge="bottom"
			open={bottomSheet === "clip-props"}
			onClose={() => setBottomSheet("none")}
			/* The band between the transport and the bottom bar — see
			   use-editor-sheet-bounds.ts. Both edges are chrome that has to stay
			   live: the bar names the selection and offers the way out of it, and
			   the transport carries undo and the control that opens the tools
			   sheet. */
			offset="var(--tl2-sheet-bottom, var(--tl2-bottombar-h))"
			headroom="var(--tl2-sheet-top, 0px)"
			label={`${label} properties`}
			className="tl2-clip-sheet"
		>
			<TimelineClipInspector {...props} />
		</Sheet>
	);
}
