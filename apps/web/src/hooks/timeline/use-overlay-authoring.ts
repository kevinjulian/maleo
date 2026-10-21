/* Placing text and motion on the timeline.
 *
 * `addOverlay` covers the plain text presets and the RVE motion templates; the
 * per-preset layout table is here because a template's selection box has to
 * start at the visible content region rather than the full frame, or preview
 * editing targets a box the user cannot see.
 *
 * `placeComposition` places a saved Motion Studio composition as ONE clip. The
 * renderer scales its sub-overlays — and therefore every keyframe — to the
 * clip's duration, so stretching the clip stretches the whole motion
 * proportionally.
 *
 * Split out of `timeline-editor.tsx`.
 */
import type { Dispatch, SetStateAction } from "react";
import { findTextTemplate } from "@models/clip-templates/registry.ts";
import { textPresetSample } from "@models/timeline/element-catalogue.ts";
import {
	resolveFreeTrack,
	parseClipId,
	type TimelineClip,
	type TrackSpan,
} from "@models/timeline/timeline-clips.ts";
import { selectClip as selectClipIn, type Selection } from "@models/timeline/selection-model.ts";
import type { ClipLayout } from "@models/timeline/clip-layout.ts";
import type { TextOverlay, TextPreset, TemplateParams } from "@maleo/shared";
import type { PlayheadHandle } from "@models/timeline/playhead-handle.ts";
import type { CompositionConfig } from "@models/clip-templates/composition-config.ts";

export interface OverlayAuthoringInput {
	setOverlays: Dispatch<SetStateAction<TextOverlay[]>>;
	setSelection: Dispatch<SetStateAction<Selection>>;
	freeClips: TimelineClip[];
	selectedFreeIds: Set<string>;
	playhead: PlayheadHandle;
	total: number;
}

export interface OverlayAuthoring {
	addOverlay: (
		at?: number,
		track?: number,
		preset?: TextPreset,
		paramsOverride?: TemplateParams,
	) => void;
	placeComposition: (
		config: CompositionConfig,
		label?: string,
		atOverride?: number,
		trackOverride?: number,
	) => void;
	/** Text overlays currently multi-selected, which Save-as-motion bundles. */
	selectionOverlayIds: number[];
}

export function useOverlayAuthoring({
	setOverlays,
	setSelection,
	freeClips,
	selectedFreeIds,
	playhead,
	total,
}: OverlayAuthoringInput): OverlayAuthoring {
	// ── Text overlays (free-form, on their own track) ──
	/* A `motion-comp` overlay is the one preset whose `params` hold a composition
	 * BUNDLE rather than field values — `StoryboardReel` reads them straight back
	 * as a `CompositionOverlayConfig`. The bundle is JSON, which is what
	 * `TemplateParams` describes, but its declared type carries `unknown`
	 * passthroughs for style/layout/anim so the two do not unify.
	 *
	 * Isolated here so the claim is made once. Modelling it properly means
	 * discriminating `TextOverlay` on its preset, which is a document change. */
	const compositionParams = (config: CompositionConfig): TemplateParams =>
		// SAFETY: as above — the bundle was parsed from JSON and is written back as
		// JSON; only its declared passthrough fields stop the types unifying.
		JSON.parse(JSON.stringify(config)) as TemplateParams;

	const addOverlay = (
		at?: number,
		track?: number,
		preset: TextPreset = "plain",
		paramsOverride?: TemplateParams,
	): void => {
		const id = Date.now();
		const isRve = preset.startsWith("rve-") || preset.startsWith("shape-");
		const template = findTextTemplate(preset);
		const motionLayout: ClipLayout =
			preset === "rve-lower-third" || preset === "rve-typewriter-subtitle"
				? { xPct: 8, yPct: 66, widthPct: 84, heightPct: 22, fit: "contain" }
				: preset === "rve-end-card" ||
					  preset === "rve-quote-card" ||
					  preset === "rve-countdown-intro"
					? { xPct: 8, yPct: 24, widthPct: 84, heightPct: 52, fit: "contain" }
					: preset === "shape-rect"
						? { xPct: 30, yPct: 42, widthPct: 40, heightPct: 16, fit: "contain" }
						: preset === "shape-circle"
							? { xPct: 40, yPct: 40, widthPct: 20, heightPct: 20, fit: "contain" }
							: { xPct: 8, yPct: 18, widthPct: 84, heightPct: 34, fit: "contain" };
		const start = at ?? Math.max(0, Math.min(playhead.get(), Math.max(0, total - 2)));
		const dur = isRve ? 3 : 2;
		const occupied: TrackSpan[] = freeClips.map((c) => ({
			start: c.start,
			dur: c.dur,
			track: c.track,
		}));
		const resolvedTrack = resolveFreeTrack(occupied, { start, dur }, track ?? 0);
		setOverlays((o) => [
			...o,
			{
				id,
				content: textPresetSample(preset),
				start,
				dur,
				preset,
				// Motion templates carry no style overrides. Their selection box starts
				// at the visible content region, not the full frame, so preview editing
				// targets the object users see.
				...(template
					? { params: { ...template.defaultParams, ...paramsOverride }, layout: motionLayout }
					: paramsOverride
						? { params: { ...paramsOverride }, layout: motionLayout }
						: preset === "plain"
							? { layout: motionLayout }
							: {}),
				track: resolvedTrack,
			},
		]);
		setSelection(selectClipIn("text", id));
	};
	// Motion Studio: place a saved composition as ONE clip. The renderer scales
	// its sub-overlays (and therefore every keyframe) to the clip's duration, so
	// stretching the clip stretches the whole motion proportionally.
	const placeComposition = (
		config: CompositionConfig,
		label?: string,
		atOverride?: number,
		trackOverride?: number,
	): void => {
		const at = atOverride ?? Math.max(0, Math.min(playhead.get(), Math.max(0, total - 1)));
		const dur = Math.max(0.5, config.spanSec || 3);
		const id = Date.now();
		const occupied: TrackSpan[] = freeClips.map((c) => ({
			start: c.start,
			dur: c.dur,
			track: c.track,
		}));
		setOverlays((o) => [
			...o,
			{
				id,
				content: label ?? "Motion",
				start: at,
				dur,
				preset: "motion-comp",
				track: resolveFreeTrack(occupied, { start: at, dur }, trackOverride ?? 0),
				layout: { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100, fit: "contain" },
				params: compositionParams(config),
			},
		]);
		setSelection(selectClipIn("text", id));
	};
	// Text overlays currently multi-selected on the timeline ("text:ID" ids) —
	// the overlay editor's Save-as-motion bundles these.
	const selectionOverlayIds = [...selectedFreeIds]
		.map(parseClipId)
		.filter((c): c is NonNullable<ReturnType<typeof parseClipId>> => c?.source === "text")
		.map((c) => c.refId);
	return { addOverlay, placeComposition, selectionOverlayIds };
}
