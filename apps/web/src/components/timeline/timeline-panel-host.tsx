/* The editor's left panel: whichever rail destination is open.
 *
 * Nine panels behind one `rail` value. They were a 210-line ternary inside
 * `TimelineEditor`, which is why the editor could not be split — the branch read
 * about fifty names from the component body.
 *
 * Most of those fifty now arrive as the groups that already exist: the document
 * store, the document writers, the chrome store, and the four container-owned
 * bundles (reference library, creative settings, chat session, templates). What
 * is left is genuinely the editor's own work, and it comes in two bags: `ops`,
 * the actions a panel invokes, and `view`, the values the editor derives. Both
 * are typed against the panels that consume them, so a child's prop change is a
 * type error here rather than a silent drift.
 */
import type { ComponentProps, Dispatch, JSX, SetStateAction } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { PanelHeader } from "@design-system/patterns/panel-header.tsx";
import { Sheet } from "@design-system/components/sheet.tsx";
import { countRender } from "@models/timeline/render-probe.ts";
import { usePhoneLayout } from "@hooks/editor/use-phone-layout.ts";
import { TimelineChatPanel } from "./timeline-chat-panel.tsx";
import { CaptionTranscriptPanel } from "@components/editor/caption-transcript.tsx";
import type { CaptionJobControls } from "@hooks/editor/use-caption-jobs.ts";
import type { SelectionStore } from "@stores/selection-store.ts";
import { CaptionsPanel } from "@components/editor/editor-captions.tsx";
import { SettingsPanel, StylePanel } from "@components/editor/editor-settings.tsx";
import {
	ReferenceLibrary,
	persistPrimaryEntity,
	persistProjectSelection,
	isProductRef,
} from "@components/editor/references.tsx";
import { AllMediaPanel } from "@components/timeline/media/media-browser.tsx";
import { StockPanel } from "@components/timeline/media/stock-browser.tsx";
import { ElementsPanel } from "./elements-panel.tsx";
import { TimelineTemplatesPanel } from "./timeline-template-panel.tsx";
import { planEmotions } from "@models/chat/plan-emotions.ts";
import { TransitionsPanel, EffectsPanel } from "./timeline-editor-panels.tsx";
import { toggleSelected } from "@models/references/reference-ops.ts";
import {
	EMPTY_PROJECT_SELECTION,
	isFixtureRow,
	isOverridden,
	type ElementSource,
	EMPTY_CREATIVE_DIRECTION,
	type TimelineTemplate,
} from "@maleo/shared";
import { applyPresetSourced, describePresetApply } from "@models/presets/preset-apply-sourced.ts";
import {
	recordAxisEdit,
	recordSettingsEdits,
	resetSectionToDefaults,
	supplierSuppliesPath,
} from "@models/presets/element-writes.ts";
import {
	planPushUp,
	recordPushedSources,
	repointForkedPresetSources,
} from "@models/presets/element-push.ts";
import { createContentPreset, getContentPresetUsage, updateContentPreset } from "@api/presets.ts";
import { DEFAULT_SETTINGS, presetSettings } from "@models/presets/creative-settings.ts";
import {
	DEFAULT_INFOGRAPHIC_STYLE,
	DEFAULT_PACING_DEVICES,
} from "@models/presets/generation-defaults.ts";
import { useDefaulterNames } from "@hooks/editor/use-defaulter-names.ts";
import type {
	TemplateParams,
	Config,
	EffectKind,
	TextOverlay,
	TextPreset,
	TransitionType,
} from "@maleo/shared";
import { AXIS_ELEMENT_PATHS, SETTINGS_ELEMENT_PATHS } from "@models/presets/element-paths.ts";
import { importSrtCaptions, captionClipsToSrt, parseSrt } from "@models/captions/srt.ts";
import { critiqueStoryboard } from "@models/content/engage-actions.ts";
import type { ChatLogMessage } from "@models/chat/chat-log.ts";
import {
	selectDerivedArrays,
	useDocumentSelector,
	type TimelineDocumentStore,
} from "@stores/timeline-document-store.ts";
import { replaceScope } from "@maleo/shared/editor";
import type { DocumentWriters } from "@stores/document-writers.ts";
import type { ChatSession } from "@hooks/editor/use-chat-session.ts";
import type { CreativeSettings } from "@hooks/editor/use-creative-settings.ts";
import type { ReferenceLibraryState } from "@hooks/editor/use-reference-library.ts";
import type { TimelineTemplates } from "@hooks/editor/use-timeline-templates.ts";
import { useChromeField, type EditorChromeStore } from "@stores/editor-chrome-store.ts";
import type { PlayheadHandle } from "@models/timeline/playhead-handle.ts";
import type { LibraryType } from "@models/core/routing.ts";
import { useState } from "react";
import { resolveSetState } from "@models/core/set-state.ts";
import { Panel, panelClassName } from "@design-system/components/panel.tsx";
import type { MediaImportControls } from "@hooks/editor/use-media-import.ts";
import { TimelineMediaTab } from "./timeline-media-tab.tsx";
import { TemplateRenderOverride } from "./timeline-template-override.tsx";

type ElementsProps = ComponentProps<typeof ElementsPanel>;
type MediaProps = ComponentProps<typeof AllMediaPanel>;
type TransitionsProps = ComponentProps<typeof TransitionsPanel>;

/** What a panel does. Each is the editor's, not the container's. */
export interface TimelinePanelOps {
	addOverlay: (
		at?: number,
		track?: number,
		preset?: TextPreset,
		paramsOverride?: TemplateParams,
	) => void;
	updateOverlay: (id: number, patch: Partial<TextOverlay>) => void;
	placeComposition: ElementsProps["onPlaceComposition"];
	addInfographic: ElementsProps["onAddData"];
	addInfographicPayload: ElementsProps["onPlaceCustomData"];
	addEffect: (kind: EffectKind) => void;
	addAutoInterrupts: (intervalSec: number) => void;
	addSceneWithMedia: (url: string, mediaAssetId?: string) => void;
	applyTransition: (type: TransitionType) => void;
	deleteRef: (id: string) => Promise<boolean>;
	jumpToClip: (ref: NonNullable<ChatLogMessage["ref"]>) => void;
	selectFreeClip: (source: "video" | "audio", id: number, start: number) => void;
	/** Select and seek to a clip that uses this asset. The media panel offers this
	 *  where it used to offer Delete, which a derived manifest cannot honour. */
	revealMediaAsset: (mediaAssetId: string) => void;
	seekPreview: (sec: number) => void;
}

/** What a panel reads. Derived in the editor, because that is where the preview,
 *  the selection and the timeline geometry live. */
export interface TimelinePanelView {
	aspect: MediaProps["aspect"];
	previewWidth: number;
	previewHeight: number;
	brandPalette: ElementsProps["brand"];
	/** The position, as a handle — read in a handler, never rendered here. */
	playhead: PlayheadHandle;
	total: number;
	active: TransitionsProps["active"];
	allImageRefs: ReferenceLibraryState["pool"];
	lockedMediaAssetIds: Set<string>;
	ttsStatus: ComponentProps<typeof SettingsPanel>["tts"];
	selectedOverlayId: number | null;
	selectedInfographicId: number | null | undefined;
	activeTransitionType: TransitionsProps["activeType"];
	canApplyTransition: boolean;
	transitionTargetName: TransitionsProps["targetName"];
	transitionPreviewFrames: TransitionsProps["previewFrames"];
	buildPacingInputs: () => {
		inputs: Parameters<typeof critiqueStoryboard>[0];
		timedScenes: Parameters<typeof critiqueStoryboard>[1];
	};
}

export interface TimelinePanelHostProps {
	captionJobs: CaptionJobControls;
	selectionStore: SelectionStore;
	imports: MediaImportControls;
	store: TimelineDocumentStore;
	writers: DocumentWriters;
	chromeStore: EditorChromeStore;
	config: Config;
	setConfig: Dispatch<SetStateAction<Config>>;
	projectId: string | null;
	library: ReferenceLibraryState;
	creative: CreativeSettings;
	chat: ChatSession;
	templates: TimelineTemplates;
	onSelectTimelineTemplate: (template: TimelineTemplate) => void;
	onOpenLibrary?: (type: LibraryType, editId?: string) => void;
	captions: ComponentProps<typeof CaptionsPanel>["value"];
	setCaptions: ComponentProps<typeof CaptionsPanel>["onChange"];
	ops: TimelinePanelOps;
	view: TimelinePanelView;
}

export function TimelinePanelHost({
	captionJobs,
	selectionStore,
	imports,
	store,
	writers,
	chromeStore,
	config,
	setConfig,
	projectId,
	library,
	creative,
	chat,
	templates,
	onSelectTimelineTemplate,
	onOpenLibrary,
	captions,
	setCaptions,
	ops,
	view,
}: TimelinePanelHostProps): JSX.Element | null {
	countRender("inspector");
	const [rail] = useChromeField(chromeStore, "rail");
	const [assetTab, setAssetTab] = useChromeField(chromeStore, "assetTab");
	const [, setPanelOpen] = useChromeField(chromeStore, "panelOpen");
	const close = (): void => setPanelOpen(false);
	const phone = usePhoneLayout();
	const [mediaError, setMediaError] = useState<string | null>(null);

	const derived = useDocumentSelector(store, selectDerivedArrays);
	const { scenes, audioOverlays, infographicOverlays } = derived;
	const projectReferences = derived.projectReferences ?? EMPTY_PROJECT_SELECTION;
	const { setInfographicOverlays, setProjectReferences } = writers;

	const { refs, setRefs, pool, setPool, products, mediaAssets, ensureMediaAsset } = library;
	const {
		settings,
		setSettings,
		direction,
		setDirection,
		pacingDevices,
		setPacingDevices,
		infographicStyle,
		setInfographicStyle,
		elementSources,
		setElementSources,
		renderOverrides,
		setRenderOverrides,
		activePresetId,
		setActivePresetId,
	} = creative;

	/* An operator edit has to claim its element, or the next preset apply overwrites it —
	   and the confirmation would have promised to keep it. Wrapping the setters here
	   rather than at each control is deliberate: the controls are many and spread across
	   two panels, and one that forgot to record would reintroduce exactly the bug this
	   change removes. Diffing at the single point the change passes through cannot
	   forget a field. */
	/* One lookup for the whole panel: sources store an id, and an id is not worth
	   showing a person. */
	const defaulters = useDefaulterNames(rail === "style" || rail === "settings");
	const defaulterName = defaulters.nameOf;
	const openDefaulter = (id: string): void => {
		onOpenLibrary?.("presets", id);
	};
	/* The preset the project is on. With one, handing an element back is a real revert to
	   what that preset supplies; without one it falls back to the shipped default. */
	const activePreset = defaulters.presetOf(activePresetId || null);
	const sourceOf = (path: string): ElementSource | undefined => elementSources[path];

	/* Whether the active preset actually carries a value for an element. A bundle is
	   partial — the shipped presets carry two settings fields between them — so being on
	   one does not mean it has an opinion about every element. The panel asks this to
	   choose between "Use default" and "Reset to shipped default", and it is the SAME
	   predicate the reset below uses, so the promise and the write cannot disagree. */
	const targetSupplies = (path: string): boolean =>
		supplierSuppliesPath({
			path,
			settingsPaths: SETTINGS_ELEMENT_PATHS,
			axisPaths: {
				pacingDevices: AXIS_ELEMENT_PATHS.pacingDevices,
				infographicStyle: AXIS_ELEMENT_PATHS.infographicStyle,
			},
			supplier: activePreset
				? {
						id: activePreset.id,
						settings: presetSettings(activePreset.bundle.settings),
						pacingDevices: activePreset.bundle.pacingDevices,
						infographicStyle: activePreset.bundle.infographicStyle,
					}
				: null,
		});

	/* Hand a section back to the cascade. It restores shipped defaults and records
	   code-default, which is what makes the elements seedable again — the point of the
	   control. Deliberately NOT routed through the operator-recording setters below: this
	   is the operator giving a claim UP, so recording them as an edit would undo it. */
	const onResetSection = (paths: readonly string[]): void => {
		const next = resetSectionToDefaults({
			paths,
			settings,
			pacingDevices,
			infographicStyle,
			sources: elementSources,
			settingsPaths: SETTINGS_ELEMENT_PATHS,
			axisPaths: {
				pacingDevices: AXIS_ELEMENT_PATHS.pacingDevices,
				infographicStyle: AXIS_ELEMENT_PATHS.infographicStyle,
			},
			defaults: {
				settings: DEFAULT_SETTINGS,
				pacingDevices: DEFAULT_PACING_DEVICES,
				infographicStyle: DEFAULT_INFOGRAPHIC_STYLE,
			},
			supplier: activePreset
				? {
						id: activePreset.id,
						settings: presetSettings(activePreset.bundle.settings),
						pacingDevices: activePreset.bundle.pacingDevices,
						infographicStyle: activePreset.bundle.infographicStyle,
					}
				: null,
		});
		setSettings(next.settings);
		setPacingDevices(next.pacingDevices);
		setInfographicStyle(next.infographicStyle);
		setElementSources(next.sources);
	};

	const onPushSection = async (paths: readonly string[]): Promise<void> => {
		if (!activePreset) return;
		const pushablePaths = paths.filter((path) => isOverridden(elementSources[path]));
		if (!pushablePaths.length) return;
		const plan = planPushUp({
			paths: pushablePaths,
			targetId: activePreset.id,
			targetIsFixture: isFixtureRow(activePreset),
			targetBundle: activePreset.bundle,
			style: config.style ?? null,
			projectReferences,
			settings,
			pacingDevices,
			infographicStyle,
			settingsPaths: SETTINGS_ELEMENT_PATHS,
			axisPaths: {
				config: AXIS_ELEMENT_PATHS.config,
				projectReferences: AXIS_ELEMENT_PATHS.projectReferences,
				pacingDevices: AXIS_ELEMENT_PATHS.pacingDevices,
				infographicStyle: AXIS_ELEMENT_PATHS.infographicStyle,
			},
		});
		if (!plan.pushed.length) return;
		let landedId = activePreset.id;
		if (plan.fork) {
			const created = await createContentPreset({
				name: `${activePreset.name} (custom)`,
				description: activePreset.description,
				bundle: plan.bundle,
			});
			landedId = created.id;
			setActivePresetId(landedId);
			setElementSources((sources) =>
				recordPushedSources(
					plan.pushed,
					landedId,
					repointForkedPresetSources({
						sources,
						fromDefaulterId: activePreset.id,
						toDefaulterId: landedId,
					}),
				),
			);
			return;
		}
		const usage = await getContentPresetUsage(activePreset.id).catch(() => null);
		if (usage && usage.using > 1) {
			const ok = window.confirm(
				`Updating the default "${activePreset.name}" affects ${usage.using} projects that draw from it. Continue?`,
			);
			if (!ok) return;
		}
		await updateContentPreset(activePreset.id, {
			name: activePreset.name,
			description: activePreset.description,
			bundle: plan.bundle,
		});
		setElementSources((sources) => recordPushedSources(plan.pushed, landedId, sources));
	};

	const setSettingsAsOperator: typeof setSettings = (update) => {
		setSettings((prev) => {
			const next = resolveSetState(update, prev);
			setElementSources((sources) =>
				recordSettingsEdits(prev, next, SETTINGS_ELEMENT_PATHS, sources),
			);
			return next;
		});
	};
	const setPacingAsOperator: typeof setPacingDevices = (update) => {
		setPacingDevices((prev) => {
			setElementSources((sources) => recordAxisEdit(AXIS_ELEMENT_PATHS.pacingDevices, sources));
			return resolveSetState(update, prev);
		});
	};
	const setInfographicAsOperator: typeof setInfographicStyle = (update) => {
		setInfographicStyle((prev) => {
			setElementSources((sources) => recordAxisEdit(AXIS_ELEMENT_PATHS.infographicStyle, sources));
			return resolveSetState(update, prev);
		});
	};

	/* Held in a variable so the phone and desktop arms below share one tree.
	 * An inline wrapper component would be a new function identity every
	 * render, remounting the whole panel — and its open accordions, scroll
	 * position and in-flight edits with it. */
	const content = (
		<>
			{rail === "chat" ? (
				<TimelineChatPanel
					store={store}
					writers={writers}
					library={library}
					chat={chat}
					projectId={projectId}
					ops={ops}
					view={view}
					onClose={close}
				/>
			) : rail === "style" ? (
				<StylePanel
					settings={settings}
					onSettingsChange={setSettingsAsOperator}
					sourceOf={sourceOf}
					defaulterName={defaulterName}
					onOpenDefaulter={openDefaulter}
					onResetSection={onResetSection}
					onPushSection={activePreset ? (paths) => void onPushSection(paths) : undefined}
					revertTargetName={activePreset?.name}
					revertTargetId={activePreset?.id}
					revertTargetIsFixture={activePreset ? isFixtureRow(activePreset) : false}
					targetSupplies={targetSupplies}
					styleRefs={view.allImageRefs.filter((r) => !isProductRef(r))}
					pacingDevices={pacingDevices}
					onPacingChange={setPacingAsOperator}
					dataStyle={(() => {
						const selected =
							infographicOverlays.find((x) => x.id === view.selectedInfographicId) ?? null;
						return {
							effective: { ...infographicStyle, ...selected?.style },
							selected: !!selected,
							clipOwn: Boolean(selected?.style),
							onChange: (next) => {
								if (selected)
									setInfographicOverlays((items) =>
										items.map((x) => (x.id === selected.id ? { ...x, style: next } : x)),
									);
								else setInfographicAsOperator(next);
							},
						};
					})()}
					/* Applying a preset replaces INHERITED values only. It used to replace every
					   axis unconditionally, because nothing recorded which values were the
					   operator's; now something does, so the apply respects them unless the
					   operator ticks the opt-in the confirmation offers. */
					onApplyPreset={(bundle, meta, options) => {
						const next = applyPresetSourced(
							{ config, projectReferences, settings, pacingDevices, infographicStyle },
							elementSources,
							bundle,
							meta,
							options,
						);
						setConfig(next.targets.config);
						setProjectReferences(next.targets.projectReferences);
						setSettings(next.targets.settings);
						setPacingDevices(next.targets.pacingDevices);
						setInfographicStyle(next.targets.infographicStyle);
						setElementSources(next.sources);
						// Record WHICH preset the project is now on: per-element sources cannot answer
						// that for an element the operator later edits, and that is exactly the element
						// a revert is asked about.
						setActivePresetId(meta.id);
						setDirection(bundle.direction ?? EMPTY_CREATIVE_DIRECTION);
					}}
					describeApply={(bundle, meta) =>
						describePresetApply(
							{ config, projectReferences, settings, pacingDevices, infographicStyle },
							elementSources,
							bundle,
							meta,
						)
					}
					direction={direction}
					onDirectionChange={setDirection}
					onClose={close}
				/>
			) : rail === "settings" ? (
				<SettingsPanel
					value={settings}
					onChange={setSettingsAsOperator}
					sourceOf={sourceOf}
					defaulterName={defaulterName}
					onOpenDefaulter={openDefaulter}
					onResetSection={onResetSection}
					onPushSection={activePreset ? (paths) => void onPushSection(paths) : undefined}
					revertTargetName={activePreset?.name}
					revertTargetId={activePreset?.id}
					revertTargetIsFixture={activePreset ? isFixtureRow(activePreset) : false}
					targetSupplies={targetSupplies}
					tts={view.ttsStatus}
					onClose={close}
				/>
			) : rail === "captions" ? (
				<CaptionTranscriptPanel
					store={store}
					writers={writers}
					selectionStore={selectionStore}
					jobs={captionJobs}
					playhead={view.playhead}
					seek={ops.seekPreview}
					mediaAssets={mediaAssets}
					projectId={projectId}
					value={captions}
					onChange={setCaptions}
					onClose={close}
					cueCount={derived.captionClips?.length ?? 0}
					exportDisabledReason={
						!captions.enabled
							? "Enable captions before export."
							: derived.captionClips?.some((cue) => cue.caption?.status === "needs-refresh")
								? "Captions need refresh. Regenerate affected sources or unlink captions before export."
								: undefined
					}
					onImportSrt={(text) => {
						const result = parseSrt(text);
						if (!result.cues.length)
							return {
								ok: false,
								message: `No valid captions found (${result.malformedBlocks} malformed blocks). Current captions were preserved.`,
							};
						try {
							const importId = crypto.randomUUID();
							writers.apply((scope) =>
								replaceScope(
									{ ...scope, doc: importSrtCaptions(scope.doc, result, importId) },
									"captions.import",
								),
							);
							return {
								ok: true,
								message: `Imported ${result.cues.length} captions. Skipped ${result.malformedBlocks} malformed blocks. ${result.overlappingCues} cues overlap earlier cues.`,
							};
						} catch (error) {
							return {
								ok: false,
								message: error instanceof Error ? error.message : "Cannot import captions.",
							};
						}
					}}
					onExportSrt={() => {
						const clips = store.getDoc().clips;
						if (!clips.some((clip) => clip.type === "caption")) return;
						const blob = new Blob([captionClipsToSrt(clips)], { type: "application/x-subrip" });
						const url = URL.createObjectURL(blob);
						const a = document.createElement("a");
						a.href = url;
						a.download = "captions.srt";
						a.click();
						URL.revokeObjectURL(url);
					}}
				/>
			) : rail === "elements" ? (
				<ElementsPanel
					brand={view.brandPalette}
					aspect={view.aspect}
					onAddText={(preset) => ops.addOverlay(undefined, undefined, preset)}
					onPlaceCustomText={(preset, defaultParams) =>
						ops.addOverlay(undefined, undefined, preset, defaultParams)
					}
					onPlaceComposition={ops.placeComposition}
					onAddData={ops.addInfographic}
					onPlaceCustomData={ops.addInfographicPayload}
					onClose={close}
				/>
			) : rail === "templates" ? (
				<TimelineTemplatesPanel
					renderOverride={
						<TemplateRenderOverride
							templates={templates.items}
							selectedTemplateId={settings.timelineTemplateId}
							renderOverrides={renderOverrides}
							setRenderOverrides={setRenderOverrides}
						/>
					}
					templates={templates.items}
					selectedId={settings.timelineTemplateId}
					refs={pool}
					projectEmotions={planEmotions(chat.messages)}
					busy={templates.busy}
					error={templates.error}
					previewWidth={view.previewWidth}
					previewHeight={view.previewHeight}
					onSelect={onSelectTimelineTemplate}
					onCreate={templates.create}
					onUpdate={templates.update}
					onClose={close}
				/>
			) : rail === "transitions" ? (
				<TransitionsPanel
					active={view.active}
					activeType={view.activeTransitionType}
					canApply={view.canApplyTransition}
					targetName={view.transitionTargetName}
					previewFrames={view.transitionPreviewFrames}
					onApply={ops.applyTransition}
					onClose={close}
				/>
			) : rail === "effects" ? (
				<EffectsPanel
					onAdd={(k) => {
						ops.addEffect(k);
					}}
					onAutoInterrupts={ops.addAutoInterrupts}
					onClose={close}
				/>
			) : rail === "media" ? (
				<>
					<PanelHeader density="tool" title="Assets" onClose={close} closeLabel="Hide panel" />
					<div className="tl2-asset-tabs" role="tablist" aria-label="Asset source">
						<button
							role="tab"
							aria-selected={assetTab === "media"}
							className={assetTab === "media" ? "on" : ""}
							onClick={() => setAssetTab("media")}
						>
							{Ic.image(ICON.xs)} Media
						</button>
						<button
							role="tab"
							aria-selected={assetTab === "library"}
							className={assetTab === "library" ? "on" : ""}
							onClick={() => setAssetTab("library")}
						>
							{Ic.layers(ICON.xs)} References
						</button>
						<button
							role="tab"
							aria-selected={assetTab === "stock"}
							className={assetTab === "stock" ? "on" : ""}
							onClick={() => setAssetTab("stock")}
						>
							{Ic.box(ICON.xs)} Stock
						</button>
					</div>
					<div style={{ display: assetTab === "media" ? "contents" : "none" }}>
						<TimelineMediaTab
							imports={imports}
							store={store}
							writers={writers}
							library={library}
							scenes={scenes}
							videoOverlays={derived.videoOverlays}
							audioOverlays={audioOverlays}
							ops={ops}
							view={view}
							mediaError={mediaError}
							setMediaError={setMediaError}
							close={close}
						/>
					</div>
					<div style={{ display: assetTab === "library" ? "contents" : "none" }}>
						<ReferenceLibrary
							mode="panel"
							type="video"
							draggableToTimeline
							refs={refs}
							setRefs={(fn) => setRefs(fn)}
							pool={pool}
							setPool={(fn) => setPool(fn)}
							products={products}
							projectId={projectId}
							projectSelection={projectReferences}
							onToggleProjectSelection={(id) => {
								const willSelect = !projectReferences.entityIds.includes(id);
								setProjectReferences((p) => toggleSelected(p, id));
								if (projectId) persistProjectSelection(projectId, id, willSelect);
							}}
							sceneCasts={scenes.map((s) => s.refIds ?? [])}
							primaryEntityId={pool.find((r) => r.primary)?.id ?? null}
							onSetPrimary={(id, next) => {
								if (projectId) persistPrimaryEntity(projectId, id, next);
								setPool((entries) => entries.map((r) => ({ ...r, default: next && r.id === id })));
							}}
							onDeleteRef={ops.deleteRef}
							onClose={close}
						/>
					</div>
					<div style={{ display: assetTab === "stock" ? "contents" : "none" }}>
						<StockPanel
							embedded
							savedUrls={new Set(mediaAssets.map((a) => a.url))}
							onAddToMedia={(asset) => {
								ensureMediaAsset(asset);
							}}
							onClose={close}
						/>
					</div>
				</>
			) : null}
		</>
	);

	/* On a phone the panel is a bottom sheet rather than a 312px column, rising
	 * from the rail that opened it.
	 *
	 * The sheet wraps THIS host, not the `.tl2-panel` class. That class is not
	 * editor-private — templates-library, elements-library, reference-library
	 * and custom-clip-templates all use it, several through a
	 * `tl2-panel-inline` variant that exists precisely to say "this one does
	 * not float". Restyling the class would turn four catalog surfaces into
	 * sheets as a side effect.
	 *
	 * `open` is unconditionally true because the host only mounts while
	 * `panelOpen` is set — timeline-editor.tsx gates it. */
	if (phone) {
		/* Chat is not a sheet on a phone: it is the workspace's Chat view, which
		 * the editor hosts beside this one. See phone-workspace.tsx. */
		if (rail === "chat") return null;
		return (
			/* Stands off the bottom bar, so the rail that opened this stays visible
			 * and tappable underneath it. Switching destinations is then one tap
			 * rather than three — dismiss, find the bar again, pick — and the bar
			 * is the only navigation this surface has.
			 *
			 * `headroom` too, so this sits in the same band as the other three:
			 * every bottom sheet covers the timeline's lanes and nothing else.
			 * That costs these panels height — a media grid is a destination in its
			 * own right and would take more — and it is
			 * taken anyway, because a sheet whose size depends on which one it is
			 * makes the surface underneath jump for no reason the operator can
			 * see. They scroll. */
			<Sheet
				edge="bottom"
				open
				onClose={close}
				offset="var(--tl2-sheet-bottom, var(--tl2-bottombar-h))"
				headroom="var(--tl2-sheet-top, 0px)"
				label="Editor panel"
				className={panelClassName({ sheet: true })}
			>
				{content}
			</Sheet>
		);
	}

	return <Panel>{content}</Panel>;
}
