/* The edit modal for one timeline item — text, shape, audio levels, effects and
 * transitions — plus the host that decides which modal the selection opens. */
import type { JSX, ReactNode } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { PanelHeader } from "@design-system/patterns/panel-header.tsx";
import { MentionTextarea } from "./mention-textarea.tsx";
import type { PlayheadHandle } from "@models/timeline/playhead-handle.ts";
import type { GlobalSettings } from "@components/editor/editor-settings.tsx";
import { fmtMMSS } from "@models/core/measures.ts";
import { findTextTemplate, styleKnobsFor } from "@models/clip-templates/registry.ts";
import {
	ExactTimelinePreview,
	textTemplateValuesFromClip,
	FONT_FAMILIES,
} from "./timeline-editor-panels.tsx";
import { TemplateFieldsEditor } from "@components/clip-templates/template-fields-editor.tsx";
import { SaveAsMotionBlock } from "@components/clip-templates/custom-clip-templates.tsx";
import { KeyedFieldRow, type RowKeying } from "./keyed-property-row.tsx";
import { resolveSceneRefs, type ResolvedSceneRefs } from "@hooks/timeline/use-scene-refs.ts";
import { SceneReferenceChips } from "./scene-reference-chips.tsx";
import type {
	AudioOverlay,
	GenVersion,
	ProjectSelection,
	RefImage,
	RefsState,
	Scene,
	TextOverlay,
	VideoOverlay,
} from "@maleo/shared";
import type { ChatLogMessage } from "@models/chat/chat-log.ts";
import { audioKindLabel } from "@maleo/shared/audio-overlays";
import { AlphaColorControl } from "@design-system/components/color-control.tsx";
import { AudioPreview } from "@design-system/components/audio-preview.tsx";
import { defaultTextStyle } from "@models/timeline/clip-layout.ts";
import type { ClipTextStyle } from "@models/timeline/clip-layout.ts";
import { type Storyboard } from "@maleo/video/composition";
import { DEFAULT_BRAND, type BrandPalette } from "@models/timeline/panel-brand.ts";
import { Button } from "@design-system/components/button.tsx";
import { Chip } from "@design-system/components/chip.tsx";
import { Note } from "@design-system/components/note.tsx";
import { Select, onSelect } from "@design-system/components/select.tsx";
import { AmountField, FieldRow, PropertyRow } from "@design-system/patterns/inspector.tsx";
import { Textarea } from "@design-system/components/input.tsx";

interface EditModalHostProps {
	target: { type: "scene" | "broll" | "audio" | "text"; id: number };
	/** Docked in the clip panel: render body only (panel owns the header) and
	 *  drop the large preview pane (the player already shows the frame). */
	embedded?: boolean;
	scenes: Scene[];
	videoOverlays: VideoOverlay[];
	audioOverlays: AudioOverlay[];
	overlays: TextOverlay[];
	refs: RefsState;
	/** The reference pool: workspace library + this project's roster. */
	pool: RefImage[];
	projectReferences: ProjectSelection;
	aspect: number;
	renderPreview: { storyboard: Storyboard; width: number; height: number; fps: number };
	settings: GlobalSettings;
	brand?: BrandPalette;
	/** The playhead, as a handle. Subscribed HERE rather than passed as a number
	 *  from the stage: it drives keyframe auto-key position and a live progress
	 *  readout, and the stage deliberately re-renders only when the picture
	 *  changes, so a number from up there would be stale while playing. */
	playhead?: PlayheadHandle;
	/** The docked inspector's per-property key controls for the edited text overlay. */
	keying?: RowKeying;
	/** Multi-selected text overlay ids — "Save as motion" bundles these. */
	selectionOverlayIds?: number[];
	voices: string[];
	ttsVoices: { id: string; name: string; desc: string }[];
	gen: Record<number, boolean>;
	onClose: () => void;
	onUpdScene: (id: number, f: keyof Scene, v: unknown) => void;
	onRegenScene: (id: number) => void;
	onSetSceneVisual: (id: number, url: string) => void;
	onUpdAudio: (id: number, patch: Partial<AudioOverlay>) => void;
	onUpdOverlay: (id: number, patch: Partial<TextOverlay>) => void;
	onUpdVideoOverlay: (id: number, patch: Partial<VideoOverlay>) => void;
	onRegenAudio: (id: number) => void;
	ttsBusy: Record<number, boolean>;
	onAnimateScene: (id: number) => void;
	animateBusy: Record<number, boolean>;
	onShowInChat: (label: string, ref?: ChatLogMessage["ref"]) => void;
}

const ALIGNS = ["left", "center", "right"] as const;
const TEXT_WEIGHTS = [300, 400, 500, 600, 700, 800, 900] as const;

export function EditTimelineItemModalHost(p: EditModalHostProps): JSX.Element | null {
	if (p.target.type === "scene") {
		const sc = p.scenes.find((s) => s.id === p.target.id);
		if (!sc) return null;
		const sceneStart = (() => {
			let acc = 0;
			for (const scene of p.scenes) {
				const st = scene.start ?? acc;
				if (scene.id === sc.id) return st;
				acc = st + Math.max(1, scene.dur);
			}
			return 0;
		})();
		const refPool = p.pool;
		const resolvedRefs = resolveSceneRefs(refPool, p.projectReferences, sc);
		return (
			<EditModal
				title={`Scene · ${sc.name}`}
				thumb={sc.src}
				prompt={sc.vis}
				preview={
					<div className="tl2-tpl-preview tl2-tpl-preview-exact">
						<ExactTimelinePreview
							storyboard={p.renderPreview.storyboard}
							width={p.renderPreview.width}
							height={p.renderPreview.height}
							fps={p.renderPreview.fps}
							startSec={sceneStart}
							durationSec={sc.dur}
						/>
					</div>
				}
				onChangePrompt={(v) => p.onUpdScene(sc.id, "vis", v)}
				mentionRefs={refPool}
				selectedRefIds={sc.refIds}
				onChangeRefIds={(ids) => p.onUpdScene(sc.id, "refIds", ids)}
				references={resolvedRefs}
				useGlobalReferences={sc.useGlobalReferences !== false}
				onChangeUseGlobalReferences={(checked) =>
					p.onUpdScene(sc.id, "useGlobalReferences", checked ? undefined : false)
				}
				controls={
					<Chip variant="inline">
						{Ic.film(ICON.xs)} {fmtMMSS(sc.dur)}
					</Chip>
				}
				canRegenerate
				busy={Boolean(p.gen[sc.id])}
				history={sc.history ?? []}
				onRegenerate={() => p.onRegenScene(sc.id)}
				onPickVersion={(v) => p.onSetSceneVisual(sc.id, v.url)}
				onAnimate={() => p.onAnimateScene(sc.id)}
				animating={Boolean(p.animateBusy[sc.id])}
				embedded={p.embedded}
				onShowInChat={() => p.onShowInChat(sc.name, { type: "scene", id: sc.id })}
				onClose={p.onClose}
			/>
		);
	}
	if (p.target.type === "broll") {
		const v = p.videoOverlays.find((x) => x.id === p.target.id);
		if (!v) return null;
		const ro = v.source !== "generated";
		return (
			<EditModal
				title={`Overlay · ${v.kind}`}
				thumb={v.kind === "video" ? v.url : v.thumb || v.url}
				thumbKind={v.kind}
				prompt={v.label ?? ""}
				preview={
					<div className="tl2-tpl-preview tl2-tpl-preview-exact">
						<ExactTimelinePreview
							storyboard={p.renderPreview.storyboard}
							width={p.renderPreview.width}
							height={p.renderPreview.height}
							fps={p.renderPreview.fps}
							startSec={v.start}
							durationSec={v.dur}
						/>
					</div>
				}
				onChangePrompt={(val) => p.onUpdVideoOverlay(v.id, { label: val })}
				readOnly={ro}
				readOnlyNote={
					v.source === "stock"
						? "Stock media from Pexels — uploaded, cannot edit."
						: "This item was uploaded, so you cannot edit it."
				}
				canRegenerate={false}
				history={v.gen?.history ?? []}
				onRegenerate={() => undefined}
				onPickVersion={() => undefined}
				embedded={p.embedded}
				onShowInChat={() => p.onShowInChat(v.label ?? "overlay", { type: "broll", id: v.id })}
				onClose={p.onClose}
			/>
		);
	}
	if (p.target.type === "audio") {
		const a = p.audioOverlays.find((x) => x.id === p.target.id);
		if (!a) return null;
		const isVo = a.kind === "voiceover";
		return (
			<EditModal
				title={audioKindLabel(a.kind, a.origin)}
				prompt={a.content}
				thumb={undefined}
				onChangePrompt={(val) => p.onUpdAudio(a.id, { content: val })}
				properties={
					isVo ? (
						<PropertyRow label="Voice">
							<Select
								size="xs"
								value={a.voice ?? ""}
								onValueChange={(e) => p.onUpdAudio(a.id, { voice: e || undefined })}
								aria-label={"Voice"}
								phoneBreakpoint={860}
								options={[
									{ value: "", label: "Provider default" },
									...(a.voice && !p.ttsVoices.some((v) => v.id === a.voice)
										? [{ value: a.voice, label: String(a.voice) + "— unavailable here" }]
										: []),
									...(p.ttsVoices.map((v) => ({ value: v.id, label: v.name })) ?? []),
								]}
							/>
						</PropertyRow>
					) : undefined
				}
				audioUrl={a.url}
				canRegenerate={isVo}
				busy={Boolean(p.ttsBusy[a.id])}
				history={[]}
				onRegenerate={() => p.onRegenAudio(a.id)}
				onPickVersion={() => undefined}
				embedded={p.embedded}
				onShowInChat={() =>
					p.onShowInChat(a.content.slice(0, 32) || "audio", { type: "audio", id: a.id })
				}
				onClose={p.onClose}
			/>
		);
	}
	const t = p.overlays.find((x) => x.id === p.target.id);
	if (!t) return null;
	const ts = t.style ?? defaultTextStyle(t.preset);
	const colorValue = (value: string | undefined, fallback: string): string =>
		/^#[0-9a-f]{6}$/i.test(value ?? "") ? value! : fallback;
	const template = findTextTemplate(t.preset);
	const brand = p.brand ?? DEFAULT_BRAND;
	const templateValues = textTemplateValuesFromClip(template, t.preset, t.content, t.params);
	// A motion template (has a fields schema) sizes via `scale`; a plain text
	// preset sizes via the `fontSize` px value its renderer reads directly.
	const isTemplate = Boolean(template);
	const knobs = styleKnobsFor(t.preset);
	const upd = (patch: Partial<ClipTextStyle>): void =>
		p.onUpdOverlay(t.id, { style: { ...ts, ...patch } });
	const colorRow = (
		label: string,
		value: string | undefined,
		fallback: string,
		brandColor: string,
		onSet: (v: string) => void,
	): JSX.Element => (
		<PropertyRow label={label} as="div">
			<AlphaColorControl
				display="value"
				label={label}
				value={value}
				fallback={fallback}
				brandValue={brandColor}
				brandLabel="Brand"
				onChange={onSet}
			/>
		</PropertyRow>
	);
	return (
		<EditModal
			title="Text overlay"
			prompt={t.content}
			onChangePrompt={(val) => p.onUpdOverlay(t.id, { content: val })}
			extraSections={
				<>
					<SaveAsMotionBlock
						overlays={
							p.selectionOverlayIds?.length
								? p.overlays.filter((o) => p.selectionOverlayIds!.includes(o.id))
								: [t]
						}
					/>
				</>
			}
			customContentEditor={
				template ? (
					<TemplateFieldsEditor
						fields={template.fields}
						values={templateValues ?? template.defaultParams}
						onChange={(next) => p.onUpdOverlay(t.id, { params: next })}
					/>
				) : undefined
			}
			preview={
				<div className="tl2-tpl-preview tl2-tpl-preview-exact">
					<ExactTimelinePreview
						storyboard={p.renderPreview.storyboard}
						width={p.renderPreview.width}
						height={p.renderPreview.height}
						fps={p.renderPreview.fps}
						startSec={t.start}
						durationSec={t.dur}
					/>
				</div>
			}
			properties={
				<>
					{knobs.includes("font") && (
						<PropertyRow label="Font">
							<Select
								size="xs"
								value={ts.fontFamily}
								onValueChange={(e) => upd({ fontFamily: e })}
								aria-label={"Font"}
								phoneBreakpoint={860}
								options={[...(FONT_FAMILIES.map((f) => ({ value: f, label: f })) ?? [])]}
							/>
						</PropertyRow>
					)}
					<KeyedFieldRow
						label="Size and weight"
						keying={p.keying}
						cells={[
							isTemplate ? (
								knobs.includes("scale") ? (
									<AmountField
										key="size"
										label="Size"
										short="×"
										min={0.5}
										max={2}
										step={0.05}
										value={ts.scale ?? 1}
										onChange={(scale) => upd({ scale })}
									/>
								) : null
							) : (
								{
									property: "fontSize",
									label: "Font size",
									short: "Aa",
									suffix: "px",
									min: 12,
									max: 200,
									step: 1,
									value: ts.fontSize,
									setStatic: (v) => upd({ fontSize: Math.max(12, Math.min(200, v || 12)) }),
								}
							),
							<Select
								key="weight"
								size="xs"
								aria-label="Weight"
								value={ts.weight}
								onValueChange={(e) => upd({ weight: Number(e) })}
								phoneBreakpoint={860}
								options={[...(TEXT_WEIGHTS.map((w) => ({ value: w, label: w })) ?? [])]}
							/>,
						]}
					/>
					<FieldRow label="Fill and align">
						{knobs.includes("fg") && (
							<AlphaColorControl
								display="value"
								label="Text"
								value={ts.fill}
								fallback="#ffffff"
								brandValue={brand.fgColor}
								brandLabel="Brand"
								onChange={(v) => upd({ fill: v })}
							/>
						)}
						<Select
							size="xs"
							aria-label="Align"
							value={ts.align}
							onValueChange={onSelect(ALIGNS, (align) => upd({ align }))}
							phoneBreakpoint={860}
							options={[...(ALIGNS.map((a) => ({ value: a, label: a })) ?? [])]}
						/>
					</FieldRow>
					{knobs.includes("body") &&
						colorRow("Body", ts.bodyFill, colorValue(ts.fill, "#ffffff"), brand.fgColor, (v) =>
							upd({ bodyFill: v }),
						)}
					{knobs.includes("accent") &&
						colorRow("Accent", ts.accent, "#7C66FF", brand.accentColor, (v) => upd({ accent: v }))}
					{knobs.includes("bg") && (
						<KeyedFieldRow
							label="Background"
							keying={isTemplate ? p.keying : undefined}
							cells={[
								<AlphaColorControl
									key="bg"
									display="value"
									label="Background"
									value={ts.background}
									fallback={brand.bgColor}
									brandValue={brand.bgColor}
									brandLabel="Brand"
									onChange={(v) => upd({ background: v })}
								/>,
								...(isTemplate
									? [
											{
												property: "bgOpacity" as const,
												label: "Background opacity",
												short: "α",
												suffix: "%",
												min: 0,
												max: 100,
												step: 1,
												scale: 100,
												value: ts.bgOpacity ?? 0,
												setStatic: (v: number) => upd({ bgOpacity: v }),
											},
										]
									: []),
							]}
						/>
					)}
				</>
			}
			controls={
				<>
					{knobs.includes("bg") && !isTemplate && (
						<Button variant="ghost" size="sm" onClick={() => upd({ background: "transparent" })}>
							Clear background
						</Button>
					)}
					<Button
						variant="ghost"
						size="sm"
						title="Reset all styling to the project brand"
						onClick={() => p.onUpdOverlay(t.id, { style: undefined })}
					>
						{Ic.regen(ICON.xs)} Reset to brand
					</Button>
				</>
			}
			canRegenerate={false}
			history={[]}
			onRegenerate={() => undefined}
			onPickVersion={() => undefined}
			embedded={p.embedded}
			onShowInChat={() => p.onShowInChat(t.content || "text", { type: "text", id: t.id })}
			onClose={p.onClose}
		/>
	);
}

interface EditModalProps {
	thumbKind?: "image" | "video";
	title: string;
	thumb?: string;
	prompt: string;
	onChangePrompt: (v: string) => void;
	mentionRefs?: RefImage[];
	selectedRefIds?: string[];
	onChangeRefIds?: (ids: string[]) => void;
	/** The full resolved set, not just what renders: a surface that takes only
	 *  `refs` describes a smaller cast than the operator selected. */
	references?: ResolvedSceneRefs;
	useGlobalReferences?: boolean;
	onChangeUseGlobalReferences?: (checked: boolean) => void;
	/** The selected item's own properties, as PropertyRows. */
	properties?: ReactNode;
	/** Chips and quiet actions on the action row, before Animate / Regenerate. */
	controls?: ReactNode;
	canRegenerate: boolean;
	regenNote?: string;
	busy?: boolean;
	readOnly?: boolean;
	readOnlyNote?: string;
	audioUrl?: string;
	embedded?: boolean;
	preview?: ReactNode;
	/** Replaces the freeform prompt textarea with a structured field form —
	 *  used by text templates that declare a `fields` schema (see clip-templates). */
	customContentEditor?: ReactNode;
	/** Extra editor sections rendered below the controls row (e.g. Animate). */
	extraSections?: ReactNode;
	history: GenVersion[];
	onRegenerate: () => void;
	onPickVersion: (v: GenVersion) => void;
	onAnimate?: () => void;
	animating?: boolean;
	onShowInChat: () => void;
	onClose: () => void;
}

function EditModal(p: EditModalProps): JSX.Element {
	const preview =
		p.preview ??
		(p.thumb ? (
			<div className="fc-em-thumb">
				{p.thumbKind === "video" ? (
					<video src={p.thumb} muted loop controls playsInline />
				) : (
					<img src={p.thumb} alt={p.title} />
				)}
			</div>
		) : null);
	// Rendered inside the shared top-right popover slot (same as Controls), or
	// docked in the clip panel (embedded: no own header, no bulky preview pane).
	return (
		<>
			{!p.embedded && (
				<PanelHeader density="compact" title="Edit Timeline Item" onClose={p.onClose} />
			)}
			<div className={`tl2-edititem-body fc-em-body ${p.embedded ? "fc-em-embedded" : ""}`}>
				{!p.embedded && preview && <div className="fc-em-previewpane">{preview}</div>}
				<div className="fc-em-main">
					{p.readOnly ? (
						<div className="fc-em-ro">
							<span className="fc-em-ro-tag">{p.title}</span>
							<p>{p.readOnlyNote}</p>
						</div>
					) : (
						<>
							{p.customContentEditor ? (
								p.customContentEditor
							) : p.mentionRefs ? (
								<MentionTextarea
									rows={4}
									value={p.prompt}
									selectedRefIds={p.selectedRefIds}
									refs={p.mentionRefs}
									onChange={p.onChangePrompt}
									onRefIdsChange={(ids) => p.onChangeRefIds?.(ids)}
									placeholder="Prompt / text… Type @ to use a reference"
								/>
							) : (
								<Textarea
									rows={4}
									value={p.prompt}
									onChange={(e) => p.onChangePrompt(e.target.value)}
									placeholder="Prompt / text…"
								/>
							)}
							{p.properties && <div className="fc-em-props">{p.properties}</div>}
							<div className="fc-em-controls">
								{p.controls}
								<div className="fc-em-actions">
									{p.onAnimate && (
										<Button
											variant="primary"
											size="sm"
											loading={p.animating}
											onClick={p.onAnimate}
											title="Image-to-video"
										>
											{!p.animating && Ic.video(ICON.sm)} Animate
										</Button>
									)}
									{p.canRegenerate ? (
										<Button variant="primary" size="sm" loading={p.busy} onClick={p.onRegenerate}>
											{!p.busy && Ic.regen(ICON.sm)} Regenerate
										</Button>
									) : p.regenNote ? (
										<Note tone="muted" as="span">
											{p.regenNote}
										</Note>
									) : null}
								</div>
							</div>
							{p.extraSections}
							{p.onChangeUseGlobalReferences && (
								<label className="tl2-checkrow">
									<input
										type="checkbox"
										checked={p.useGlobalReferences ?? true}
										onChange={(e) => p.onChangeUseGlobalReferences?.(e.target.checked)}
									/>
									<span>Use project references</span>
								</label>
							)}
							{p.references && (
								<div className="tl2-edit-refs">
									<div className="tl2-edit-refs-h">{Ic.image(ICON.xs)} References used</div>
									<SceneReferenceChips
										resolved={p.references}
										emptyHint="No references selected yet. Type @ and choose a reference."
									/>
								</div>
							)}
						</>
					)}
					{p.audioUrl && <AudioPreview className="fc-music-audio" src={p.audioUrl} />}
					<button className="fc-em-chatlink" onClick={p.onShowInChat}>
						{Ic.spark(ICON.xs)} Show in chat
					</button>
				</div>
			</div>
			{p.history.length > 0 && (
				<div className="fc-em-history">
					<div className="fc-em-history-h">History</div>
					<div className="fc-em-history-row">
						{p.history.map((v) => (
							<button
								key={v.id}
								className="fc-em-ver"
								onClick={() => p.onPickVersion(v)}
								title={v.prompt ?? "version"}
							>
								<img src={v.thumb || v.url} alt="version" />
							</button>
						))}
					</div>
				</div>
			)}
		</>
	);
}
