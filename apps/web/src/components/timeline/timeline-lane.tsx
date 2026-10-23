/* One overlay lane, and the clips on it.
 *
 * Split out of `timeline-tracks.tsx` to put a memo boundary around each lane and
 * each clip, which is what makes a selection cost two renders instead of one per
 * clip on the timeline. Two things had to be true first, and both are why this
 * could not simply be wrapped in `memo()` where it stood:
 *
 *  - the props have to be data. Every handler the markup uses is a fresh closure
 *    on the editor's render, so passing them would defeat the boundary before it
 *    could help. They come through `LaneEnvContext` instead — one object, stable
 *    for the lifetime of the editor, forwarding each call to the current
 *    closure. A memo boundary that silently never holds is worse than none: it
 *    reads as protection and provides nothing.
 *  - the selection cannot be a prop, for the same reason in reverse. A clip
 *    subscribes to ONE question — "am I selected?" — so a selection change
 *    re-renders the clips whose answer flipped, and no others.
 */
import { createContext, memo, useContext, useMemo, useRef } from "react";
import type { DragEvent, JSX, PointerEvent as ReactPointerEvent } from "react";
import { usePhoneLayout } from "@hooks/editor/use-phone-layout.ts";
import { usePendingMediaVersion } from "@hooks/editor/use-pending-media-version.ts";
import { usePendingUpload } from "@hooks/editor/use-pending-upload.ts";
import { ClipUploadBadge } from "@components/timeline/media/pending-upload.tsx";
import { isPendingMedia, resolveMediaUrl } from "@models/core/pending-media-sources.ts";
import { FreeClipRange, type ClipGeometry } from "./free-clip-range.tsx";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { Waveform } from "@components/timeline/audio/audio-waveform.tsx";
import { VideoPoster } from "@components/timeline/media/media-thumb.tsx";
import { findTextTemplate } from "@models/clip-templates/registry.ts";
import { audioKindLabel } from "@maleo/shared/audio-overlays";
import { isMotionPreset } from "@models/timeline/timeline-editor-model.ts";
import {
	audioLaneGroup,
	isVisualClip,
	laneLabel,
	type TimelineClip,
	type OverlayTimelineClip,
} from "@models/timeline/timeline-clips.ts";
import { MIN_CLIP_PX, TOUCH_MIN_CLIP_PX, TOUCH_TRIM_MIN_PX } from "@models/timeline/clip-layout.ts";
import {
	readDataCalloutDrop,
	readTemplateDrop,
	hasTimelineExternalDrag,
	type MediaDropInfo,
} from "@models/timeline/timeline-drops.ts";
import { selectClip as selectClipIn } from "@models/timeline/selection-model.ts";
import { countRender } from "@models/timeline/render-probe.ts";
import type { LaneGroup, TextPreset } from "@maleo/shared";
import type { PlayheadHandle } from "@models/timeline/playhead-handle.ts";
import type { EditorChrome } from "@stores/editor-chrome-store.ts";
import { useClipSelected, useSelectionFact, type SelectionStore } from "@stores/selection-store.ts";
import type { TimelineTracksOps } from "./timeline-tracks.tsx";
import { keysOf } from "@maleo/shared";
import { touchingBoundary } from "@maleo/shared";
import type { TimelineDocumentStore } from "@stores/timeline-document-store.ts";
import type { EditorChromeStore } from "@stores/editor-chrome-store.ts";

/** Where a clip sits and how wide it is drawn, plus the two state classes that
 *  come out of the same measurement.
 *
 *  `padded` says the width is a hit target rather than a duration — the clip is
 *  drawn wider than the time it occupies, and the operator is shown that rather
 *  than left to infer it from a timeline that quietly stopped being to scale.
 *  `narrow` says there is no room for trim handles inside it.
 *
 *  One function because both answers come from the same two numbers, and a
 *  second place computing clip width is how the handles and the body would end
 *  up disagreeing about which clips are too small. */
/** Where a clip sits on its lane and how it should read. `cls` carries the
 *  padded-width marker, so a clip widened to stay touchable is still
 *  distinguishable from one that is genuinely that long. */

export function clipGeom(
	c: { start: number; dur: number },
	pxPerSec: number,
	coarse: boolean,
): ClipGeometry {
	const trueW = c.dur * pxPerSec;
	const width = Math.max(trueW, coarse ? TOUCH_MIN_CLIP_PX : MIN_CLIP_PX);
	const padded = coarse && width > trueW + 0.5;
	const narrow = coarse && width < TOUCH_TRIM_MIN_PX;
	return {
		style: { left: c.start * pxPerSec, width },
		cls: `${padded ? "padded" : ""} ${narrow ? "narrow" : ""}`,
		narrow,
	};
}

/* ── The environment a lane acts through ── */

/** Everything a lane or a clip CALLS, as opposed to everything it draws.
 *
 *  Held as one stable object so that no lane re-renders because a handler was
 *  rebuilt. Reads go through to the current value at call time, so nothing here
 *  can go stale — see `useLaneEnv`. */
export interface LaneEnv {
	store: TimelineDocumentStore;
	chromeStore: EditorChromeStore;
	ops: TimelineTracksOps;
	/* Where a dropped clip lands. Owned by the tracks region rather than by the
	 * editor, so it arrives here directly rather than through the editor's ops
	 * bag.
	 *
	 * The gesture itself is no longer in this bag at all: the surface holds
	 * capture on the scroller and the kernel holds the gesture, so a clip needs
	 * nothing from here to be dragged. */
	laneFor: (group: LaneGroup, preferredRow: number) => number;
	onMediaDrop: (e: DragEvent, row: number) => boolean;
	dropTime: (e: DragEvent) => number;
	selection: SelectionStore;
	playhead: PlayheadHandle;
	/** Admit a dropped asset to the project and answer with its identity. */
	admitDrop: (m: MediaDropInfo) => string;
	startMarquee: (e: ReactPointerEvent<HTMLDivElement>) => void;
	setEditTarget: ChromeSetter<"editTarget">;
	setEffectEdit: ChromeSetter<"effectEdit">;
	setInfographicEditId: ChromeSetter<"infographicEditId">;
	setTransitionEditId: ChromeSetter<"transitionEditId">;
}

/** One chrome field's setter, in the shape `useChromeSetter` returns. */
type ChromeSetter<K extends keyof EditorChrome> = (
	value: EditorChrome[K] | ((prev: EditorChrome[K]) => EditorChrome[K]),
) => void;

const LaneEnvContext = createContext<LaneEnv | null>(null);

function useLaneEnv(): LaneEnv {
	const env = useContext(LaneEnvContext);
	if (!env) throw new Error("a lane rendered outside its LaneEnvProvider");
	return env;
}

/** Wrap `env` so its identity never changes while its contents stay current.
 *
 *  The bundle is rebuilt on every render of the timeline — that is the point,
 *  the closures inside it must be the current ones — but a context value that
 *  changes identity re-renders every consumer, which is exactly what the memo
 *  boundaries below exist to prevent. So the value handed to the context is a
 *  proxy that reads through to the latest bundle when a call actually happens. */
export function LaneEnvProvider({
	env,
	children,
}: {
	env: LaneEnv;
	children: React.ReactNode;
}): JSX.Element {
	const latest = useRef(env);
	latest.current = env;
	const stable = useMemo(
		() =>
			new Proxy({} as LaneEnv, {
				get: (_target, key: string) => (latest.current as unknown as Record<string, unknown>)[key],
			}),
		[],
	);
	return <LaneEnvContext.Provider value={stable}>{children}</LaneEnvContext.Provider>;
}

/* ── The clips ── */

/** What every clip needs regardless of kind. Data only: a fresh closure here
 *  would defeat the memo, and the handlers come from the env. */
interface ClipProps {
	clip: OverlayTimelineClip;
	pxPerSec: number;
	/** Project duration. VUI's range wants it for the keyboard clamp; the drawn
	 *  geometry stays in pixels, below. */
	total: number;
	coarse: boolean;
	locked: boolean;
	hidden: boolean;
	colliding: boolean;
	dragging: boolean;
}

/* ── The VUI seam ── */

/* The remove control on an effect or infographic clip is a pointer shortcut, not
 * a button: the clip itself is a `<button role="option">`, and a button inside a
 * button is invalid HTML that React reports on every load. Delete and the clip's
 * context menu remove the same clip from the keyboard. */
const EffectClipView = memo(function EffectClipView({
	clip: c,
	pxPerSec,
	total,
	coarse,
	locked,
	hidden,
	colliding,
	dragging,
}: ClipProps): JSX.Element {
	countRender("clip");
	const env = useLaneEnv();
	const selected = useClipSelected(env.selection, c.id);
	const geom = clipGeom(c, pxPerSec, coarse);
	return (
		<FreeClipRange
			geometry={geom}
			nudge={(patch) => env.ops.setFreeClipPos(c.source, c.refId, patch)}
			clip={c}
			kind="effect"
			total={total}
			pxPerSec={pxPerSec}
			coarse={coarse}
			locked={locked}
			selected={selected}
			className={`tl2-clip tl2-clip-effect tl2-clip-compact ${selected ? "on" : ""} ${dragging ? "dragging" : ""} ${locked ? "locked" : ""} ${hidden ? "hidden" : ""} ${colliding ? "collide" : ""} ${geom.cls}`}
			title={`Effect: ${c.label} · double-click to edit`}
			onSelect={(e) => {
				if (e.shiftKey) {
					env.ops.toggleFreeClip("effect", c.refId);
					return;
				}
				env.ops.setSelection(selectClipIn("effect", c.refId));
				const at = env.playhead.get();
				if (!(c.dur > 0 && at >= c.start && at <= c.start + c.dur)) env.ops.seekPreview(c.start);
			}}
			onContextMenu={(e) => env.ops.openClipMenu(c, e)}
			onDoubleClick={() => {
				if (locked) return;
				env.setEffectEdit({ id: c.refId });
			}}
			body={
				<span className="tl2-clip-body tl2-clip-fxbody">
					<span className="tl2-clip-ic">{Ic.spark(ICON.xs)}</span>
					<em>Effect</em>
					<b>{c.label}</b>
				</span>
			}
			extra={
				<span
					className="tl2-clip-del"
					aria-hidden="true"
					title="Remove effect"
					onPointerDown={(e) => e.stopPropagation()}
					onClick={(e) => {
						e.stopPropagation();
						if (locked) return;
						env.ops.removeEffect(c.refId);
					}}
				>
					{Ic.x(ICON.xs)}
				</span>
			}
		/>
	);
});

const InfographicClipView = memo(function InfographicClipView({
	clip: c,
	pxPerSec,
	total,
	coarse,
	locked,
	hidden,
	colliding,
	dragging,
}: ClipProps): JSX.Element {
	countRender("clip");
	const env = useLaneEnv();
	const selected = useClipSelected(env.selection, c.id);
	const geom = clipGeom(c, pxPerSec, coarse);
	return (
		<FreeClipRange
			geometry={geom}
			nudge={(patch) => env.ops.setFreeClipPos(c.source, c.refId, patch)}
			clip={c}
			kind="infographic"
			total={total}
			pxPerSec={pxPerSec}
			coarse={coarse}
			locked={locked}
			selected={selected}
			className={`tl2-clip tl2-clip-data tl2-clip-compact ${selected ? "on" : ""} ${dragging ? "dragging" : ""} ${locked ? "locked" : ""} ${hidden ? "hidden" : ""} ${colliding ? "collide" : ""} ${geom.cls}`}
			title={`${c.label} · double-click to edit`}
			onSelect={(e) => {
				if (e.shiftKey) env.ops.toggleFreeClip("infographic", c.refId);
				else env.ops.selectFreeClip("infographic", c.refId, c.start);
			}}
			onDoubleClick={(e) => {
				e.stopPropagation();
				if (locked) return;
				env.ops.selectFreeClip("infographic", c.refId, c.start);
				env.setInfographicEditId(c.refId);
				env.setTransitionEditId(null);
				env.setEffectEdit(null);
				env.setEditTarget(null);
			}}
			onContextMenu={(e) => env.ops.openClipMenu(c, e)}
			/* Fill only, like the text clip: icon, type tag, mini-chart and label all
			   competed for a strip too small to hold any of them. The label stays
			   reachable through the clip's title. */
			body={<span className="tl2-clip-body tl2-clip-databody" aria-label={c.label} />}
			extra={
				<span
					className="tl2-clip-del"
					aria-hidden="true"
					title="Remove infographic"
					onPointerDown={(e) => e.stopPropagation()}
					onClick={(e) => {
						e.stopPropagation();
						if (locked) return;
						env.ops.setInfographicOverlays((items) => items.filter((x) => x.id !== c.refId));
					}}
				>
					{Ic.x(ICON.xs)}
				</span>
			}
		/>
	);
});

/** The media families — image, video, text, audio. One component rather than
 *  four: they share the frame, the trim handles and the drag gating, and differ
 *  only in the body, so splitting them would copy the parts that must agree. */
function CaptionClipView({
	clip,
	pxPerSec,
	total,
	coarse,
	locked,
	hidden,
}: Omit<ClipProps, "clip"> & { clip: Extract<TimelineClip, { source: "caption" }> }): JSX.Element {
	const env = useLaneEnv();
	const selected = useClipSelected(env.selection, clip.id);
	const select = () => env.ops.selectFreeClip("caption", clip.id, clip.start);
	return (
		<FreeClipRange
			geometry={clipGeom(clip, pxPerSec, coarse)}
			nudge={(patch) => env.ops.setFreeClipPos(clip.source, clip.refId, patch)}
			clip={clip}
			kind="caption"
			pxPerSec={pxPerSec}
			total={total}
			coarse={coarse}
			locked={locked}
			selected={selected}
			className={`tl2-clip tl2-clip-caption ${selected ? "on" : ""} ${hidden ? "hidden" : ""}`}
			title={clip.label}
			body={<span className="tl2-clip-label">{clip.label}</span>}
			onSelect={select}
			onContextMenu={(event) => env.ops.openClipMenu(clip, event)}
			onDoubleClick={() => {
				select();
				env.chromeStore.patch("rail", "captions");
				env.chromeStore.patch("panelOpen", true);
			}}
		/>
	);
}

interface MediaClipProps extends ClipProps {
	/** The text overlay's preset, resolved by the lane from its id-keyed map.
	 *  Passed as a value so a memoized clip does not hold a map that changes
	 *  whenever any overlay does. */
	preset?: TextPreset;
	/** The audio's decoded natural length, for the resize badge. */
	originalDur?: number;
	/** Where the media starts inside the source, for a trim-in drag. */
	mediaStartSec?: number;
	/** Whether THIS clip is the one being resized (the badge is its own). */
	resizing: boolean;
}

export function mediaClipThumb(
	clip: Pick<MediaClipProps["clip"], "media" | "thumb" | "url">,
	asset?: { source: string; thumb?: string; poster?: string },
): string | undefined {
	if (clip.media === "video" && asset?.source === "generated") return asset.poster;
	const clipThumb = clip.media === "video" && clip.thumb === clip.url ? undefined : clip.thumb;
	return (
		clipThumb ?? (clip.media === "video" && asset?.thumb === clip.url ? undefined : asset?.thumb)
	);
}

const MediaClipView = memo(function MediaClipView({
	clip: c,
	pxPerSec,
	total,
	coarse,
	locked,
	hidden,
	colliding,
	dragging,
	preset,
	originalDur,
	mediaStartSec,
	resizing,
}: MediaClipProps): JSX.Element {
	countRender("clip");
	const env = useLaneEnv();
	usePendingMediaVersion();
	// A file still importing plays from the session's copy; its poster and length are not edits.
	const pending = isPendingMedia(c.url);
	const mediaUrl = c.url ? resolveMediaUrl(c.url) : c.url;
	const upload = usePendingUpload(c.url);
	const selected = useClipSelected(env.selection, c.id);
	const geom = clipGeom(c, pxPerSec, coarse);
	const src = c.source;
	const asset = env.ops.mediaAssets.find((item) => item.url === c.url);
	const thumb = mediaClipThumb(c, asset);
	// Motion clips (animated/branded templates) get their own clip colour as a
	// visual cue that they read apart from plain text overlays.
	const isMotion = isMotionPreset(preset);
	const audioGroup = audioLaneGroup(c.audioKind);
	const audioTag = audioGroup === "voiceover" ? "VO" : audioGroup === "sfx" ? "SFX" : "MUSIC";
	const audioIcon =
		audioGroup === "voiceover"
			? Ic.mic(ICON.xs)
			: audioGroup === "sfx"
				? Ic.spark(ICON.xs)
				: Ic.music(ICON.xs);
	const pct = resizing && originalDur ? Math.round((c.dur / originalDur) * 100) : null;
	const body = (
		<>
			{upload && <ClipUploadBadge state={upload} />}
			{c.media === "image" || c.media === "video" ? (
				// Full-width thumbnail strip. Video without a poster shows its first frame.
				thumb ? (
					<span
						className="tl2-clip-strip"
						style={{ backgroundImage: `url(${resolveMediaUrl(thumb)})` }}
					>
						{c.media === "image" && <span className="tl2-clip-badge">Image</span>}
					</span>
				) : c.media === "video" && mediaUrl ? (
					<VideoPoster url={mediaUrl} />
				) : (
					<span className="tl2-clip-strip empty">
						{Ic.image(ICON.sm)}
						{c.media === "image" && <span className="tl2-clip-badge">Image</span>}
					</span>
				)
			) : c.media === "text" ? (
				/* Fill only — the lane declares the kind and the two-line label was
				   clipped to illegibility anyway. Content stays reachable via the clip
				   title; motion keeps its own hue so the two read apart. */
				<span
					className={`tl2-clip-body tl2-clip-textbody ${isMotion ? "tl2-clip-motionbody" : ""}`}
					aria-label={
						isMotion
							? ((preset ? findTextTemplate(preset)?.label : undefined) ?? "Motion")
							: c.label
					}
				/>
			) : mediaUrl ? (
				/* No kind pill. The lane declares the kind, so the pill repeated it and
				   took the width the waveform needs at 26px. The kind survives in the
				   fallback label and the clip title, the two places it is still the only
				   thing to read. */
				<span className="tl2-clip-body tl2-clip-audiobody">
					<Waveform
						url={mediaUrl}
						label={`${audioTag} · ${c.label}`}
						icon={audioIcon}
						widthPx={c.dur * pxPerSec}
						onDuration={(d) => {
							if (
								!pending &&
								originalDur !== d &&
								!env.ops.mediaAssets.some(
									(asset) => asset.url === c.url && asset.metadata?.duration != null,
								)
							)
								env.ops.updateAudio(c.refId, { originalDur: d });
						}}
					/>
				</span>
			) : (
				<span className="tl2-clip-body tl2-clip-audiobody">
					{audioIcon}
					<b>{c.label || audioKindLabel(c.audioKind ?? "voiceover", c.audioOrigin)}</b>
				</span>
			)}
		</>
	);
	return (
		<FreeClipRange
			geometry={geom}
			nudge={(patch) => env.ops.setFreeClipPos(c.source, c.refId, patch)}
			clip={c}
			kind={src === "video" ? "video" : src === "text" ? "text" : "audio"}
			total={total}
			pxPerSec={pxPerSec}
			coarse={coarse}
			locked={locked}
			selected={selected}
			mediaStartSec={mediaStartSec}
			className={`tl2-clip tl2-clip-${c.media} tl2-clip-compact ${audioGroup ? `tl2-audio-${audioGroup}` : ""} ${isMotion ? "tl2-clip-motion" : ""} ${selected ? "on" : ""} ${dragging ? "dragging" : ""} ${locked ? "locked" : ""} ${hidden ? "hidden" : ""} ${colliding ? "collide" : ""} ${geom.cls}`}
			title={`${c.label} · double-click to edit`}
			onSelect={(e) => {
				if (e.shiftKey) env.ops.toggleFreeClip(src, c.refId);
				else env.ops.selectFreeClip(src, c.refId, c.start);
			}}
			onContextMenu={(e) => env.ops.openClipMenu(c, e)}
			onDoubleClick={() => {
				if (locked) return;
				if (c.source === "text") env.ops.selectFreeClip("text", c.refId, c.start);
				env.setEditTarget(env.ops.editTargetFor(c));
			}}
			body={body}
			/* Length-percent badge while resizing — vs the clip's natural length. */
			extra={
				pct != null ? (
					<span className={`tl2-clip-pct ${pct > 100 ? "over" : ""}`}>{pct}%</span>
				) : undefined
			}
		/>
	);
});

/* ── The lane ── */

export interface TimelineLaneProps {
	row: number;
	clips: TimelineClip[];
	/** The lane's declared group. Undefined only for a lane no migration has
	 *  typed, which draws the generic drop hint instead of a ghost label. */
	group?: LaneGroup;
	/** True for the last lane, which keeps the long "drop anything" hint. */
	last: boolean;
	pxPerSec: number;
	/** Project duration, for the keyboard clamp VUI applies to a range. */
	total: number;
	coarse: boolean;
	locked: boolean;
	hidden: boolean;
	/** The lane's header is selected, which is what arms reorder. */
	laneSelected: boolean;
	/** A clip on this lane is selected. A boolean, so selecting a clip re-renders
	 *  only the lanes whose answer flips. */
	holdsSelection: boolean;
	/** A clip is being dragged over this lane. */
	dropping: boolean;
	collidingIds: Set<string>;
	/** The clip currently being dragged, and the one being resized. Passed as
	 *  ids rather than as the drag state: the state object changes identity on
	 *  every pointer move, and a lane that is not involved should not hear it. */
	draggingId: string | null;
	resizingId: string | null;
	/** Per-clip values the lane resolves from its id-keyed maps, so a clip never
	 *  holds a map. */
	presetOf: (clip: TimelineClip) => TextPreset | undefined;
	originalDurOf: (clip: TimelineClip) => number | undefined;
	mediaStartOf: (clip: TimelineClip) => number | undefined;
	/** The transition between two touching visual clips, if there is one. */
	transitionAt: (aId: string, bId: string) => { id: number; type: string } | undefined;
}

export const TimelineLane = memo(
	function TimelineLane({
		row,
		clips,
		group,
		last,
		pxPerSec,
		total,
		coarse,
		locked,
		hidden,
		laneSelected,
		holdsSelection,
		dropping,
		collidingIds,
		draggingId,
		resizingId,
		presetOf,
		originalDurOf,
		mediaStartOf,
		transitionAt,
	}: TimelineLaneProps): JSX.Element {
		countRender("lane");
		const phone = usePhoneLayout();
		const env = useLaneEnv();
		/* The one selection fact a LANE needs: a selected transition edge is drawn
		 * by the lane rather than by a clip, because it belongs to the gap between
		 * two of them. A number, so the subscription cannot loop. */
		const selectedTransition = useSelectionFact(env.selection, (s) => s.transitionId);

		const onDrop = (e: React.DragEvent<HTMLDivElement>): void => {
			if (env.onMediaDrop(e, row)) return;
			if (locked) {
				e.preventDefault();
				return;
			}
			const t = env.dropTime(e);
			/* Every placement goes through `laneFor`: a drop states a time and a kind,
		   both unambiguous, so a wrong row routes rather than rejects. */
			const templateDrop = readTemplateDrop(e);
			if (templateDrop) {
				e.preventDefault();
				if (templateDrop.kind === "text")
					env.ops.addOverlay(t, env.laneFor("text", row), templateDrop.preset, templateDrop.params);
				else if (templateDrop.kind === "composition")
					env.ops.placeComposition(
						templateDrop.config,
						templateDrop.label,
						t,
						env.laneFor("text", row),
					);
				else env.ops.addInfographicPayload(templateDrop.payload, t, env.laneFor("data", row), 4);
				return;
			}
			const dataPayload = readDataCalloutDrop(e);
			if (dataPayload) {
				e.preventDefault();
				env.ops.addInfographicPayload(dataPayload, t, env.laneFor("data", row), 4);
				return;
			}
		};

		// Transition edges between touching visual clips on this row.
		const edges: JSX.Element[] = [];
		const visual = clips
			.filter(isVisualClip)
			.slice()
			.sort((a, b) => a.start - b.start);
		for (let i = 0; i < visual.length - 1; i++) {
			const a = visual[i]!,
				b = visual[i + 1]!;
			if (!touchingBoundary(a, b)) continue;
			// Short touch clips need their whole body; Clip actions retains transition access.
			if (phone && coarse && Math.min(a.dur, b.dur) * pxPerSec < TOUCH_MIN_CLIP_PX * 2) continue;
			const tr = transitionAt(a.id, b.id);
			const type = tr && tr.type !== "cut" ? tr.type : null;
			edges.push(
				<button
					key={`edge-${a.id}-${b.id}`}
					disabled={locked}
					className={`tl2-trans ${type ? "set" : ""} ${tr && selectedTransition === tr.id ? "on" : ""}`}
					style={{ left: b.start * pxPerSec }}
					aria-label={`Transition · ${a.label} → ${b.label}`}
					title={type ? `Transition: ${type} — click to edit` : "Add transition"}
					onPointerDown={(e) => e.stopPropagation()}
					onClick={(e) => {
						e.stopPropagation();
						env.chromeStore.patch("animationInspector", { fromClipId: a.id, toClipId: b.id });
					}}
				>
					{type ? (
						<span className="tl2-trans-pill">{type}</span>
					) : (
						<span className="tl2-trans-ic">{Ic.layers(ICON.xs)}</span>
					)}
				</button>,
			);
		}

		return (
			<div
				/* Declared group; CSS reads it for row height, as does the gutter. */
				data-lane-group={group}
				data-vui-slot="row"
				data-vui-row={`lane-${row}`}
				/* Whole lane, not just the header: selection ARMS reorder. */
				className={`tl2-lane tl2-lane-free ${laneSelected ? "on" : ""} ${holdsSelection ? "holds" : ""} ${dropping ? "drop" : ""} ${locked ? "locked" : ""}`}
				/* Marquee select is press-and-move on empty lane space, which is the pan
			   gesture. A finger cannot express both, so on a coarse pointer the press
			   falls through and the lane scrolls; a mouse keeps box-select unchanged.
			   Rebinding was not available — a modifier needs a keyboard, long-press is
			   a timing race — so this is a real capability loss on touch, recorded as
			   one. */
				onPointerDown={(e) => {
					if (!coarse && e.target === e.currentTarget && e.button === 0) env.startMarquee(e);
				}}
				onContextMenu={(e) => env.ops.openAddMenu(e, row)}
				onDragOver={(e) => {
					if (hasTimelineExternalDrag(e)) e.preventDefault();
				}}
				onDrop={onDrop}
			>
				{/* Ghost label in EVERY empty lane: a typed empty lane persists on purpose
			    and, with the gutter hidden, has no other identity cue. */}
				{clips.length === 0 &&
					(group ? (
						<span className="tl2-lane-hint ghost">{laneLabel(group, row).label}</span>
					) : (
						last && (
							<span className="tl2-lane-hint">Drop media, audio, text, data, or effect here</span>
						)
					))}
				{clips.map((c) => {
					const shared = {
						clip: c,
						pxPerSec,
						total,
						coarse,
						locked,
						hidden,
						colliding: collidingIds.has(c.id),
						dragging: draggingId === c.id,
					};
					if (c.source === "caption") return <CaptionClipView key={c.id} {...shared} clip={c} />;
					if (c.source === "effect") return <EffectClipView key={c.id} {...shared} clip={c} />;
					if (c.source === "infographic")
						return <InfographicClipView key={c.id} {...shared} clip={c} />;
					return (
						<MediaClipView
							key={c.id}
							{...shared}
							clip={c}
							preset={presetOf(c)}
							originalDur={originalDurOf(c)}
							mediaStartSec={mediaStartOf(c)}
							resizing={resizingId === c.id}
						/>
					);
				})}
				{edges}
			</div>
		);
	},
	(prev, next) => {
		/* Reference equality, exactly like the default comparator — with the name of
		 * the prop that differed recorded when a harness is counting.
		 *
		 * "Prove the boundary holds" is a task in this change rather than an
		 * assumption, because the failure mode is silent: a memo defeated by one
		 * rebuilt prop looks identical to one that works, and the only symptom is a
		 * render count nobody is looking at. Three props were doing it, and none was
		 * guessable from reading the diff — the collision Set returning a fresh empty
		 * Set per drag, the transition lookup being a new closure per render, and the
		 * dragged clip's id being told to every lane rather than to the one holding
		 * it. This is how each of them was found. */
		let equal = true;
		for (const key of keysOf(next)) {
			if (prev[key] === next[key]) continue;
			equal = false;
			countRender(`lane-prop:${key}`);
		}
		return equal;
	},
);
