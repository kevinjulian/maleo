import {
	fromTimelineDoc,
	rebuildDocWith,
	normalizeSceneClips,
	sceneVisualSourceDuration,
	sampleClipTransform,
	evaluateValueTrack,
	sourceCropSchema,
	clipCompositingBlockers,
	hasClipCompositing,
	NUMERIC_ANIMATION_PROPERTIES,
	numericPropertiesFor,
	type ClipLayout,
	type NumericAnimationProperty,
} from "@maleo/shared";
import {
	batch,
	keyTarget,
	noop,
	replaceClip,
	setKeys,
	upsertKey,
	type EditorCommand,
	type EditScope,
} from "@maleo/shared/editor";
import { clipIdForTarget } from "./clip-animation-edit.ts";
import type { EditorDoc } from "@models/storyboard/editor-doc.ts";
import { normalizeLayout, type ClipKind } from "./clip-layout.ts";

export interface CanvasTarget {
	source: "scene" | "video" | "text";
	id: number;
	visualId?: string;
}
export type TransformMode = "move" | "rotate" | "nw" | "ne" | "sw" | "se";
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Resolve a keyed scene source without replacing the existing whole-scene transform. */
export function canvasClipLayout(doc: EditorDoc, target: CanvasTarget) {
	const views = fromTimelineDoc(doc);
	const scene =
		target.source === "scene" ? views.scenes.find((s) => s.id === target.id) : undefined;
	const visual =
		scene &&
		(normalizeSceneClips(scene).visualClips?.find((v) => v.id === target.visualId) ??
			normalizeSceneClips(scene).visualClips?.[0]);
	const inherited = scene && visual ? { ...scene.layout, ...visual.layout } : undefined;
	const animatedVisual =
		target.visualId ||
		visual?.layout?.widthPct !== undefined ||
		hasClipCompositing(inherited) ||
		(inherited?.animation &&
			Object.entries(inherited.animation.tracks).some(
				([p, keys]) => p !== "volume" && keys?.length,
			))
			? visual
			: undefined;
	const current =
		target.source === "scene"
			? scene
			: target.source === "video"
				? views.videoOverlays.find((v) => v.id === target.id)
				: views.textOverlays.find((v) => v.id === target.id);
	const duration =
		animatedVisual && scene
			? normalizeSceneClips(scene).visualClips?.length === 1 && !animatedVisual.startSec
				? animatedVisual.kind === "video"
					? sceneVisualSourceDuration(animatedVisual.durationSec, scene.dur, inherited)
					: scene.dur
				: animatedVisual.durationSec
			: (current?.dur ?? 0);
	return {
		duration,
		layout: animatedVisual ? inherited : current?.layout,
		start: (current?.start ?? 0) + (animatedVisual?.startSec ?? 0),
		visual: animatedVisual,
	};
}

/** Sample only the selected box; the editor host keeps its segment subscription. */
export function sampledCanvasLayout(
	layout: Partial<ClipLayout> | undefined,
	kind: ClipKind,
	time: number,
) {
	const base = normalizeLayout(layout, kind),
		sampled = sampleClipTransform(base, time),
		tracks = base.animation?.tracks;
	// Text animates its box size too; other kinds have no width/height tracks, so these are their static values.
	const widthPct = evaluateValueTrack(tracks?.widthPct, time, base.widthPct),
		heightPct = tracks?.heightPct
			? evaluateValueTrack(tracks.heightPct, time, base.heightPct ?? 100)
			: base.heightPct;
	return {
		layout: {
			...base,
			xPct: sampled.xPct,
			yPct: sampled.yPct,
			widthPct,
			heightPct,
			rotationDeg: sampled.rotationDeg,
			opacity: sampled.opacity,
		},
		scale: sampled.scale,
	};
}

/** The static half of a canvas edit, on the live document. Keys at the playhead
 *  are `canvasEditCommand`'s job; this writes layout values only. A scene whose
 *  transform lives on its keyed visual is edited there, not on the scene. */
export function patchCanvasLayout(
	doc: EditorDoc,
	target: CanvasTarget,
	patch: Partial<ClipLayout>,
): EditorDoc {
	if (
		(patch.crop !== undefined && !sourceCropSchema.safeParse(patch.crop).success) ||
		clipCompositingBlockers({ layout: patch }).length
	)
		return doc;
	const views = fromTimelineDoc(doc);
	const key =
		target.source === "scene"
			? "scenes"
			: target.source === "video"
				? "videoOverlays"
				: "textOverlays";
	const current = views[key].find((item) => item.id === target.id);
	if (
		!current ||
		doc.trackFlags?.[target.source === "scene" ? -1 : "track" in current ? (current.track ?? 0) : 0]
			?.locked
	)
		return doc;
	const kind: ClipKind =
		target.source === "scene"
			? "scene"
			: target.source === "text"
				? "text"
				: target.source === "video" && "kind" in current
					? current.kind
					: "image";
	const keyed = canvasClipLayout(doc, target);
	const base = keyed.visual ? keyed.layout : current.layout;
	const layout = normalizeLayout({ ...normalizeLayout(base, kind), ...patch }, kind);
	if (keyed.visual && target.source === "scene")
		return rebuildDocWith(doc, {
			scenes: views.scenes.map((s) =>
				s.id === target.id
					? {
							...s,
							visualClips: normalizeSceneClips(s).visualClips?.map((v) =>
								v.id === keyed.visual?.id ? { ...v, layout } : v,
							),
						}
					: s,
			),
		});
	const changed = {
		[key]: views[key].map((item) => (item.id === target.id ? { ...item, layout } : item)),
	};
	return rebuildDocWith(doc, changed);
}

/** Pixel-space local axes keep rotated resizing accurate on nonsquare canvases. */
export function resizeCanvasLayout(
	initial: ClipLayout,
	corner: Exclude<TransformMode, "move" | "rotate">,
	dx: number,
	dy: number,
	canvas: { w: number; h: number },
	lock: boolean,
	snap = false,
	scale = 1,
): Partial<ClipLayout> {
	const angle = ((initial.rotationDeg ?? 0) * Math.PI) / 180;
	const cos = Math.cos(angle),
		sin = Math.sin(angle);
	const sx = corner.endsWith("e") ? 1 : -1,
		sy = corner.startsWith("s") ? 1 : -1;
	const w = (initial.widthPct * canvas.w) / 100,
		h = ((initial.heightPct ?? 100) * canvas.h) / 100;
	const dw = (sx * (cos * dx + sin * dy)) / scale,
		dh = (sy * (-sin * dx + cos * dy)) / scale;
	let nw: number, nh: number;
	if (lock) {
		const scale = clamp(
			1 + (w * dw + h * dh) / (w * w + h * h),
			Math.max(2 / initial.widthPct, 2 / (initial.heightPct ?? 100)),
			Math.min(200 / initial.widthPct, 200 / (initial.heightPct ?? 100)),
		);
		nw = w * scale;
		nh = h * scale;
	} else {
		nw = clamp(w + dw, canvas.w * 0.02, canvas.w * 2);
		nh = clamp(h + dh, canvas.h * 0.02, canvas.h * 2);
	}
	if (snap) {
		if (lock) {
			const scale = clamp(
				(Math.round((nw / canvas.w) * 20) * canvas.w) / 20 / w,
				Math.max(2 / initial.widthPct, 2 / (initial.heightPct ?? 100)),
				Math.min(200 / initial.widthPct, 200 / (initial.heightPct ?? 100)),
			);
			nw = w * scale;
			nh = h * scale;
		} else {
			nw = clamp((Math.round((nw / canvas.w) * 20) * canvas.w) / 20, canvas.w * 0.02, canvas.w * 2);
			nh = clamp((Math.round((nh / canvas.h) * 20) * canvas.h) / 20, canvas.h * 0.02, canvas.h * 2);
		}
	}
	const cx = scale * ((cos * sx * (nw - w)) / 2 - (sin * sy * (nh - h)) / 2);
	const cy = scale * ((sin * sx * (nw - w)) / 2 + (cos * sy * (nh - h)) / 2);
	return {
		xPct: initial.xPct + ((cx - (nw - w) / 2) / canvas.w) * 100,
		yPct: initial.yPct + ((cy - (nh - h) / 2) / canvas.h) * 100,
		widthPct: (nw / canvas.w) * 100,
		heightPct: (nh / canvas.h) * 100,
	};
}

export function resizeLayoutValue(
	layout: ClipLayout,
	axis: "widthPct" | "heightPct",
	value: number,
): Partial<ClipLayout> {
	if (!layout.aspectLocked) return { [axis]: value };
	const width = layout.widthPct,
		height = layout.heightPct ?? 100;
	const scale = clamp(
		value / (axis === "widthPct" ? width : height),
		Math.max(2 / width, 2 / height),
		Math.min(200 / width, 200 / height),
	);
	return { widthPct: width * scale, heightPct: height * scale };
}

const PATCH_KEYABLE = [
	"xPct",
	"yPct",
	"rotationDeg",
	"opacity",
	"widthPct",
	"heightPct",
] as const satisfies readonly NumericAnimationProperty[];

/** One canvas gesture as commands (keyframe-animation): each changed property that
 *  already has keys gets a key at the playhead; the rest is one static replace. A
 *  proportional resize keys scale instead of size when scale is keyed, keeping the
 *  box centre where the resize put it. */
export function canvasEditCommand(
	scope: EditScope,
	target: CanvasTarget,
	patch: Partial<ClipLayout>,
	atSec?: number,
): EditorCommand {
	const doc = scope.doc,
		resolved = canvasClipLayout(doc, target),
		animation = resolved.layout?.animation;
	const id = clipIdForTarget(doc, target),
		keyed = atSec === undefined || !animation ? undefined : keyTarget(doc, id);
	const time = atSec === undefined ? 0 : Math.round((atSec - resolved.start) * 1e6) / 1e6;
	if (keyed && (keyed.locked || time < 0 || time > keyed.duration + 1e-6)) return noop();
	const staticPatch: Partial<ClipLayout> = { ...patch },
		keys: [NumericAnimationProperty, number][] = [];
	if (keyed) {
		const base = sampledCanvasLayout(
			resolved.layout,
			target.source === "text" ? "text" : "image",
			time,
		);
		const allowed = new Set<string>(numericPropertiesFor(keyed.kind));
		const keyable = (property: NumericAnimationProperty) =>
			allowed.has(property) && Boolean(animation?.tracks[property]?.length);
		const proportional =
			patch.widthPct !== undefined &&
			patch.heightPct !== undefined &&
			Math.abs(
				patch.widthPct / patch.heightPct - base.layout.widthPct / (base.layout.heightPct ?? 100),
			) < 1e-6;
		if (keyable("scale") && proportional && !keyable("widthPct")) {
			const ratio = patch.widthPct! / base.layout.widthPct;
			keys.push(["scale", base.scale * ratio]);
			// The resize moved the box corner-anchored; keep that centre with the unscaled size.
			staticPatch.xPct =
				(patch.xPct ?? base.layout.xPct) + (patch.widthPct! - base.layout.widthPct) / 2;
			staticPatch.yPct =
				(patch.yPct ?? base.layout.yPct) + (patch.heightPct! - (base.layout.heightPct ?? 100)) / 2;
			delete staticPatch.widthPct;
			delete staticPatch.heightPct;
		}
		for (const property of PATCH_KEYABLE) {
			const value = staticPatch[property];
			if (value === undefined || value === null || !keyable(property)) continue;
			keys.push([property, value]);
			delete staticPatch[property];
		}
	}
	const commands: EditorCommand[] = [];
	const staticDoc = Object.keys(staticPatch).length
		? patchCanvasLayout(doc, target, staticPatch)
		: doc;
	for (const clip of staticDoc.clips) {
		const prior = doc.clips.find((c) => c.id === clip.id);
		if (prior !== clip) commands.push(replaceClip(clip.id, clip));
	}
	const clamp = (property: NumericAnimationProperty, v: number) =>
		Math.max(
			NUMERIC_ANIMATION_PROPERTIES[property].min,
			Math.min(NUMERIC_ANIMATION_PROPERTIES[property].max, v),
		);
	for (const [property, raw] of keys)
		commands.push(
			setKeys(
				id,
				property,
				upsertKey(animation?.tracks[property] ?? [], time, clamp(property, raw)),
			),
		);
	if (!commands.length) return noop();
	return commands.length === 1 ? commands[0]! : batch(commands, "canvas transform");
}
