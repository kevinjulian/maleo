import { useCallback, useMemo, useRef, useState, type JSX, type ReactNode } from "react";
import {
	DEFAULT_TIMELINE_TEMPLATE,
	DEFAULT_TIMELINE_TEMPLATE_ID,
	type Emotion,
	type TimelineTemplate,
	type TimelineTemplateInput,
} from "@maleo/shared";
import type { RefImage } from "@maleo/shared";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { InspectorSection } from "@design-system/patterns/inspector.tsx";
import { PanelHeader } from "@design-system/patterns/panel-header.tsx";
import { VuiEditorWorkspace } from "@components/editor-workspace/workspace.tsx";
import {
	VuiInspectorRail,
	VuiPreviewStage,
	type VuiInspectorCategory,
} from "@components/editor-workspace/primitives.tsx";
import { VuiKeyboardScope } from "@components/editor-workspace/keyboard-scope.tsx";
import { StudioActionBar } from "./studio-action-bar.tsx";
import { TemplateToolbar } from "./template-toolbar.tsx";
import { StudioHeading } from "./studio-heading.tsx";
import { VuiRemotionPreview } from "./remotion-preview.tsx";
import {
	templateStateOf,
	TEMPLATE_PREVIEW_FPS,
} from "@models/timeline/template-document-adapter.ts";
import {
	buildTimelineTemplateTimelineLanes,
	resizeTimelineTemplateRange,
	timelineTemplatePreviewDuration,
} from "@models/timeline/template-preview-lanes.ts";
import { useTemplateTimeline } from "./template-timeline.tsx";
import { rulerMarks } from "@models/timeline/ruler-ticks.ts";
import { useRemotionPlayhead } from "@hooks/timeline/use-remotion-playhead.ts";
import { useFollowPlayhead } from "@hooks/timeline/use-follow-playhead.ts";
import { useGutterScrollSync } from "@hooks/timeline/use-gutter-scroll-sync.ts";
import { usePhoneLayout } from "@hooks/editor/use-phone-layout.ts";
import { usePlayheadSec } from "@hooks/timeline/use-playhead.ts";
import { useStudioModalActive } from "@models/timeline/studio-modal-active.ts";
import { Button } from "@design-system/components/button.tsx";
import { Note } from "@design-system/components/note.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";
import {
	buildTimelineTemplateRendererProps,
	buildTimelineTemplateSaveInput,
	cancelTimelineTemplateEditor,
	persistTimelineTemplateEditor,
	templateInput,
	timelineTemplateInspectorSection,
	usePreviewSfx,
	type EditorState,
	type TemplateInspectorSection,
} from "./timeline-template-preview.ts";
import { TemplateInspectorSections } from "./timeline-template-sections.tsx";
import { TemplateEditorTimeline } from "./template-editor-timeline.tsx";

export {
	buildTimelineTemplatePreview,
	buildTimelineTemplateRendererProps,
	buildTimelineTemplateSaveInput,
	cancelTimelineTemplateEditor,
	persistTimelineTemplateEditor,
	templateInput,
	timelineTemplateInspectorSection,
	type EditorState,
} from "./timeline-template-preview.ts";

/* The inspector's destinations, in the order they are worked through.
 *
 * The same list the rail draws and the range-to-section mapping resolves into,
 * so a section gained or lost moves in one place rather than two. Icons only:
 * the rail is a column of glyphs beside a titled body, and a caption under each
 * would repeat the heading it sits next to. */
/* Ids typed as the section union, not as plain strings: the rail hands back the
   id it was given, and typing it here is what lets the handler use it without an
   assertion. */
const TEMPLATE_INSPECTOR_CATEGORIES: (VuiInspectorCategory & { id: TemplateInspectorSection })[] = [
	{ id: "identity", label: "Template identity", icon: Ic.edit(ICON.md) },
	{ id: "opening", label: "Opening · section 1", icon: Ic.type(ICON.md) },
	{ id: "entries", label: "Section entries", icon: Ic.bolt(ICON.md) },
	{ id: "scene", label: "Scene behavior", icon: Ic.film(ICON.md) },
	{ id: "music", label: "Background music", icon: Ic.music(ICON.md) },
	{ id: "visual", label: "Visual framework", icon: Ic.image(ICON.md) },
];

/* Exported so the library catalogue can open the same editor its rows describe.
 * The catalogue renders its own rows — a page is not a rail — but the thing that
 * edits a template must be one implementation, or the two surfaces come to
 * disagree about what a template has. */
export function TimelineTemplateEditorModal({
	state,
	refs,
	projectEmotions,
	busy,
	error,
	width,
	height,
	onClose,
	onCreate,
	onUpdate,
}: {
	state: EditorState;
	refs: RefImage[];
	projectEmotions: Emotion[];
	busy: boolean;
	error: string | null;
	width: number;
	height: number;
	onClose: () => void;
	onCreate: (input: TimelineTemplateInput) => Promise<TimelineTemplate>;
	onUpdate: (id: string, input: TimelineTemplateInput) => Promise<TimelineTemplate>;
}): JSX.Element {
	useStudioModalActive();
	/* One answer for the whole editor — see use-phone-layout.ts. Each studio used
	   to declare this query itself, so between 700 and 860 the main editor
	   composed as a phone while the studios composed as desktops, in the same
	   window. Short landscape is covered by the width too: 852 is under the
	   breakpoint. */
	const compact = usePhoneLayout();
	const [draft, setDraft] = useState<TimelineTemplateInput>(() => ({
		...state.initial,
		sceneEntrySfx: state.initial.sceneEntrySfx ?? "",
		introEntrySfxUrl: state.initial.introEntrySfxUrl ?? "",
		sceneEntrySfxUrl: state.initial.sceneEntrySfxUrl ?? "",
		musicCue: state.initial.musicCue ?? DEFAULT_TIMELINE_TEMPLATE.musicCue,
		musicUrl: state.initial.musicUrl ?? "",
		musicVolume: state.initial.musicVolume ?? 1,
		musicPolicy: state.initial.musicPolicy ?? "single",
		musicEmotionCues: state.initial.musicEmotionCues ?? {},
		sentenceVoiceoverPauseSec: state.initial.sentenceVoiceoverPauseSec ?? 0.15,
		sceneVoiceoverPauseSec: state.initial.sceneVoiceoverPauseSec ?? 0.35,
		maxVisualBeatSec: state.initial.maxVisualBeatSec ?? 6,
		maxVoiceoverSegmentSec: state.initial.maxVoiceoverSegmentSec ?? 8,
		staticSceneMovement: state.initial.staticSceneMovement ?? false,
		overrideSceneTransition: state.initial.overrideSceneTransition ?? false,
		sceneTransition: state.initial.sceneTransition ?? "fade",
	}));
	const [localError, setLocalError] = useState<string | null>(null);
	const sectionPreview = usePreviewSfx(draft.introEntrySfx, draft.introEntrySfxUrl);
	const scenePreview = usePreviewSfx(draft.sceneEntrySfx, draft.sceneEntrySfxUrl);
	const musicPreview = usePreviewSfx(draft.musicCue, draft.musicUrl, "music");
	const previewDurationSec = timelineTemplatePreviewDuration(draft);
	const rendererProps = useMemo(
		() =>
			buildTimelineTemplateRendererProps(
				draft,
				width,
				height,
				sectionPreview.audio,
				scenePreview.audio,
				musicPreview.audio,
			),
		[draft, width, height, sectionPreview.audio, scenePreview.audio, musicPreview.audio],
	);
	const durationFrames = rendererProps.durationInFrames;
	const previewKey = `${draft.introTextPreset}:${draft.sectionTextPreset}:${draft.sceneEntrySfx}:${draft.staticSceneMovement}:${draft.overrideSceneTransition}:${draft.sceneTransition}:${draft.introLeadInSec}:${draft.introTitleDurationSec}:${sectionPreview.audio?.url ?? "no-section-audio"}:${scenePreview.audio?.url ?? "no-scene-audio"}:${musicPreview.audio?.url ?? "no-music"}:${draft.musicPolicy}:${draft.musicVolume}:${width}:${height}`;
	/* The ref comes from the hook: it has to observe the player ARRIVING, which a
	   ref created here cannot report. See use-remotion-playhead.ts. */
	const { playhead, playing, seek, togglePlay, playerRef } = useRemotionPlayhead(
		30,
		durationFrames,
		previewKey,
	);
	/* This surface DISPLAYS the time, so it subscribes — see playhead-handle.ts. */
	const playheadSec = usePlayheadSec(playhead);
	const timelineLanes = useMemo(
		() =>
			buildTimelineTemplateTimelineLanes(
				draft,
				sectionPreview.audio,
				scenePreview.audio,
				projectEmotions,
			),
		[draft, sectionPreview.audio, scenePreview.audio, projectEmotions],
	);
	const [selectedRangeId, setSelectedRangeId] = useState<string | null>(null);
	const selectedTimelineLanes = useMemo(
		() =>
			timelineLanes.map((lane) => ({
				...lane,
				ranges: lane.ranges.map((range) => ({ ...range, selected: range.id === selectedRangeId })),
			})),
		[timelineLanes, selectedRangeId],
	);
	/* Where the region starts zoomed. After this the kernel owns the scale — it
	 * is the viewport's single writer — and the panel reads it back. */
	const TEMPLATE_INITIAL_PX_PER_SEC = 68;
	const rangeById = useMemo(
		() =>
			new Map(
				selectedTimelineLanes.flatMap((lane) =>
					lane.ranges.map((range) => [range.id, range] as const),
				),
			),
		[selectedTimelineLanes],
	);
	const [openSection, setOpenSection] = useState<TemplateInspectorSection>("identity");
	const [focusKey, setFocusKey] = useState(0);
	const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
	const focusInspector = (section: TemplateInspectorSection): void => {
		setOpenSection(section);
		setFocusKey((key) => key + 1);
	};
	const selectRange = (rangeId: string): void => {
		setSelectedRangeId(rangeId);
		focusInspector(timelineTemplateInspectorSection(rangeId));
	};
	/* The bar's two states, which are a different question from the rail's.
	 *
	 * With nothing selected the bar is a tool row: the template's own
	 * destinations, all of which are reachable without a selection because they
	 * are settings of the template rather than of a range. With a range selected
	 * it becomes that range's bar — the way out of the selection, what is
	 * selected, and where its properties live.
	 *
	 * That last part is ONE control, and it is a fact about this inspector rather
	 * than a thinner version of Motion Studio's five:
	 * `timelineTemplateInspectorSection` maps every range to exactly one section,
	 * so a selected range has exactly one place its properties are edited.
	 * Whether a template range should expose more than one is a question about
	 * this inspector, and it is not answered here. */
	const selectedRange = selectedRangeId === null ? undefined : rangeById.get(selectedRangeId);
	const barSubject = selectedRange?.label ?? null;
	const barCats =
		selectedRangeId === null
			? TEMPLATE_INSPECTOR_CATEGORIES
			: TEMPLATE_INSPECTOR_CATEGORIES.filter(
					(entry) => entry.id === timelineTemplateInspectorSection(selectedRangeId),
				);

	const updateRangeDuration = (rangeId: string, edge: "start" | "end", sec: number): void => {
		selectRange(rangeId);
		setDraft((value) => resizeTimelineTemplateRange(value, rangeId, edge, sec));
	};
	/* The preview timeline's gestures, on the library. One surface for the region:
	 * every bar is derived from the draft and rebuilt on each inspector keystroke,
	 * so no bar can be allowed to own the pointer that is dragging it. */
	const templateTimeline = useTemplateTimeline({
		state: useMemo(
			() => templateStateOf(selectedTimelineLanes, previewDurationSec, TEMPLATE_INITIAL_PX_PER_SEC),
			[selectedTimelineLanes, previewDurationSec],
		),
		durationSec: previewDurationSec,
		coarsePointer: compact,
		rangeOf: (id) => rangeById.get(id),
		onSelect: selectRange,
		onResize: updateRangeDuration,
	});
	const gutterRef = useRef<HTMLDivElement | null>(null);
	const scrollerRef = useRef<HTMLDivElement | null>(null);
	const gutterTailRef = useRef<HTMLDivElement | null>(null);
	const attachScroller = useCallback(
		(node: HTMLDivElement | null) => {
			scrollerRef.current = node;
			templateTimeline.scrollerRef(node);
		},
		[templateTimeline.scrollerRef],
	);
	useGutterScrollSync(gutterRef, scrollerRef, gutterTailRef, templateTimeline.scroller !== null);
	const gesturingRangeId =
		templateTimeline.gesture?.target.kind === "item" ? templateTimeline.gesture.target.id : null;
	const templatePxPerSec = templateTimeline.pxPerSec;

	/* The view tracks the renderer, same hook as Motion Studio. This scroller
	   overflows natively whenever the template is longer than the region. */
	useFollowPlayhead({
		scroller: templateTimeline.scroller,
		playhead,
		playing,
		pxPerSec: templatePxPerSec,
		gutterSelector: ".vui-timeline-gutter",
		suspended: templateTimeline.gesture !== undefined,
	});
	const ticks = useMemo(
		() =>
			rulerMarks({
				startSec: 0,
				endSec: previewDurationSec,
				totalSec: previewDurationSec,
				pxPerSec: templatePxPerSec,
				fps: TEMPLATE_PREVIEW_FPS,
			}).ticks,
		[previewDurationSec, templatePxPerSec],
	);
	const timelineWidthPx = Math.max(320, previewDurationSec * templatePxPerSec);
	const save = async (): Promise<void> => {
		if (!draft.name.trim()) {
			setLocalError("Template name required.");
			return;
		}
		setLocalError(null);
		try {
			const input = buildTimelineTemplateSaveInput(
				draft,
				sectionPreview.audio,
				scenePreview.audio,
				musicPreview.audio,
			);
			await persistTimelineTemplateEditor(state, input, onCreate, onUpdate, onClose);
		} catch (err) {
			setLocalError(err instanceof Error ? err.message : String(err));
		}
	};
	return (
		<VuiKeyboardScope>
			<VuiEditorWorkspace
				contractVersion={1}
				mode={compact ? "fullscreen" : "modal"}
				label={state.mode === "edit" ? "Edit timeline template" : "Create timeline template"}
				className="tl2-template-editor-modal tl2-template-editor"
				onRequestClose={() => cancelTimelineTemplateEditor(onClose)}
				mobilePanel={{
					open: mobileInspectorOpen,
					title: "Template inspector",
					onRequestClose: () => setMobileInspectorOpen(false),
				}}
				mobileActions={
					compact ? (
						<StudioActionBar
							subject={barSubject}
							categories={barCats}
							activeCategory={openSection}
							onOpenCategory={(id) => {
								const category = TEMPLATE_INSPECTOR_CATEGORIES.find((entry) => entry.id === id);
								if (!category) return;
								focusInspector(category.id);
								setMobileInspectorOpen(true);
							}}
							sheetOpen={mobileInspectorOpen}
							onBack={() => setMobileInspectorOpen(false)}
							onClose={() => cancelTimelineTemplateEditor(onClose)}
							/* Deselecting returns the bar to its tool row, the way the content
					   editor's clip bar returns to the tool rail. */
							onDeselect={() => setSelectedRangeId(null)}
							save={
								<Button
									variant="primary"
									size="sm"
									type="button"
									disabled={busy || !draft.name.trim()}
									onClick={() => void save()}
								>
									{busy ? "Saving…" : state.mode === "edit" ? "Save changes" : "Create template"}
								</Button>
							}
						/>
					) : undefined
				}
				headerProvidesClose={compact}
				header={
					<StudioHeading
						title={state.mode === "edit" ? "Edit timeline template" : "Create timeline template"}
						subtitle="Global framework, previewed through final video renderer"
						compact={compact}
						onBack={() => cancelTimelineTemplateEditor(onClose)}
					/>
				}
				preview={
					<section className="tl2-template-editor-preview" aria-label="Template WYSIWYG preview">
						<VuiPreviewStage className="tl2-studio-stagewrap">
							<div
								className="tl2-studio-stage tl2-template-editor-stage"
								style={{
									aspectRatio: `${width} / ${height}`,
									width: `min(100cqw, calc(100cqh * ${width / height}))`,
								}}
							>
								<VuiRemotionPreview
									playerRef={playerRef}
									key={previewKey}
									{...rendererProps}
									loop
									acknowledgeRemotionLicense
									style={{ width: "100%", height: "100%" }}
								/>
							</div>
						</VuiPreviewStage>
						<div className="tl2-template-editor-cues">
							<span>
								{Ic.bolt(ICON.xs)} Section SFX · {sectionPreview.status}
							</span>
							<span>
								{Ic.bolt(ICON.xs)} Scene SFX · {scenePreview.status}
							</span>
							<span>{draft.introLeadInSec.toFixed(1)}s silence / section</span>
							<span>{draft.maxVisualBeatSec.toFixed(1)}s max visual</span>
							<span>{draft.maxVoiceoverSegmentSec.toFixed(1)}s max VO</span>
							<span>{draft.sentenceVoiceoverPauseSec.toFixed(2)}s sentence breath</span>
							<span>{Math.round(draft.introEntrySfxVolume * 100)}% SFX</span>
						</div>
					</section>
				}
				/* One destination at a time, from the same rail the main editor and
					   Motion Studio use. It was a stack of six accordions, which is a
					   third inspector model across three surfaces that are meant to be
					   one shell — and on a phone it meant scrolling past five closed
					   headings to reach the sixth. */
				inspector={
					<VuiInspectorRail
						className="tl2-template-editor-form"
						categories={TEMPLATE_INSPECTOR_CATEGORIES}
						active={openSection}
						onSelect={(id) => {
							const category = TEMPLATE_INSPECTOR_CATEGORIES.find((entry) => entry.id === id);
							if (category) focusInspector(category.id);
						}}
					>
						<TemplateInspectorSections
							openSection={openSection}
							focusKey={focusKey}
							draft={draft}
							setDraft={setDraft}
							sectionPreview={sectionPreview}
							scenePreview={scenePreview}
							musicPreview={musicPreview}
							projectEmotions={projectEmotions}
							refs={refs}
						/>
						{(localError || error) && (
							<p className="tl2-framework-error" role="alert">
								{localError || error}
							</p>
						)}
					</VuiInspectorRail>
				}
				/* The same strip the main editor draws, through the workspace's own
					   region. The transport moved here from under the preview so the
					   controls for the playhead and the playhead itself are on one
					   surface, and it is centred by grid track rather than by a
					   flexible spacer — which is what stops it sitting at a different
					   offset here than in Motion Studio. */
				timelineToolbar={
					<TemplateToolbar
						compact={compact}
						playing={playing}
						currentSec={playheadSec}
						durationSec={previewDurationSec}
						onTogglePlay={togglePlay}
						onStop={() => seek(0)}
						onCloseInspector={() => setMobileInspectorOpen(false)}
						inspectorOpen={mobileInspectorOpen}
					/>
				}
				timeline={
					<>
						<TemplateEditorTimeline
							lanes={selectedTimelineLanes}
							gutterRef={gutterRef}
							gutterTailRef={gutterTailRef}
							attachScroller={attachScroller}
							timelineWidthPx={timelineWidthPx}
							startSec={templateTimeline.startSec}
							endSec={templateTimeline.endSec}
							templatePxPerSec={templatePxPerSec}
							previewDurationSec={previewDurationSec}
							playheadSec={playheadSec}
							seek={seek}
							ticks={ticks}
							gesturingRangeId={gesturingRangeId}
							selectRange={selectRange}
							updateRangeDuration={updateRangeDuration}
						/>
					</>
				}
				/* Desktop only: at phone width the same two actions live on the bottom
			   bar, and a footer row as well would be the same control twice. */
				footer={
					compact ? undefined : (
						<div className="cv-modal-actions">
							<Button
								variant="secondary"
								size="sm"
								type="button"
								onClick={() => cancelTimelineTemplateEditor(onClose)}
							>
								Cancel
							</Button>
							<Button
								variant="primary"
								size="sm"
								type="button"
								disabled={busy || !draft.name.trim()}
								onClick={() => void save()}
							>
								{busy ? "Saving…" : state.mode === "edit" ? "Save changes" : "Create template"}
							</Button>
						</div>
					)
				}
			/>
		</VuiKeyboardScope>
	);
}

export function TimelineTemplatesPanel({
	templates,
	selectedId,
	refs,
	projectEmotions,
	busy,
	error,
	previewWidth,
	previewHeight,
	onSelect,
	onCreate,
	onUpdate,
	onClose,
	renderOverride,
	selectable = true,
}: {
	templates: TimelineTemplate[];
	selectedId: string;
	refs: RefImage[];
	/** Emotions the current project's plan calls for, newest plan first seen order.
	 *  Empty when there is no plan yet. */
	projectEmotions: Emotion[];
	busy: boolean;
	error: string | null;
	previewWidth: number;
	previewHeight: number;
	onSelect: (template: TimelineTemplate) => void;
	onCreate: (input: TimelineTemplateInput) => Promise<TimelineTemplate>;
	onUpdate: (id: string, input: TimelineTemplateInput) => Promise<TimelineTemplate>;
	onClose: () => void;
	/** Project override controls; absent in the standalone template library. */
	renderOverride?: ReactNode;
	/** False on the library surface, which has no project to select FOR. A row there
	 *  opens the editor instead of offering a choice that would do nothing. */
	selectable?: boolean;
}): JSX.Element {
	const [editor, setEditor] = useState<EditorState | null>(null);
	return (
		<>
			<PanelHeader density="tool" title="Templates" onClose={onClose} closeLabel="Hide panel" />
			<div className="tl2-panel-body tl2-template-library">
				{renderOverride && (
					<InspectorSection title="Render override" collapsible defaultOpen>
						{renderOverride}
					</InspectorSection>
				)}
				<InspectorSection title="Templates" collapsible defaultOpen>
					<Button
						variant="primary"
						size="sm"
						className="tl2-template-create"
						type="button"
						onClick={() =>
							setEditor({
								mode: "create",
								initial: {
									...DEFAULT_TIMELINE_TEMPLATE,
									name: "",
									sceneEntrySfx: "",
									staticSceneMovement: false,
									overrideSceneTransition: false,
									sceneTransition: "fade",
								},
							})
						}
					>
						{Ic.plus(ICON.sm)} Create template
					</Button>
					<div className="tl2-template-list" role="list" aria-label="Global timeline templates">
						{templates.map((template) => {
							const selected =
								selectable && template.id === (selectedId || DEFAULT_TIMELINE_TEMPLATE_ID);
							const open = (): void =>
								setEditor({ mode: "edit", template, initial: templateInput(template) });
							return (
								<div
									key={template.id}
									className={`tl2-template-row ${selected ? "on" : ""}`}
									role="listitem"
								>
									{/* In a project the row picks the template; in the library there is nothing to
							    pick FOR, so it opens the editor rather than offering a dead choice. */}
									<button
										type="button"
										className="tl2-template-select"
										onClick={() => (selectable ? onSelect(template) : open())}
										aria-pressed={selectable ? selected : undefined}
									>
										<span>
											<b>{template.name}</b>
											<small>
												{template.description || template.introTextPreset || "No title"}
											</small>
										</span>
										{selected && (
											<span className="tl2-template-active">{Ic.check(ICON.xs)} Active</span>
										)}
									</button>
									<IconButton
										size="xs"
										type="button"
										title={`Edit ${template.name}`}
										onClick={open}
									>
										{Ic.edit(ICON.sm)}
									</IconButton>
								</div>
							);
						})}
						{templates.length === 0 && <Note>No global templates yet.</Note>}
					</div>
					{error && (
						<p className="tl2-framework-error" role="alert">
							{error}
						</p>
					)}
				</InspectorSection>
			</div>
			{editor && (
				<TimelineTemplateEditorModal
					state={editor}
					refs={refs}
					projectEmotions={projectEmotions}
					busy={busy}
					error={error}
					width={previewWidth}
					height={previewHeight}
					onClose={() => setEditor(null)}
					onCreate={onCreate}
					onUpdate={onUpdate}
				/>
			)}
		</>
	);
}
