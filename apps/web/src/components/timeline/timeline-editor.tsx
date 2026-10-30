/* Maleo — Content-First Create · clip-first timeline video editor.
 *
 * Layout (left → right): a global icon rail, a global library/project panel,
 * then the preview stage with the timeline docked beneath it. Editing a single
 * scene happens ONLY in the right-hand scene drawer, opened by double-clicking a
 * video clip. The left side is never scene-scoped — it edits shared assets.
 *
 * Canonical scene fields (src / vo / sfx / dur) drive everything; the timeline's
 * video / voiceover / music clips are derived projections (see normalizeSceneClips). */
import { useEffect } from "react";
import { useCaptionJobs } from "@hooks/editor/use-caption-jobs.ts";
import type { Dispatch, SetStateAction, JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { useEditorSheetBounds } from "@hooks/editor/use-editor-sheet-bounds.ts";
import { TimelinePhoneWorkspace } from "./timeline-phone-workspace.tsx";
import { type TimelineTemplate } from "@maleo/shared";
import type { Config, TrackFlags } from "@maleo/shared";
import { type TimelineDocumentStore } from "@stores/timeline-document-store.ts";
import { useChromeField } from "@stores/editor-chrome-store.ts";
import type { TimelineTemplates } from "@hooks/editor/use-timeline-templates.ts";
import type { UndoStack } from "@hooks/editor/use-command-stack.ts";
import type { ChatSession } from "@hooks/editor/use-chat-session.ts";
import type { CreativeSettings } from "@hooks/editor/use-creative-settings.ts";
import type { ReferenceLibraryState } from "@hooks/editor/use-reference-library.ts";
import type { SelectionStore } from "@stores/selection-store.ts";
import { EditorPaneSeparator } from "./editor-pane-separator.tsx";
import { type EditorPane } from "@hooks/timeline/use-editor-pane-sizing.ts";
import type { DocumentWriters } from "@stores/document-writers.ts";
import { countRender } from "@models/timeline/render-probe.ts";
import type { PlayheadHandle } from "@models/timeline/playhead-handle.ts";
import type { LibraryType } from "@models/core/routing.ts";

import { VuiEditorWorkspace } from "@components/editor-workspace/workspace.tsx";
import { TimelineSceneDrawer } from "./timeline-scene-drawer.tsx";
import { TimelinePanelHost } from "./timeline-panel-host.tsx";
import { TimelineTracks } from "./timeline-tracks.tsx";
import { TimelineStage } from "./timeline-stage.tsx";
import { PreviewClipProvider } from "./media/preview-clip-state.tsx";
import { TimelineClipInspectorSheet, useDockedInspector } from "./timeline-clip-inspector.tsx";
import { TimelineBottomBar } from "./timeline-bottom-bar.tsx";
import { clipGroupOptions, resolveClipSubject } from "./clip-property-groups.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";

import { useTimelineEditorState } from "./use-timeline-editor-state.ts";
import { useTimelineEditorActions } from "./use-timeline-editor-actions.ts";

export interface TimelineEditorProps {
	/** Owned by the editor shell so the script view can seed which scene is
	 *  selected when the operator switches here. Passed rather than read there:
	 *  reading it in the shell would re-render the whole editor on every
	 *  selection change. */
	selectionStore: SelectionStore;
	/** Hands the playhead up to the shell; see `usePreviewComposition`. */
	onPlayheadReady?: (playhead: PlayheadHandle) => void;
	config: Config;
	setConfig: Dispatch<SetStateAction<Config>>;
	/** The workspace's reference material as one value (see
	 *  `use-reference-library.ts`): the pool (library + this project's roster), the
	 *  rest of `refs` (notes, speakers, style), the product catalogue, and the media
	 *  library. Which entities the project LOCKS is not here — that lives on the
	 *  document and is written through the command stack. */
	library: ReferenceLibraryState;
	projectId: string | null;
	onProcessingChange?: (key: string, label: string | null) => void;
	// Canonical clip-first document store (source of truth). The editor reads its
	// per-type views (`scenes`/`overlays`/…) from here via `selectDerivedArrays` (a
	// clip-native store projection) — no legacy read-array props. The `setX` shims
	// below remain the write interface (parent owns undo/command commit).
	store: TimelineDocumentStore;
	/* The document's write interface (see document-writers.ts): the per-type setters
	 * the panels consume plus the raw `doc -> doc` seam. Shared with the container so
	 * both write the same way — every edit becomes a typed, undo-precise command. */
	writers: DocumentWriters;
	undoStack: UndoStack;
	/** Local caption system availability. The alignment counts are derived here
	 *  from the timeline's own voiceover clips, not passed in. */
	/** The project's creative choices as one value (see `use-creative-settings.ts`):
	 *  global settings (aspect, style ref, voice, background fill), creative
	 *  direction, A/B hook takes, retention devices. Owned by the
	 *  container because a preset, a template and a reload all write them together. */
	creative: CreativeSettings;
	/** The workspace's timeline templates: list, in-flight state, and the
	 *  create/update operations. Owned by `use-timeline-templates.ts`. */
	templates: TimelineTemplates;
	onSelectTimelineTemplate: (template: TimelineTemplate) => void;
	onOpenLibrary?: (type: LibraryType, editId?: string) => void;
	// Per-track hide/mute/lock — owned by the parent so it persists + drives export.
	trackFlags: TrackFlags;
	setTrackFlags: Dispatch<SetStateAction<TrackFlags>>;
	/** The chat log and the agent run that writes to it, as one value (see
	 *  `use-chat-session.ts`). CreateContent owns the run loop — one path for the
	 *  brief and every chat command across all content types; the editor reads the
	 *  log and dispatches into it. */
	chat: ChatSession;
}

export function TimelineEditor(props: TimelineEditorProps): JSX.Element {
	const {
		selectionStore,
		config,
		setConfig,
		library,
		projectId,
		onProcessingChange,
		store,
		writers,
		creative,
		templates,
		onSelectTimelineTemplate,
		onOpenLibrary,
		trackFlags,
		chat,
	} = props;
	/* Every commit an interaction produces renders this component, so its tally
	 * is the commit count the render budget is written against (render-probe.ts).
	 * Off unless a harness turned counting on. */
	countRender("editor");
	const captionJobs = useCaptionJobs(projectId, store, writers);
	const editor = useTimelineEditorState(props);
	const {
		imports,
		scenes,
		projectReferences,
		captions,
		setCaptions,
		chromeStore,
		panelOpen,
		phone,
		stageRef,
		trackRef,
		paneSizing,
		genErr,
		setGenErr,
		aspect,
		setSelection,
		selectedEffectId,
		selectedTransition,
		clipTab,
		setClipTab,
		editorScene,
		upd,
		canvasRef,
		selectedOverlay,
		selectedAudio,
		selectedVideoOverlay,
		gen,
		genEnd,
		genFrame,
		selectedScene,
	} = editor;
	const {
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
	} = useTimelineEditorActions(props, editor);
	/* Every desktop tool uses the same workspace resize boundary. */
	const separator = (pane: EditorPane, label: string) =>
		!phone && (pane !== "tools" || panelOpen) ? (
			<EditorPaneSeparator pane={pane} label={label} sizing={paneSizing} />
		) : null;

	/* The same reduction the docked inspector makes — one selection, one
	 * subject. Shared rather than repeated so the phone bar and the desktop
	 * inspector can never disagree about what is selected. */
	const clipSubject = resolveClipSubject({
		videoOverlay: selectedVideoOverlay,
		audio: selectedAudio,
		text: selectedOverlay,
		effectId: selectedEffectId,
		transitionId: selectedTransition,
		scene: selectedScene,
	});

	/* The properties sheet belongs to a selection, so it dies with one. Not
	 * folded into the bar's deselect control: the selection also clears by
	 * scrubbing empty timeline space, and a sheet left open over a cleared
	 * selection shows the empty inspector on top of the timeline that cleared
	 * it. Keyed on the boolean, not on `clipSubject`, which is a fresh object
	 * every render. */
	const hasClipSubject = clipSubject != null;
	/* Publishes the band a bottom sheet may occupy — see
	 * use-editor-sheet-bounds.ts. Phone only; there are no bottom sheets above
	 * the breakpoint. The key re-measures when the bottom slot swaps the tool
	 * rail for the clip bar, which no resize event announces. Declared here
	 * rather than beside the other layout hooks because it needs that answer. */
	useEditorSheetBounds(phone, hasClipSubject ? "clip" : "rail");
	const [bottomSheet, setBottomSheet] = useChromeField(chromeStore, "bottomSheet");
	/* One inspector, two housings: the workspace's inspector slot on desktop, a
	 * bottom sheet on the phone. Not inside the stage — the stage IS the preview
	 * slot, and an inspector there puts its empty state where the video belongs. */
	const inspectorBag = {
		projectId,
		onProcessingChange,
		store,
		writers,
		chromeStore,
		library,
		creative,
		ops: stageOps,
		view: stageView,
	};
	const dockedInspector = useDockedInspector(inspectorBag, phone);
	useEffect(() => {
		/* Only the clip's own sheets. Losing a selection is no reason to close the
		 * tools sheet, which is about the timeline rather than about a clip. */
		if (!hasClipSubject)
			setBottomSheet((s) => (s === "clip-props" || s === "clip-actions" ? "none" : s));
	}, [hasClipSubject, setBottomSheet]);

	const tools = (
		<>
			<TimelineBottomBar
				phone={phone}
				subject={clipSubject}
				groupOptions={clipGroupOptions({
					videoOverlay: selectedVideoOverlay,
					scene: selectedScene,
				})}
				chromeStore={chromeStore}
				clipTab={clipTab}
				setClipTab={setClipTab}
				sheet={bottomSheet}
				onSheet={setBottomSheet}
				onDeselect={clearSelection}
				actions={{
					captions:
						clipSubject?.kind === "audio" ||
						clipSubject?.kind === "broll" ||
						clipSubject?.kind === "scene"
							? () => {
									chromeStore.patch("rail", "captions");
									chromeStore.patch("panelOpen", true);
								}
							: undefined,
					splitAtPlayhead,
					trimAtPlayhead,
					duplicate: duplicateSelectionOp,
					remove: deleteSelectionOp,
					transition: transitionAfterSelection,
				}}
			/>

			{panelOpen && (
				<TimelinePanelHost
					captionJobs={captionJobs}
					selectionStore={selectionStore}
					imports={imports}
					store={store}
					writers={writers}
					chromeStore={chromeStore}
					config={config}
					setConfig={setConfig}
					projectId={projectId}
					library={library}
					creative={creative}
					chat={chat}
					templates={templates}
					onSelectTimelineTemplate={onSelectTimelineTemplate}
					onOpenLibrary={onOpenLibrary}
					captions={captions}
					setCaptions={setCaptions}
					ops={panelOps}
					view={panelView}
				/>
			)}
		</>
	);

	return (
		<PreviewClipProvider media={editor.previewMedia}>
			<div className="tl2">
				{genErr && (
					<div role="alert" className="tl2-err">
						<span style={{ flex: 1 }}>{genErr}</span>
						<IconButton size="xs" onClick={() => setGenErr(null)} title="Dismiss">
							{Ic.x(ICON.sm)}
						</IconButton>
					</div>
				)}

				<TimelinePhoneWorkspace
					phone={phone}
					chromeStore={chromeStore}
					panel={{ store, writers, library, chat, projectId, ops: panelOps, view: panelView }}
				>
					<div className="tl2-body">
						{phone && tools}

						{/* The splitter's height override is desktop-only, along with the
				    splitter. A value dragged on a desktop session would otherwise
				    still apply after a rotation to phone width, sizing the timeline
				    from a layout that no longer exists — and there would be no
				    control on screen to correct it with. */}
						<VuiEditorWorkspace
							contractVersion={1}
							mode="embedded"
							label="Content timeline editor"
							className="tl2-stage tl2-content-vui-shell"
							rootRef={stageRef}
							/* Desktop only: at phone width the docked column has nowhere to go
					   beside a preview, and the same inspector becomes the sheet below. */
							inspector={
								!phone && dockedInspector ? (
									<>
										{dockedInspector}
										{separator("inspector", "Resize preview and inspector")}
									</>
								) : undefined
							}
							tools={
								!phone ? (
									<>
										<div className="tl2-tools">{tools}</div>
										{separator("tools", "Resize tools and preview")}
									</>
								) : undefined
							}
							style={paneSizing.style}
							preview={
								<>
									<TimelineStage
										store={store}
										writers={writers}
										chromeStore={chromeStore}
										library={library}
										creative={creative}
										projectId={projectId}
										trackFlags={trackFlags}
										canvasRef={canvasRef}
										ops={stageOps}
										view={stageView}
									/>
								</>
							}
							timeline={
								<>
									{separator("timeline", "Resize upper panels and timeline")}
									<TimelineTracks
										store={store}
										chromeStore={chromeStore}
										trackFlags={trackFlags}
										trackRef={trackRef}
										writers={writers}
										selection={selectionStore}
										ops={trackOps}
										view={trackView}
									/>
								</>
							}
						/>

						{phone && <TimelineClipInspectorSheet {...inspectorBag} />}

						{editorScene && (
							<TimelineSceneDrawer
								scene={editorScene}
								index={scenes.findIndex((s) => s.id === editorScene.id)}
								aspect={aspect}
								library={library}
								projectReferences={projectReferences}
								projectId={projectId}
								genBusy={Boolean(gen[editorScene.id])}
								genEndBusy={Boolean(genEnd[editorScene.id])}
								onClose={() => setSelection((prev) => ({ ...prev, editorSceneId: undefined }))}
								onGenerate={(slot) => genFrame(editorScene.id, slot)}
								onClearEnd={() => upd(editorScene.id, "endSrc", undefined)}
								onUpd={upd}
								onToggleRef={(cat, id) => toggleSceneRef(editorScene.id, cat, id)}
							/>
						)}
					</div>
				</TimelinePhoneWorkspace>
			</div>
		</PreviewClipProvider>
	);
}
