import { Callout } from "@design-system/components/note.tsx";
import { PanelHeader } from "@design-system/patterns/panel-header.tsx";
/* Maleo — Content-First Create · the Style and Project Settings panels.
 *
 * Project-wide creative defaults persisted in editor_state_json. Credentials live in
 * Workspace Settings; this panel only picks among configured providers. Provider fields
 * whose backend wiring doesn't exist yet are shown read-only.
 *
 * Both panels edit properties inline in collapsible sections; nothing opens another
 * surface. Style's sections start collapsed. The taxonomy is in panel-groups, the
 * provenance actions in panel-rows, the words in panel-copy.
 */
import { useEffect, useState } from "react";
import type { JSX, ReactNode } from "react";
import {
	isOverridden,
	EMPTY_CREATIVE_DIRECTION,
	type ContentPreset,
	type ContentPresetBundle,
	type CreativeDirection,
	type RenderPresentation,
} from "@maleo/shared";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { PresetPickerModal, PresetOverrideWarning } from "./preset-picker.tsx";
import { AXIS_ELEMENT_PATHS, SETTINGS_ELEMENT_PATHS } from "@models/presets/element-paths.ts";
import {
	DEFAULT_BACKGROUND_FILL,
	DEFAULT_SETTINGS,
	settingsWithPresentation,
	type GlobalSettings,
} from "@models/presets/creative-settings.ts";
// Re-exported so this panel stays the import site its consumers already use.
export { DEFAULT_BACKGROUND_FILL, DEFAULT_SETTINGS, settingsWithPresentation };
export type { GlobalSettings };
import type { PacingDevices, RefImage, TtsStatus } from "@maleo/shared";
import { AlphaColorControl } from "@design-system/components/color-control.tsx";
import { get } from "@api/client.ts";
import { VIDEO_ASPECTS } from "@models/timeline/timeline-editor-model.ts";
import { Select, onSelect } from "@design-system/components/select.tsx";
import {
	BRAND_GROUP,
	DIRECTION_GROUP,
	STYLE_REFERENCE_GROUP,
	type PanelGroupDef,
} from "./panel-groups.ts";
import { groupSourceFor, useProvenanceActions, type PanelProvenance } from "./panel-shell.tsx";
import { InspectorSection, PropertyRow } from "@design-system/patterns/inspector.tsx";
import { ProjectPropertyActions } from "./project-property-actions.tsx";
import { ErrorState } from "@design-system/patterns/collection.tsx";
import { useImageProviderStatus } from "@hooks/settings/use-image-provider-status.ts";
import { imageProviderStatusMessage } from "@models/settings/image-provider.ts";
import type { TextProviderStatus } from "./text-provider-select.tsx";
import { Button } from "@design-system/components/button.tsx";
import { Field } from "@design-system/components/field.tsx";
import { Input, Textarea } from "@design-system/components/input.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";
import { Switch } from "@design-system/components/switch.tsx";
import { GRADIENT_BACKGROUNDS, SOLID_BACKGROUNDS, SwatchGroup } from "./background-swatches.tsx";
import { StyleReferencePicker } from "./style-reference-picker.tsx";
import { VoiceOptionList } from "./voice-option-list.tsx";
// Re-exported so this panel stays the import site its consumers already use.
export { VoiceOptionList };

/* Option lists the selects below render from, so control and handler cannot disagree. */
const PILL_VARIANTS: NonNullable<PacingDevices["variant"]>[] = ["pill", "minimal"];
const RENDER_BACKENDS: GlobalSettings["renderBackend"][] = ["", "local", "lambda"];
const RENDER_BACKEND_LABEL = {
	"": "Server default",
	local: "Local worker",
	lambda: "Remotion Lambda (cloud)",
} satisfies Record<GlobalSettings["renderBackend"], string>;

/** The render-affecting half of the settings, in the shape the document stores.
 *
 *  These four decide what a render CONTAINS -- the aspect it is cut to, the brand
 *  it wears, what sits behind it -- so they version with the storyboard. The rest
 *  (`renderBackend`, the voice and template preferences) change how a render is
 *  produced or what the NEXT generation does, and stay editor state.
 *
 *  Undefined rather than "" for every empty value: the document records a decision
 *  and "" is not one. */
export function renderPresentation(settings: GlobalSettings): RenderPresentation {
	const brand =
		settings.brandAccent || settings.brandFont || settings.brandLogoUrl
			? {
					accentColor: settings.brandAccent || undefined,
					fontFamily: settings.brandFont || undefined,
					logoUrl: settings.brandLogoUrl || undefined,
				}
			: undefined;
	return {
		aspectRatio: settings.aspectRatio || undefined,
		brand,
		backgroundFill: settings.backgroundFill || undefined,
	};
}

// Writes `settings.aspectRatio`, which use-preview-composition reads into
// FORMAT_DIMS. The list is VIDEO_ASPECTS so this picker and the timeline's
// aspect menu cannot disagree; render-option-parity.test.ts checks that same
// table against what the pipeline implements.
const ASPECTS = VIDEO_ASPECTS.map((a) => a.id);
// Narration language hint for longform TTS. Provider speaks one voice id in
// many languages and needs telling which; Kokoro's voices are language-locked
// and derive it from the voice, ignoring this. Codes are BCP-47-ish.
const LANGUAGES: ReadonlyArray<{ code: string; label: string }> = [
	{ code: "en", label: "English" },
	{ code: "id", label: "Indonesian" },
	{ code: "es", label: "Spanish" },
	{ code: "ja", label: "Japanese" },
	{ code: "zh", label: "Chinese" },
];

interface SettingsPanelProps extends PanelProvenance {
	value: GlobalSettings;
	onChange: (next: GlobalSettings) => void;
	tts?: TtsStatus | null;
	onClose: () => void;
}

interface StylePanelProps extends PanelProvenance {
	settings: GlobalSettings;
	onSettingsChange: (next: GlobalSettings) => void;
	/** Visual reference images available as a global style lock. */
	styleRefs?: RefImage[];
	/** Retention devices over the reel (chapter pill / progress bar) — persisted
	 *  in storyboard_json, applied to preview + render. */
	pacingDevices?: PacingDevices;
	onPacingChange?: (next: PacingDevices) => void;
	/** Apply a preset. `meta.id` is recorded as the source of everything it supplies,
	 *  so a surface can later name and open the preset an element came from. */
	onApplyPreset?: (
		bundle: ContentPresetBundle,
		meta: { id: string; name: string; description: string },
		options: { overwriteOperatorEdits: boolean },
	) => void;
	/** What an apply WOULD do, for the confirmation. Computed by the caller from the
	 *  same rule the apply uses, so the dialog and the act cannot disagree. */
	describeApply?: (
		bundle: ContentPresetBundle,
		meta: { id: string; name: string; description: string },
	) => { replaced: string[]; kept: string[] };
	/** Free-text creative direction (story/visual/voice). */
	direction?: CreativeDirection;
	onDirectionChange?: (next: CreativeDirection) => void;
	onClose: () => void;
}

export function StylePanel(props: StylePanelProps): JSX.Element {
	const {
		settings,
		onSettingsChange,
		styleRefs = [],
		pacingDevices: pacing,
		onPacingChange,
		onApplyPreset,
		describeApply,
		direction,
		onDirectionChange,
		onClose,
		onOpenDefaulter,
	} = props;
	const set = <K extends keyof GlobalSettings>(k: K, v: GlobalSettings[K]): void =>
		onSettingsChange({ ...settings, [k]: v });
	const [presetPickerOpen, setPresetPickerOpen] = useState(false);
	const [pendingPreset, setPendingPreset] = useState<ContentPreset | null>(null);
	const actions = useProvenanceActions(props);
	const fill = settings.backgroundFill || DEFAULT_BACKGROUND_FILL;

	const sourceAction = (group: PanelGroupDef): ReactNode => {
		const source = groupSourceFor(props, group);
		if (!source || source.kind === "none") return undefined;
		return source.defaulterId && onOpenDefaulter ? (
			<Button
				variant="ghost"
				size="xs"
				onClick={() => onOpenDefaulter(source.defaulterId!)}
				aria-label={`Open ${source.label}`}
			>
				{source.label}
			</Button>
		) : (
			<span className="fc-cap-desc">{source.label}</span>
		);
	};
	const defaults = (path: string, label: string) => (
		<ProjectPropertyActions
			label={label}
			path={path}
			changed={isOverridden(props.sourceOf?.(path))}
			actions={actions}
		/>
	);
	/* A single-element section has no row to carry its default actions, so the header does. */
	const sectionActions = (group: PanelGroupDef, label: string): ReactNode => (
		<span style={{ display: "flex", gap: 4, alignItems: "center" }}>
			{sourceAction(group)}
			{defaults(group.paths[0]!, label)}
		</span>
	);

	return (
		<>
			<PanelHeader density="tool" title="Style" onClose={onClose} closeLabel="Hide panel" />
			<div className="tl2-panel-body fc-set fc-style-panel">
				{onApplyPreset && (
					<div className="fc-style-preset">
						<button type="button" className="cv-addtile" onClick={() => setPresetPickerOpen(true)}>
							{Ic.spark(ICON.sm)} Change default
						</button>
						<p className="fc-cap-desc">
							Fills whatever you have not set yourself from a saved default.
						</p>
					</div>
				)}
				{presetPickerOpen && (
					<PresetPickerModal
						sub="Fills this project's inherited style, references, and settings."
						onClose={() => setPresetPickerOpen(false)}
						onPick={(preset) => {
							setPresetPickerOpen(false);
							setPendingPreset(preset);
						}}
					/>
				)}
				{pendingPreset &&
					onApplyPreset &&
					(() => {
						const meta = {
							id: pendingPreset.id,
							name: pendingPreset.name,
							description: pendingPreset.description,
						};
						const report = describeApply?.(pendingPreset.bundle, meta) ?? {
							replaced: [],
							kept: [],
						};
						return (
							<PresetOverrideWarning
								presetName={pendingPreset.name}
								replaced={report.replaced}
								kept={report.kept}
								onCancel={() => setPendingPreset(null)}
								onConfirm={(options) => {
									onApplyPreset(pendingPreset.bundle, meta, options);
									setPendingPreset(null);
								}}
							/>
						);
					})()}

				{/* Every section starts collapsed: the rail is a table of contents first, and
				    each section edits in place rather than opening another surface. */}
				{onDirectionChange && (
					<InspectorSection title={DIRECTION_GROUP.title} collapsible>
						<DirectionFields
							value={direction ?? EMPTY_CREATIVE_DIRECTION}
							onChange={onDirectionChange}
						/>
					</InspectorSection>
				)}

				<InspectorSection
					title={STYLE_REFERENCE_GROUP.title}
					collapsible
					action={sectionActions(STYLE_REFERENCE_GROUP, "Style reference")}
				>
					<StyleReferencePicker
						refs={styleRefs}
						value={settings.globalStyleRefId}
						onChange={(id) => set("globalStyleRefId", id)}
					/>
				</InspectorSection>

				<InspectorSection title={BRAND_GROUP.title} collapsible action={sourceAction(BRAND_GROUP)}>
					<PropertyRow
						label="Accent"
						as="div"
						actions={defaults(SETTINGS_ELEMENT_PATHS.brandAccent, "Accent")}
					>
						<span style={{ display: "flex", gap: 6, alignItems: "center" }}>
							<AlphaColorControl
								compact
								label="Accent"
								value={settings.brandAccent}
								fallback="#ff3e6c"
								onChange={(v) => set("brandAccent", v)}
							/>
							<Input
								size="xs"
								style={{ flex: 1 }}
								aria-label="Accent value"
								placeholder="Render default"
								value={settings.brandAccent}
								onChange={(e) => set("brandAccent", e.target.value)}
							/>
							{settings.brandAccent && (
								<IconButton size="xs" title="Clear accent" onClick={() => set("brandAccent", "")}>
									{Ic.x(ICON.xs)}
								</IconButton>
							)}
						</span>
					</PropertyRow>
					{/* The three overlay rows share one element path, so each row's default
					    actions move every overlay setting together. */}
					{pacing && onPacingChange && (
						<>
							<PropertyRow
								label="Chapter pills"
								actions={defaults(AXIS_ELEMENT_PATHS.pacingDevices, "Chapter pills")}
							>
								<Switch
									size="sm"
									aria-label="Chapter pills"
									checked={Boolean(pacing.chapterPills)}
									onCheckedChange={(chapterPills) => onPacingChange({ ...pacing, chapterPills })}
								/>
							</PropertyRow>
							{pacing.chapterPills && (
								<PropertyRow
									label="Pill style"
									actions={defaults(AXIS_ELEMENT_PATHS.pacingDevices, "Pill style")}
								>
									<Select
										size="xs"
										value={pacing.variant ?? "pill"}
										aria-label="Pill style"
										onValueChange={onSelect(PILL_VARIANTS, (variant) =>
											onPacingChange({ ...pacing, variant }),
										)}
										phoneBreakpoint={860}
										options={[...(PILL_VARIANTS.map((v) => ({ value: v, label: v })) ?? [])]}
									/>
								</PropertyRow>
							)}
							<PropertyRow
								label="Progress bar"
								actions={defaults(AXIS_ELEMENT_PATHS.pacingDevices, "Progress bar")}
							>
								<Switch
									size="sm"
									aria-label="Progress bar"
									checked={Boolean(pacing.progressBar)}
									onCheckedChange={(progressBar) => onPacingChange({ ...pacing, progressBar })}
								/>
							</PropertyRow>
						</>
					)}
					<PropertyRow
						label="Watermark"
						actions={defaults(SETTINGS_ELEMENT_PATHS.brandLogoUrl, "Watermark")}
					>
						<Input
							size="xs"
							aria-label="Watermark logo URL"
							placeholder="Logo URL — off"
							value={settings.brandLogoUrl}
							onChange={(e) => set("brandLogoUrl", e.target.value)}
						/>
					</PropertyRow>
					<PropertyRow
						label="Background"
						as="div"
						actions={defaults(SETTINGS_ELEMENT_PATHS.backgroundFill, "Background")}
					>
						<div className="fc-style-modal-body">
							<div className="fc-bg-current">
								<span className="fc-bg-preview" style={{ background: fill }} aria-hidden />
								<Input
									size="xs"
									value={fill}
									onChange={(e) => set("backgroundFill", e.target.value)}
									aria-label="Background CSS color or gradient"
								/>
							</div>
							<SwatchGroup
								title="Solid Colors"
								values={SOLID_BACKGROUNDS}
								active={fill}
								onPick={(backgroundFill) => set("backgroundFill", backgroundFill)}
							/>
							<SwatchGroup
								title="Gradients"
								values={GRADIENT_BACKGROUNDS}
								active={fill}
								onPick={(backgroundFill) => set("backgroundFill", backgroundFill)}
							/>
						</div>
					</PropertyRow>
				</InspectorSection>
			</div>
		</>
	);
}

function DirectionFields({
	value,
	onChange,
}: {
	value: CreativeDirection;
	onChange: (next: CreativeDirection) => void;
}): JSX.Element {
	const setChan = <K extends keyof CreativeDirection>(k: K, v: string): void =>
		onChange({ ...value, [k]: v });
	return (
		<>
			<Field>
				<Textarea
					rows={3}
					value={value.raw}
					placeholder="Type anything — story, look, and voice. e.g. calm hopeful tone, stickman on white bg, warm slow female narrator"
					onChange={(e) => setChan("raw", e.target.value)}
				/>
				<p className="fc-cap-desc">
					Split into channels at generation. Override below to correct a mis-route.
				</p>
			</Field>
			<Field>
				<span>Story</span>
				<Input
					value={value.story}
					placeholder="subject, tone, theme"
					onChange={(e) => setChan("story", e.target.value)}
				/>
			</Field>
			<Field>
				<span>Visual</span>
				<Input
					value={value.visual}
					placeholder="look, style, background, figures"
					onChange={(e) => setChan("visual", e.target.value)}
				/>
			</Field>
			<Field>
				<span>Voice</span>
				<Input
					value={value.voice}
					placeholder="narrator, language, pacing"
					onChange={(e) => setChan("voice", e.target.value)}
				/>
			</Field>
		</>
	);
}

export function SettingsPanel(props: SettingsPanelProps): JSX.Element {
	const { value, onChange, tts, onClose } = props;
	const set = <K extends keyof GlobalSettings>(k: K, v: GlobalSettings[K]): void =>
		onChange({ ...value, [k]: v });
	const imageProvider = useImageProviderStatus();
	const [textProviders, setTextProviders] = useState<TextProviderStatus | null>(null);
	const [textProviderError, setTextProviderError] = useState<string | null>(null);
	const actions = useProvenanceActions(props);

	const loadTextProviders = async (): Promise<void> => {
		try {
			setTextProviders(await get<TextProviderStatus>("/api/settings/text-provider"));
			setTextProviderError(null);
		} catch (error) {
			setTextProviderError(error instanceof Error ? error.message : String(error));
		}
	};

	useEffect(() => {
		void loadTextProviders();
	}, []);

	/* Everything about providers is read off the payload. There used to be three
	 * arrays here — the option list, the id list and a label map — plus a boolean
	 * per provider, so adding a TTS provider meant four edits in this file alone. */
	const ttsProviders = tts?.providers ?? [];
	const providerOptions: GlobalSettings["voiceProvider"][] = ["", ...ttsProviders.map((p) => p.id)];
	const providerLabel = (id: string): string => ttsProviders.find((p) => p.id === id)?.label ?? id;
	const effProvider = value.voiceProvider || tts?.effective_provider || "";
	const effEntry = ttsProviders.find((p) => p.id === effProvider);
	const voices = effEntry?.voices ?? [];
	const effConfigured = effEntry?.health === "ready";
	const defaultLabel = tts?.effective_provider ? ` (${providerLabel(tts.effective_provider)})` : "";

	const defaults = (path: string, label: string) => (
		<ProjectPropertyActions
			label={label}
			path={path}
			changed={isOverridden(props.sourceOf?.(path))}
			actions={actions}
		/>
	);

	return (
		<>
			<PanelHeader
				density="tool"
				title="Project Settings"
				onClose={onClose}
				closeLabel="Hide panel"
			/>
			<div className="tl2-panel-body fc-set fc-project-settings">
				<InspectorSection title="Output" collapsible defaultOpen>
					<PropertyRow
						label="Aspect ratio"
						actions={defaults(SETTINGS_ELEMENT_PATHS.aspectRatio, "Aspect ratio")}
					>
						<Select
							size="xs"
							aria-label="Aspect ratio"
							value={value.aspectRatio}
							onValueChange={(e) => set("aspectRatio", e)}
							phoneBreakpoint={860}
							options={[...(ASPECTS.map((o) => ({ value: o, label: o })) ?? [])]}
						/>
					</PropertyRow>
					<PropertyRow
						label="Render backend"
						actions={defaults(SETTINGS_ELEMENT_PATHS.renderBackend, "Render backend")}
					>
						<Select
							size="xs"
							aria-label="Render backend"
							value={value.renderBackend}
							onValueChange={onSelect(RENDER_BACKENDS, (backend) => set("renderBackend", backend))}
							phoneBreakpoint={860}
							options={[
								...(RENDER_BACKENDS.map((b) => ({ value: b, label: RENDER_BACKEND_LABEL[b] })) ??
									[]),
							]}
						/>
					</PropertyRow>
					<PropertyRow label="Image provider" as="div">
						<Input
							size="xs"
							aria-label="Image provider"
							readOnly
							value={
								imageProvider.status?.selected_provider ||
								imageProvider.status?.effective_provider ||
								"App default"
							}
						/>
					</PropertyRow>
					<p className="fc-cap-desc">
						Image and AI providers are managed by an instance owner in God Mode → Providers.
					</p>
					{(!imageProvider.status ||
						imageProvider.busy ||
						imageProvider.error ||
						imageProvider.status.selection_error) && (
						<p className="fc-cap-desc" aria-live="polite">
							{imageProviderStatusMessage(imageProvider)}
						</p>
					)}
					{imageProvider.error && (
						<ErrorState
							inline
							title="Image provider unavailable"
							message={imageProvider.error}
							onRetry={() => void imageProvider.load()}
						/>
					)}
					{imageProvider.status && !imageProvider.status.worker_configured && (
						<Callout role="status">
							Media worker is not configured. Choice is saved but cannot run yet.
						</Callout>
					)}
					<PropertyRow label="AI provider" as="div">
						<Input
							size="xs"
							aria-label="AI provider"
							readOnly
							value={textProviders?.selected?.providerId || "App default"}
						/>
					</PropertyRow>
					{textProviderError && (
						<ErrorState
							inline
							title="AI provider unavailable"
							message={textProviderError}
							onRetry={() => void loadTextProviders()}
						/>
					)}
					<PropertyRow label="Video provider" as="div">
						<Input size="xs" aria-label="Video provider" readOnly value="Workspace default" />
					</PropertyRow>
					<p className="fc-cap-desc">Video provider is configured at the workspace level.</p>
				</InspectorSection>
				<InspectorSection title="Audio" collapsible defaultOpen>
					<PropertyRow
						label="Voice provider"
						actions={defaults(SETTINGS_ELEMENT_PATHS.voiceProvider, "Voice provider")}
					>
						<Select
							size="xs"
							aria-label="Voice provider"
							value={value.voiceProvider}
							onValueChange={onSelect(providerOptions, (voiceProvider) =>
								onChange({ ...value, voiceProvider, voice: "" }),
							)}
							phoneBreakpoint={860}
							options={[
								{ value: "", label: "App default" + String(defaultLabel) },
								...(ttsProviders.map((p) => ({
									value: p.id,
									label: String(p.label) + String(p.health === "ready" ? "" : " — not configured"),
									disabled: p.health !== "ready",
								})) ?? []),
							]}
						/>
					</PropertyRow>
					{!effConfigured && (
						<Callout role="status">
							{effProvider
								? `${providerLabel(effProvider)} not configured — set it up in God Mode → Providers.`
								: "No voice provider is configured — set one up in God Mode → Providers."}
						</Callout>
					)}
					<PropertyRow
						label="Narration language"
						actions={defaults(SETTINGS_ELEMENT_PATHS.language, "Narration language")}
					>
						<Select
							size="xs"
							aria-label="Narration language"
							value={value.language}
							onValueChange={(e) => set("language", e)}
							phoneBreakpoint={860}
							options={[
								{ value: "", label: "Provider default" },
								...(LANGUAGES.map((l) => ({ value: l.code, label: l.label })) ?? []),
							]}
						/>
					</PropertyRow>
					<PropertyRow
						label="Voice"
						as="div"
						actions={defaults(SETTINGS_ELEMENT_PATHS.voice, "Voice")}
					>
						<VoiceOptionList
							voices={voices}
							value={value.voice}
							preferLang={value.language}
							disabled={!effConfigured || voices.length === 0}
							onChange={(voice) => set("voice", voice)}
						/>
					</PropertyRow>
				</InspectorSection>
			</div>
		</>
	);
}

export default SettingsPanel;
