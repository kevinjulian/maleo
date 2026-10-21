/* The studio's own lane shape, declared here.
 *
 * It was the library's `VuiLane`/`VuiRange` — a consumer schema the library
 * carried so that a consumer could hand its document back to it. The library
 * reads a document through an adapter now and never owns one, so this is the
 * studio's structure and belongs beside the studio. */

/** One bar, and the nested property tracks a layer carries. */
export interface MotionLaneRange {
	id: string;
	laneId: string;
	label: string;
	startSec: number;
	durationSec: number;
	readOnly?: boolean;
	selected?: boolean;
	children?: MotionLaneRange[];
}

/** One row of the studio's timeline. */
export interface MotionLane {
	id: string;
	label: string;
	group?: string;
	ranges: MotionLaneRange[];
}
import type { AnimatableProp, ColorAnimatableProp, CompositionLayer } from "@maleo/shared";
import { keysOf, RENDER_FPS } from "@maleo/shared";
import { StoryboardReel, type Storyboard } from "@maleo/video/composition";
import { studioBaseStoryboard } from "@models/timeline/studio-base-storyboard.ts";

const VALUE_LABEL = {
	x: "X %",
	y: "Y %",
	scale: "Scale",
	rotate: "Rotate",
	opacity: "Opacity",
	width: "Width",
	height: "Height",
	blur: "Blur",
	bgOpacity: "BG opacity",
	fontSize: "Font size",
	letterSpacing: "Tracking",
	lineHeight: "Line height",
} satisfies Record<AnimatableProp, string>;
const COLOR_LABEL = {
	fill: "Text",
	bodyFill: "Body",
	accent: "Accent",
	background: "Background",
} satisfies Record<ColorAnimatableProp, string>;

export type MotionStudioTrack =
	| { kind: "value"; prop: AnimatableProp }
	| { kind: "color"; prop: ColorAnimatableProp };

export type MotionMarkSelection = MotionStudioTrack & { layerId: number; index: number };

export interface MotionTrackMarker {
	id: string;
	timeSec: number;
	label: string;
	selected: boolean;
}

export const MOTION_PREVIEW_FPS = RENDER_FPS;

export interface MotionRendererProps {
	component: typeof StoryboardReel;
	inputProps: Storyboard;
	durationInFrames: number;
	compositionWidth: number;
	compositionHeight: number;
	fps: number;
}

export interface MotionSaveInput {
	name: string;
	layers: CompositionLayer[];
	templateId: string | undefined;
}

export function buildMotionSaveInput(
	name: string,
	layers: CompositionLayer[],
	templateId?: string,
): MotionSaveInput | null {
	const trimmed = name.trim();
	if (!trimmed || layers.length === 0) return null;
	return { name: trimmed, layers, templateId };
}

export async function persistMotionSave(
	input: MotionSaveInput,
	save: (name: string, layers: CompositionLayer[], templateId?: string) => Promise<unknown>,
): Promise<void> {
	await save(input.name, input.layers, input.templateId);
}

/** Stable web adapter from Motion domain state to renderer-neutral preview props. */
export function buildMotionRendererProps(
	layers: CompositionLayer[],
	durationSec: number,
	aspect: number,
	brand: { accentColor: string; bgColor: string; fgColor: string },
): MotionRendererProps {
	const width = aspect < 1 ? 720 : 1280;
	return {
		component: StoryboardReel,
		inputProps: studioBaseStoryboard({
			durationSec,
			accentColor: brand.accentColor,
			bgColor: brand.bgColor,
			fgColor: brand.fgColor,
			textOverlays: layers.map((layer) => ({
				content: layer.content,
				startSec: layer.start,
				durationSec: layer.dur,
				preset: layer.preset,
				track: layer.track ?? 0,
				layout: layer.layout,
				style: layer.style,
				params: layer.params,
				anim: layer.anim ?? undefined,
			})),
		}),
		durationInFrames: Math.max(1, Math.round(durationSec * MOTION_PREVIEW_FPS)),
		compositionWidth: width,
		compositionHeight: Math.round(width / aspect),
		fps: MOTION_PREVIEW_FPS,
	};
}

/** Domain-owned list of animated property tracks rendered through VUI slots. */
export function motionAnimatedTracks(layer: CompositionLayer): MotionStudioTrack[] {
	return [
		...keysOf(layer.anim?.tracks ?? {})
			.filter((prop) => (layer.anim?.tracks[prop]?.length ?? 0) > 0)
			.map((prop) => ({ kind: "value" as const, prop })),
		...keysOf(layer.anim?.colorTracks ?? {})
			.filter((prop) => (layer.anim?.colorTracks?.[prop]?.length ?? 0) > 0)
			.map((prop) => ({ kind: "color" as const, prop })),
	];
}

export function motionTrackLabel(track: MotionStudioTrack): string {
	return track.kind === "value" ? VALUE_LABEL[track.prop] : COLOR_LABEL[track.prop];
}

const isValueProp = (value: string | undefined): value is AnimatableProp =>
	value !== undefined && keysOf(VALUE_LABEL).some((candidate) => candidate === value);
const isColorProp = (value: string | undefined): value is ColorAnimatableProp =>
	value !== undefined && keysOf(COLOR_LABEL).some((candidate) => candidate === value);

export function parseMotionTrackRow(rowId: string): MotionStudioTrack | null {
	const separator = rowId.lastIndexOf(":");
	if (separator < 0) return null;
	const [kind, prop] = rowId.slice(separator + 1).split("-");
	if (kind === "value" && isValueProp(prop)) return { kind, prop };
	if (kind === "color" && isColorProp(prop)) return { kind, prop };
	return null;
}

export function motionLayerIdFromRow(rowId: string): number | null {
	const layerKey = rowId.slice(0, rowId.indexOf(":") >= 0 ? rowId.indexOf(":") : rowId.length);
	if (!layerKey.startsWith("layer-")) return null;
	const id = Number(layerKey.slice("layer-".length));
	return Number.isFinite(id) ? id : null;
}

export function motionTrackMarkers(
	layer: CompositionLayer,
	track: MotionStudioTrack,
	selected: MotionMarkSelection | null,
): MotionTrackMarker[] {
	const keyframes =
		track.kind === "value" ? layer.anim?.tracks[track.prop] : layer.anim?.colorTracks?.[track.prop];
	return (keyframes ?? []).map((keyframe, index) => ({
		id: `${layer.id}:${track.kind}-${track.prop}-${index}`,
		timeSec: keyframe.t * layer.dur,
		label: `${motionTrackLabel(track)} keyframe ${index + 1}`,
		selected:
			selected?.layerId === layer.id &&
			selected.kind === track.kind &&
			selected.prop === track.prop &&
			selected.index === index,
	}));
}

/** Move one keyframe without reordering its track. Input remains untouched. */
export function shiftMotionKeyframe<K extends { t: number }>(
	keyframes: ReadonlyArray<K>,
	index: number,
	normalizedTime: number,
): K[] | null {
	if (!keyframes[index]) return null;
	const low = index > 0 ? keyframes[index - 1]!.t + 0.001 : 0;
	const high = index < keyframes.length - 1 ? keyframes[index + 1]!.t - 0.001 : 1;
	return keyframes.map((keyframe, current) =>
		current === index
			? { ...keyframe, t: Math.max(low, Math.min(high, normalizedTime)) }
			: keyframe,
	);
}

/** Project Motion Studio's domain model into VUI's nested lane contract. */
export function buildMotionVuiLanes(layers: CompositionLayer[]): MotionLane[] {
	const ranges: MotionLaneRange[] = layers.map((layer) => {
		const children: MotionLaneRange[] = motionAnimatedTracks(layer).map((track) => ({
			id: `layer-${layer.id}:${track.kind}-${track.prop}`,
			laneId: "motion",
			label: motionTrackLabel(track),
			startSec: layer.start,
			durationSec: layer.dur,
			readOnly: true,
		}));
		return {
			id: `layer-${layer.id}`,
			laneId: "motion",
			label: layer.content || `Layer ${layer.id}`,
			startSec: layer.start,
			durationSec: layer.dur,
			children,
		};
	});
	return [{ id: "motion", label: "Motion layers", group: "motion", ranges }];
}
