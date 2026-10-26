import { shapePrimitiveOf } from "@maleo/shared";
/* Maleo — Content-First Create · clip-first timeline video editor.
 *
 * Layout (left → right): a global icon rail, a global library/project panel,
 * then the preview stage with the timeline docked beneath it. Editing a single
 * scene happens ONLY in the right-hand scene drawer, opened by double-clicking a
 * video clip. The left side is never scene-scoped — it edits shared assets.
 *
 * Canonical scene fields (src / vo / sfx / dur) drive everything; the timeline's
 * video / voiceover / music clips are derived projections (see normalizeSceneClips). */
import { usePreviewFrame } from "@hooks/timeline/use-preview-frame.ts";
import { useMemo, useState } from "react";
import type { JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { PanelHeader } from "@design-system/patterns/panel-header.tsx";
import { ML } from "@design-system/components/field-label.tsx";
import { STUDIO_TRANSITIONS, EFFECT_DEFS } from "@models/timeline/editor-media.ts";
import type { TemplateItem } from "@models/clip-templates/registry.ts";
import type { TemplateParams, EffectKind, Scene, TextPreset, TransitionType } from "@maleo/shared";
import { compositionConfigSchema } from "@maleo/shared";

// Font family choices for the text/motion edit popover. Kept small and
// web-safe-ish so the picker stays scannable.
export const FONT_FAMILIES = [
	"Inter",
	"Poppins",
	"Georgia",
	"Playfair Display",
	"Arial",
	"Roboto Mono",
	"Courier New",
] as const;
export type { TemplateCategory } from "@models/clip-templates/registry.ts";
import type { ClipTextStyle } from "@models/timeline/clip-layout.ts";
import { Player } from "@remotion/player";
import { Sequence } from "remotion";
import { StoryboardReel, storyboardSeconds, type Storyboard } from "@maleo/video/composition";
import { absolutizeStoryboard } from "@models/storyboard/storyboard-mapper.ts";

// Free-clip row height in px (lane height + gap) — keeps drag Y → track in sync
// with the lane CSS (--tl2-lane-h 46 + --tl2-lane-gap 6).
/* The timeline cluster's stylesheet has exactly one importer, and it is this
 * module rather than timeline-editor.tsx: presets-library.tsx imports from
 * here while the timeline editor is not mounted, so owning the sheet at the
 * editor would leave that surface unstyled. Every consumer reaches this file. */
import "./timeline.css";

export type ToggleCat = "image" | "voice" | "note";
/* The built-in text preset lists moved to models/timeline/element-catalogue.ts,
 * so Library > Elements can read them without importing this editor panel. They
 * are re-exported here because this module's path is the one the rail and the
 * tests already import them from. */
import { TEXT_PRESET_LABELS, TEXT_PRESET_OPTIONS } from "@models/timeline/element-catalogue.ts";
export { TEXT_PRESET_OPTIONS, TEXT_PRESET_LABELS };

// The brand palette lives in its own module.
import { DEFAULT_BRAND, type BrandPalette } from "@models/timeline/panel-brand.ts";
import { Button } from "@design-system/components/button.tsx";
import { Input } from "@design-system/components/input.tsx";

/* Explicit still frames and reduced-motion preferences show an arrived preview.
 * Normal catalogue browsing uses the production Player's autoplay loop. */
export function TextPresetPreview({
	preset,
	content,
	params,
	style,
	brand = DEFAULT_BRAND,
	renderAspect,
	still,
	compact = false,
}: {
	preset: TextPreset;
	content: string;
	params?: TemplateParams;
	style?: ClipTextStyle;
	brand?: BrandPalette;
	renderAspect?: number;
	still?: number;
	compact?: boolean;
}): JSX.Element {
	const previewFrame = usePreviewFrame(still);
	const composition = useMemo(
		() => (preset === "motion-comp" ? compositionConfigSchema.parse(params) : null),
		[preset, params],
	);
	const durationSec = composition?.spanSec ?? 4;
	const durationInFrames = Math.max(1, Math.floor(durationSec * 30));
	const compositionWidth = renderAspect && renderAspect < 1 ? 720 : 1280;
	const compositionHeight = renderAspect ? Math.round(compositionWidth / renderAspect) : 640;
	const storyboard = useMemo(
		(): Storyboard => ({
			scenes: [
				{
					image: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
					durationSec,
					label: "",
					movement: "Static",
					transition: "cut",
					voiceover: "",
					visual: "",
					camera: "",
					vignette: false,
					grain: false,
				},
			],
			accentColor: brand.accentColor,
			bgColor: brand.bgColor,
			fgColor: brand.fgColor,
			musicMood: "minimal",
			showLabels: false,
			hideBase: true,
			muteBase: true,
			textOverlays: [
				{
					content,
					startSec: 0,
					durationSec,
					preset,
					params,
					style,
					track: 0,
					layout:
						preset === "motion-comp"
							? { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 }
							: preset === "shape-rect"
								? { xPct: 20, yPct: 35, widthPct: 60, heightPct: 30 }
								: shapePrimitiveOf(preset)
									? { xPct: 30, yPct: 10, widthPct: 40, heightPct: 80 }
									: {
											xPct: 8,
											yPct: 12,
											widthPct: 84,
											fit: "contain",
										},
				},
			],
			audioOverlays: [],
			videoOverlays: [],
			effects: [],
		}),
		[content, preset, params, style, brand.accentColor, brand.bgColor, brand.fgColor, durationSec],
	);
	return (
		<span
			className={compact ? "tl2-element-preview" : "fc-data-preview fc-text-preview"}
			aria-hidden
		>
			<Player
				key={previewFrame ?? "loop"}
				component={StoryboardReel}
				inputProps={storyboard}
				durationInFrames={durationInFrames}
				compositionWidth={compositionWidth}
				compositionHeight={compositionHeight}
				fps={30}
				initiallyMuted
				numberOfSharedAudioTags={0}
				initialFrame={
					previewFrame === undefined ? undefined : Math.min(previewFrame, durationInFrames - 1)
				}
				autoPlay={previewFrame === undefined}
				loop={previewFrame === undefined}
				style={{ width: "100%", height: "100%" }}
				acknowledgeRemotionLicense
			/>
		</span>
	);
}

type SegmentPreviewStoryboard = Storyboard & { previewStartFrame: number };

function SegmentStoryboardReel({
	previewStartFrame,
	...storyboard
}: SegmentPreviewStoryboard): JSX.Element {
	return (
		<Sequence from={-previewStartFrame}>
			<StoryboardReel {...storyboard} />
		</Sequence>
	);
}

export function ExactTimelinePreview({
	storyboard,
	width,
	height,
	fps,
	startSec,
	durationSec,
}: {
	storyboard: Storyboard;
	width: number;
	height: number;
	fps: number;
	startSec: number;
	durationSec: number;
}): JSX.Element {
	const fullDuration = Math.max(1, Math.ceil(storyboardSeconds(storyboard) * fps));
	const startFrame = Math.max(0, Math.min(fullDuration - 1, Math.round(startSec * fps)));
	const clipFrames = Math.max(
		1,
		Math.min(fullDuration - startFrame, Math.ceil(Math.max(0.1, durationSec) * fps)),
	);
	const inputProps: SegmentPreviewStoryboard = {
		...absolutizeStoryboard(storyboard),
		previewStartFrame: startFrame,
	};
	return (
		<span
			className="fc-data-preview fc-text-preview"
			style={{ aspectRatio: `${width} / ${height}` }}
			aria-hidden
		>
			<Player
				key={`${startFrame}:${clipFrames}:${width}:${height}`}
				component={SegmentStoryboardReel}
				inputProps={inputProps}
				durationInFrames={clipFrames}
				compositionWidth={width}
				compositionHeight={height}
				fps={fps}
				autoPlay
				loop
				style={{ width: "100%", height: "100%" }}
				acknowledgeRemotionLicense
			/>
		</span>
	);
}

type TextTemplateItem = Extract<TemplateItem, { kind: "text" }>;

export function textTemplateValuesFromClip(
	template: TextTemplateItem | undefined,
	params?: TemplateParams,
): TemplateParams | undefined {
	return template ? { ...template.defaultParams, ...params } : params;
}

/* ════════ Transitions panel (apply to the selected scene) ════════ */

// One distinguishing glyph per transition so tiles are scannable at a glance.
const TRANSITION_GLYPHS: Record<string, JSX.Element> = {
	cut: Ic.cut(ICON.md),
	fade: Ic.blend(ICON.md),
	slide: Ic.arrowRightFromLine(ICON.md),
	zoom: Ic.zoomIn(ICON.md),
	wipe: Ic.splitHorizontal(ICON.md),
	flip: Ic.flipHorizontal(ICON.md),
	clock_wipe: Ic.timer(ICON.md),
	pixel: Ic.grid3(ICON.md),
};

export function TransitionPreview({
	type,
	leftSrc,
	rightSrc,
}: {
	type: string;
	leftSrc?: string;
	rightSrc?: string;
}): JSX.Element {
	return (
		<span className={`fc-trans-preview ${type.replace(/_/g, "-")}`} aria-hidden>
			<span
				className="fc-trans-frame fc-trans-a"
				style={leftSrc ? { backgroundImage: `url(${leftSrc})` } : undefined}
			/>
			<span
				className="fc-trans-frame fc-trans-b"
				style={rightSrc ? { backgroundImage: `url(${rightSrc})` } : undefined}
			/>
			<span className="fc-trans-split" />
		</span>
	);
}

export function TransitionsPanel({
	active,
	activeType,
	canApply,
	targetName,
	previewFrames,
	onApply,
	onClose,
}: {
	active?: Scene;
	activeType?: TransitionType;
	canApply?: boolean;
	targetName?: string;
	previewFrames?: { left?: string; right?: string };
	onApply: (t: TransitionType) => void;
	onClose: () => void;
}): JSX.Element {
	const enabled = canApply ?? Boolean(active);
	const label = targetName ?? active?.name;
	return (
		<>
			<PanelHeader density="tool" title="Transitions" onClose={onClose} closeLabel="Hide panel" />
			<div className="tl2-panel-body">
				<p className="fc-cap-desc">Preview and apply transition{label ? ` — ${label}` : ""}.</p>
				<div className="fc-tiles">
					{STUDIO_TRANSITIONS.map((t) => (
						<button
							key={t}
							className={`fc-tile fc-trans-tile ${(activeType ?? active?.transition) === t ? "on" : ""}`}
							disabled={!enabled}
							onClick={() => onApply(t)}
							title={
								enabled
									? `Preview and apply ${t.replace(/_/g, " ")}`
									: "Select a scene or visual clip first"
							}
						>
							<TransitionPreview
								type={t}
								leftSrc={previewFrames?.left}
								rightSrc={previewFrames?.right}
							/>
							<span className="fc-trans-label">
								<span className="fc-tile-ic">{TRANSITION_GLYPHS[t] ?? Ic.link(ICON.md)}</span>
								<span>{t.replace(/_/g, " ")}</span>
							</span>
						</button>
					))}
				</div>
			</div>
		</>
	);
}

/* ════════ Effects panel (add an effect clip at the playhead) ════════ */
export function EffectsPanel({
	onAdd,
	onAutoInterrupts,
	onClose,
}: {
	onAdd: (k: EffectKind) => void;
	onAutoInterrupts?: (intervalSec: number) => void;
	onClose: () => void;
}): JSX.Element {
	const [intervalSec, setIntervalSec] = useState(4);
	return (
		<>
			<PanelHeader density="tool" title="Effects" onClose={onClose} closeLabel="Hide panel" />
			<div className="tl2-panel-body">
				<p className="fc-cap-desc">
					Click to add an effect at the playhead. It plays in the preview and renders on export.
				</p>
				<div className="tl2-fxlist">
					{EFFECT_DEFS.map((e) => (
						<button key={e.kind} className="tl2-fxbtn" onClick={() => onAdd(e.kind)}>
							<b>{e.label}</b>
							<em>{e.desc}</em>
						</button>
					))}
				</div>
				{onAutoInterrupts && (
					<div style={{ display: "grid", gap: 8, marginTop: 14 }}>
						<ML>Pattern interrupts</ML>
						<p className="fc-cap-desc">
							Auto-inject an attention reset (zoom punch / flash / whip) at a fixed cadence — skips
							spots that already have one.
						</p>
						<div style={{ display: "flex", gap: 6, alignItems: "center" }}>
							<span style={{ fontSize: 12 }}>Every</span>
							<Input
								style={{ width: 56 }}
								type="number"
								min={2}
								max={10}
								step={1}
								value={intervalSec}
								onChange={(e) =>
									setIntervalSec(Math.max(2, Math.min(10, Number(e.target.value) || 4)))
								}
							/>
							<span style={{ fontSize: 12 }}>sec</span>
							<Button variant="primary" size="sm" onClick={() => onAutoInterrupts(intervalSec)}>
								{Ic.spark(ICON.xs)} Inject
							</Button>
						</div>
					</div>
				)}
			</div>
		</>
	);
}

/* ════════ Scene editor drawer (right · scene-scoped) ════════ */
