/* Placing text and motion on the timeline.
 *
 * `addOverlay` places plain text and shape primitives. Initial layout matches
 * the visible content region so preview selection targets the authored object.
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
import {
	compositionParams,
	type TextOverlay,
	type TextPreset,
	type TemplateParams,
} from "@maleo/shared";
import type { PlayheadHandle } from "@models/timeline/playhead-handle.ts";
import type { CompositionConfig } from "@models/clip-templates/composition-config.ts";
import { initialShapeLayout } from "@models/timeline/shape-elements.ts";

export interface OverlayAuthoringInput {
	setOverlays: Dispatch<SetStateAction<TextOverlay[]>>;
	setSelection: Dispatch<SetStateAction<Selection>>;
	freeClips: TimelineClip[];
	selectedFreeIds: Set<string>;
	playhead: PlayheadHandle;
	total: number;
	aspect: number;
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
	aspect,
}: OverlayAuthoringInput): OverlayAuthoring {
	// ── Text overlays (free-form, on their own track) ──

	const addOverlay = (
		at?: number,
		track?: number,
		preset: TextPreset = "plain",
		paramsOverride?: TemplateParams,
	): void => {
		const id = Date.now();
		const template = findTextTemplate(preset);
		const motionLayout: ClipLayout = initialShapeLayout(preset, aspect) ?? {
			xPct: 8,
			yPct: 18,
			widthPct: 84,
			heightPct: 34,
			fit: "contain",
		};
		const start = at ?? Math.max(0, Math.min(playhead.get(), Math.max(0, total - 2)));
		const dur = 2;
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
				// Primitive layout is explicit so preview selection matches its content.
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
