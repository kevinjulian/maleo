/* The inspector rules the engine owns (`p1-envelope-inspector` design I1–I3),
 * typed. `crates/app-core` holds the rules; each call here crosses
 * `inspector_apply` once and throws when the engine refuses the input, which
 * only a caller bug can cause. Labels, icons and layout stay with the caller.
 * `InspectorOps` is the one contract: each op's input and answer, as
 * `crates/app-core/src/ops.rs` reads and writes them. */
import type {
	AnimationElementKind,
	AnimationProperty,
	KeyframeEasing,
	NumericAnimationProperty,
} from "../animation-properties.ts";
import type { Animation } from "../clip-animation.ts";
import type {
	ClipKind,
	ClipLayout,
	ClipTextStyle,
	ColorKeyframe,
	ValueKeyframe,
} from "../timeline-model.ts";
import type { EditorCommand } from "./commands.ts";
import type { Engine } from "./engine.ts";
import { editorEngine } from "./engine-registry.ts";

type AnimationKey = ValueKeyframe | ColorKeyframe;
type Values = Partial<Record<NumericAnimationProperty, number>>;

export interface FocalPoint {
	xPct: number;
	yPct: number;
}

export interface GroupOptions {
	videoHasAudio?: boolean;
	sceneHasVideo?: boolean;
}

/** Any clip or overlay the inspector can key; a scene names the visual it keys. */
export type AnimationTarget =
	| { source: "scene"; id: number; visualId: string }
	| { source: "video" | "audio" | "text"; id: number };

/** What the inspector reads of a target's keys. */
export interface KeyTargetView {
	kind: AnimationElementKind;
	animation: Animation | undefined;
	duration: number;
	locked: boolean;
}

/** What the inspector reads of an animation target. */
export interface ClipAnimationInfo {
	id: string;
	kind: AnimationElementKind;
	start: number;
	duration: number;
	animation: Animation | undefined;
	values: Values;
	properties: NumericAnimationProperty[];
	locked: boolean;
	audio: boolean;
	hasVolume: boolean;
}

/** One moment on a clip: key times within a frame of each other, across every track. */
export interface KeyMoment {
	time: number;
	properties: AnimationProperty[];
}

/** A row's key state at the playhead. */
export interface RowState {
	time: number;
	animated: boolean;
	keyed: boolean;
	toggleDisabled: boolean;
	valueDisabled: boolean;
	values: Values;
}

export type EdgePresetName = "none" | "fade" | "slide" | "zoom";

/** An edge ramp the engine recognizes. */
export interface EdgeRamp {
	preset: EdgePresetName;
	property: NumericAnimationProperty;
	duration: number;
	pair: ValueKeyframe[];
}

/** The selection fields that decide an animation target. */
export interface TargetSelection {
	sceneId?: number;
	overlayId: number | null;
	audioId: number | null;
	videoOverlayId: number | null;
}

/** An edit's answer: its command, or the refusal a controller shows. */
export interface EditAnswer {
	command?: EditorCommand;
	error?: string;
}

interface EdgeInput {
	animation: Animation | null;
	edge: "in" | "out";
	duration: number;
	values: Values;
	audio: boolean;
}
interface RowInput {
	target: AnimationTarget;
	properties: readonly NumericAnimationProperty[];
	absolute: number;
	fps: number;
}
interface TargetInput {
	target: AnimationTarget;
}
interface Rect {
	left: number;
	top: number;
	width: number;
	height: number;
}

/** Each op's input and answer. */
export interface InspectorOps {
	"fader.gain": [{ pct: number }, number];
	"fader.position": [{ gain: number }, number];
	"fader.rangeDb": [Record<never, never>, number];
	"gain.fromDb": [{ db: number }, number];
	"gain.db": [{ gain: number }, number | null];
	"gain.label": [{ gain: number }, string];
	"focal.at": [{ clientX: number; clientY: number; rect: Rect }, FocalPoint];
	"focal.nudge": [{ point: FocalPoint | null; key: string }, FocalPoint | null];
	groups: [{ kind: string; options: GroupOptions }, string[]];
	"groups.active": [{ groups: readonly string[]; remembered: string }, string];
	"groups.options": [
		{ videoOverlayKind: string | null; sceneVisualKinds: readonly string[] },
		Required<GroupOptions>,
	];
	subject: [
		{
			videoOverlay: { id: number | null } | null;
			audio: { id: number | null } | null;
			text: { preset: string | null } | null;
			effectId: number | null;
			transitionId: number | null;
			scene: { id: number | null } | null;
		},
		{ kind: string; clipId?: string } | null,
	];
	"layout.normalize": [{ kind: ClipKind; layout?: Partial<ClipLayout> }, ClipLayout];
	"text.defaultStyle": [{ preset?: string }, ClipTextStyle];
	"keys.near": [{ keys: readonly { t: number }[]; time: number; snap?: number }, number];
	"keys.upsert": [
		{
			keys: readonly { t: number }[];
			time: number;
			value: unknown;
			easing?: KeyframeEasing;
			snap?: number;
		},
		AnimationKey[],
	];
	"keys.target": [{ id: string }, KeyTargetView | null];
	"keys.error": [{ id: string; property: string; keys: readonly AnimationKey[] }, string | null];
	"anim.target.forId": [{ id: string }, AnimationTarget | null];
	"anim.target.selected": [
		{ selection: TargetSelection; choice: { sceneId: number; visualId: string } | null },
		AnimationTarget | null,
	];
	/* A scene target may omit its visual here: the clip id then names the scene. */
	"anim.clipId": [
		{ target: { source: AnimationTarget["source"]; id: number; visualId?: string } },
		string,
	];
	"anim.info": [TargetInput, ClipAnimationInfo | null];
	"anim.key.edit": [
		TargetInput & {
			property: NumericAnimationProperty;
			time: number;
			value?: number;
			easing?: KeyframeEasing;
		},
		EditAnswer,
	];
	"anim.key.remove": [
		TargetInput & { property: NumericAnimationProperty; index: number },
		EditAnswer,
	];
	"anim.key.move": [
		TargetInput & { property: NumericAnimationProperty; index: number; time: number },
		EditAnswer,
	];
	"anim.moments": [{ animation: Animation | null }, KeyMoment[]];
	"anim.moments.move": [TargetInput & { times: readonly number[]; delta?: number }, EditAnswer];
	"anim.moment.move": [TargetInput & { from: number; to?: number }, EditAnswer];
	"anim.moments.easing": [
		TargetInput & {
			times: readonly number[];
			easing: KeyframeEasing;
			property?: AnimationProperty;
		},
		EditAnswer,
	];
	"anim.moment.easings": [{ animation: Animation | null; time: number }, KeyframeEasing[]];
	"anim.paste": [TargetInput & { clipboard: Animation }, EditAnswer];
	"anim.edge": [
		TargetInput & { edge: "in" | "out"; preset: EdgePresetName; seconds: number },
		EditAnswer,
	];
	"anim.edge.ramp": [EdgeInput, EdgeRamp | null];
	"anim.edge.state": [EdgeInput, EdgePresetName | "custom"];
	"anim.edge.tracks": [
		EdgeInput & { preset: EdgePresetName; seconds: number },
		{ tracks?: Partial<Record<NumericAnimationProperty, ValueKeyframe[]>>; error?: string },
	];
	"anim.row": [RowInput, RowState | null];
	"anim.row.toggle": [RowInput, EditAnswer | null];
	"anim.row.set": [RowInput & { values: Values }, EditAnswer | null];
}

/** One op on the document `doc` names (0 for a stateless op). */
export function inspectorOp<K extends keyof InspectorOps>(
	op: K,
	input: InspectorOps[K][0],
	doc = 0,
	engine: Engine = editorEngine(),
): InspectorOps[K][1] {
	const result = engine.inspectorApply(doc, JSON.stringify({ ...input, op }));
	if (!result.ok) throw new Error(`inspector rule ${op}: ${result.error.message}`);
	// SAFETY: `crates/app-core/src/ops.rs` answers each op with the shape `InspectorOps` names.
	return JSON.parse(result.value) as InspectorOps[K][1];
}

export const gainFromFader = (pct: number): number => inspectorOp("fader.gain", { pct });
/** How far below unity the bottom of the fader sits, in decibels. */
export const faderRangeDb = (): number => inspectorOp("fader.rangeDb", {});
/** The amplitude `db` decibels below unity produces, as the gain key row writes it. */
export const gainFromDb = (db: number): number => inspectorOp("gain.fromDb", { db });
export const faderFromGain = (gain: number): number => inspectorOp("fader.position", { gain });
/** `-Infinity` when silent: the engine answers `null`, since JSON has no infinity. */
export const dbFromGain = (gain: number): number =>
	inspectorOp("gain.db", { gain }) ?? Number.NEGATIVE_INFINITY;
export const formatGainDb = (gain: number): string => inspectorOp("gain.label", { gain });

export const focalPointAt = (clientX: number, clientY: number, rect: Rect): FocalPoint =>
	inspectorOp("focal.at", {
		clientX,
		clientY,
		rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
	});
export const nudgeFocalPoint = (
	point: FocalPoint | null | undefined,
	key: string,
): FocalPoint | null => inspectorOp("focal.nudge", { point: point ?? null, key });

/** The group keys a clip kind offers, in order. */
export const propertyGroupKeys = (kind: string, options: GroupOptions = {}): string[] =>
	inspectorOp("groups", { kind, options });
/** The remembered group when `groups` holds it, else the first; `content` when empty. */
export const activeGroupKey = (groups: readonly string[], remembered: string): string =>
	inspectorOp("groups.active", { groups, remembered });
export const groupOptions = (
	videoOverlayKind: string | undefined,
	sceneVisualKinds: readonly string[],
): Required<GroupOptions> =>
	inspectorOp("groups.options", { videoOverlayKind: videoOverlayKind ?? null, sceneVisualKinds });

export interface SubjectSelection {
	videoOverlay?: { id?: number } | null;
	audio?: { id?: number } | null;
	text?: { preset?: string } | null;
	effectId?: number | null;
	transitionId?: number | null;
	scene?: { id?: number } | null;
}
/** The family the inspector is about and its clip id; null when nothing is selected. */
export const inspectorSubject = (sel: SubjectSelection): { kind: string; clipId?: string } | null =>
	inspectorOp("subject", {
		videoOverlay: sel.videoOverlay ? { id: sel.videoOverlay.id ?? null } : null,
		audio: sel.audio ? { id: sel.audio.id ?? null } : null,
		text: sel.text ? { preset: sel.text.preset ?? null } : null,
		effectId: sel.effectId ?? null,
		transitionId: sel.transitionId ?? null,
		scene: sel.scene ? { id: sel.scene.id ?? null } : null,
	});

export const normalizeLayout = (
	layout: Partial<ClipLayout> | undefined,
	kind: ClipKind,
): ClipLayout =>
	inspectorOp("layout.normalize", layout === undefined ? { kind } : { kind, layout });
export const defaultTextStyle = (preset?: string): ClipTextStyle =>
	inspectorOp("text.defaultStyle", preset === undefined ? {} : { preset });
