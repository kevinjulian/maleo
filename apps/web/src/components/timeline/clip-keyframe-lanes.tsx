/* Keys on the timeline (keyframe-animation: keys are shown and edited
 * on the selected clip), after opencut-classic. The selected clip shows one ◆ per
 * moment on its own bar, merging every property keyed at that time; per-property lanes
 * are expanded from the clip's context menu and render directly under its track row. Both share the main ruler, zoom and
 * horizontal scroll, and mount after the lane that holds the selected clip. */
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
	COLOR_ANIMATION_PROPERTIES,
	NUMERIC_ANIMATION_PROPERTIES,
	isNumericAnimationProperty,
	type NumericAnimationProperty,
} from "@maleo/shared";
import { framesToProject, projectTime } from "@models/timeline-view/tick.ts";
import {
	clipAnimationInfo,
	copyClipKeys,
	keyMoments,
	pasteClipKeys,
	moveClipKey,
	moveMoments,
	removeClipKey,
	selectedClipAnimationTarget,
} from "@models/timeline/clip-animation-edit.ts";
import { motionStateOf, MOTION_TIMEBASE } from "@models/timeline/motion-document-adapter.ts";
import { useSelectionValue, type SelectionStore } from "@stores/selection-store.ts";
import type { Selection } from "@models/timeline/selection-model.ts";
import {
	useDocumentSelector,
	type TimelineDocumentStore,
} from "@stores/timeline-document-store.ts";
import { useChromeField, type EditorChromeStore } from "@stores/editor-chrome-store.ts";
import type { DocumentWriters } from "@stores/document-writers.ts";
import type { EditorCommand, EditScope } from "@maleo/shared/editor";
import { usePhoneLayout } from "@hooks/editor/use-phone-layout.ts";
import { Note } from "@design-system/components/note.tsx";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { useMotionTimeline } from "./motion/motion-timeline.tsx";

const labelOf = (property: NumericAnimationProperty): string =>
	NUMERIC_ANIMATION_PROPERTIES[property].label;
const FRAME = 1 / 30;
interface KeyLaneProps {
	store: TimelineDocumentStore;
	selection: SelectionStore;
	chromeStore: EditorChromeStore;
	row: number;
}

function useKeyLanes({ store, selection, chromeStore, row }: KeyLaneProps) {
	const doc = useDocumentSelector(store, (value) => value.getDoc()),
		selected = useSelectionValue(selection);
	const [visual] = useChromeField(chromeStore, "clipKeyVisual"),
		[expanded] = useChromeField(chromeStore, "clipKeyLanesOpen");
	const target = selectedClipAnimationTarget(doc, selected, visual),
		info = target && clipAnimationInfo(doc, target);
	const clip = info && doc.clips.find((c) => c.id === info.id);
	// Scene visuals live on the base lane (-1); every other clip on its own track row.
	const clipRow = clip ? (clip.scene || clip.vis ? -1 : clip.track) : undefined;
	const here = clipRow === row && Boolean(info);
	const properties = here
		? (info?.properties ?? []).filter((p) => info?.animation?.tracks[p]?.length)
		: [];
	const moments = here ? keyMoments(info?.animation) : [];
	return { target, info, properties, moments, expanded, here };
}

/** Gutter labels for the expanded lanes, beside the row that holds the selected clip. */
export function ClipKeyframeGutter(props: KeyLaneProps) {
	const { properties, expanded } = useKeyLanes(props);
	if (!expanded) return null;
	return (
		<>
			{properties.map((p) => (
				<div key={p} className="tl2-keylane-label" title={labelOf(p)}>
					{labelOf(p)}
				</div>
			))}
		</>
	);
}

export function ClipKeyframeLanes(
	props: KeyLaneProps & {
		writers: DocumentWriters;
		total: number;
		pxPerSec: number;
		coarse: boolean;
		onSeek: (seconds: number) => void;
	},
) {
	const { target, info, properties, moments, expanded, here } = useKeyLanes(props),
		{ chromeStore, writers } = props;
	const [selected, setSelected] = useChromeField(chromeStore, "clipKeySelection");
	const phone = usePhoneLayout();
	const [error, setError] = useState<string | null>(null);
	const [box, setBox] = useState<{ left: number; width: number } | null>(null);
	const fingerprint = JSON.stringify({ target, info }),
		origin = useRef(fingerprint);
	const targetKey = JSON.stringify(target);
	const laneMarkers = expanded
		? properties.flatMap((property) =>
				(info?.animation?.tracks[property] ?? []).map((key, index) => ({
					id: `clip:${property}:${index}`,
					property,
					index,
					time: key.t,
				})),
			)
		: [];
	const momentMarkers = moments.map((m, i) => ({
		id: `moment:${i}`,
		time: m.time,
		properties: m.properties,
	}));
	const timeOf = (id: string) =>
		momentMarkers.find((m) => m.id === id)?.time ?? laneMarkers.find((m) => m.id === id)?.time;
	const state = useMemo(() => {
		const base = motionStateOf([], props.total);
		if (!info || !here) return base;
		const ticks = (seconds: number) =>
			projectTime(framesToProject(Math.round(seconds * 30), MOTION_TIMEBASE).ticks);
		const tracks = [
			{
				id: "moments",
				label: "Keyframes",
				markers: momentMarkers.map((m) => ({ id: m.id, at: ticks(info.start + m.time) })),
			},
			...(expanded
				? properties.map((property) => ({
						id: property,
						label: labelOf(property),
						markers: laneMarkers
							.filter((m) => m.property === property)
							.map((m) => ({ id: m.id, at: ticks(info.start + m.time) })),
					}))
				: []),
		];
		const item = {
			id: "clip-keys",
			rowId: "clip-keys",
			kind: "layer",
			start: ticks(info.start),
			duration: ticks(info.duration),
			tracks,
		};
		return {
			...base,
			rows: [{ id: "clip-keys", placement: "free" as const, overlap: "permit" as const }],
			items: new Map([[item.id, item]]),
			order: [item.id],
		};
	}, [fingerprint, props.total, expanded, here]);
	/* Shift is read where the press starts: the motion timeline reports a click but not
	   its modifiers. A lane key selects one property's key; moments multi-select. */
	const additive = useRef(false);
	const selectedTimes =
		selected !== null && selected.target === targetKey && !selected.property ? selected.times : [];
	const choose = (id: string, add = additive.current) => {
		const time = timeOf(id);
		if (time === undefined || !info) return;
		const lane = laneMarkers.find((m) => m.id === id);
		const has = selectedTimes.some((t) => Math.abs(t - time) < 1e-6);
		const times = lane
			? [time]
			: add
				? has
					? selectedTimes.filter((t) => Math.abs(t - time) >= 1e-6)
					: [...selectedTimes, time]
				: [time];
		setSelected(
			times.length
				? { target: targetKey, times, ...(lane ? { property: lane.property } : {}) }
				: null,
		);
		chromeStore.patch("animationInspector", null);
		const properties = lane
			? [lane.property]
			: (moments.find((m) => Math.abs(m.time - time) < 1e-6)?.properties ?? []);
		chromeStore.patch(
			"clipTab",
			info.audio
				? "levels"
				: properties.some((p) => isNumericAnimationProperty(p) && p !== "opacity")
					? "transform"
					: properties.some((p) => p === "opacity")
						? "blending"
						: target?.source === "text"
							? "style"
							: "adjust",
		);
		chromeStore.patch("inspectorOpen", true);
		if (phone) chromeStore.patch("bottomSheet", "clip-props");
		props.onSeek(info.start + time);
	};
	const change = (id: string, seconds?: number, expected?: string) => {
		const from = timeOf(id),
			lane = laneMarkers.find((m) => m.id === id);
		if (from === undefined || !info || !target || info.locked) return;
		if (expected !== undefined && expected !== fingerprint) {
			setError("Clip changed during drag. Try again.");
			return;
		}
		const time =
			seconds === undefined
				? undefined
				: Math.min(info.duration, Math.round(Math.max(0, seconds - info.start) * 30) / 30);
		// A selected moment carries the whole selection with it; an unselected one moves alone.
		const group =
			!lane && selectedTimes.some((t) => Math.abs(t - from) < 1e-6) ? selectedTimes : [from];
		const delta = time === undefined ? undefined : time - from;
		const build = (scope: EditScope): EditorCommand =>
			lane
				? time === undefined
					? removeClipKey(scope, target, lane.property, lane.index)
					: moveClipKey(scope, target, lane.property, lane.index, time)
				: moveMoments(scope, target, group, delta);
		try {
			writers.apply((scope) => build(scope));
			const shifted =
				delta === undefined
					? null
					: lane
						? [time!]
						: group.map(
								(t) =>
									Math.round(
										(t +
											Math.max(
												-Math.min(...group),
												Math.min(info.duration - Math.max(...group), delta),
											)) *
											1e6,
									) / 1e6,
							);
			setSelected(
				shifted
					? { target: targetKey, times: shifted, ...(lane ? { property: lane.property } : {}) }
					: null,
			);
			setError(null);
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "Keyframe edit failed");
		}
	};
	const timeline = useMotionTimeline({
		state,
		durationSec: props.total,
		pxPerSec: props.pxPerSec,
		coarsePointer: props.coarse,
		onSelect: (id) => choose(id),
		onMoveLayer: () => {},
		onGestureStart: () => {
			origin.current = fingerprint;
		},
		onMoveKeyframe: (id, time) => change(id, time, origin.current),
		markerSecondsOf: (id) => (info?.start ?? 0) + (timeOf(id) ?? 0),
	});
	if (!info || !target || !here || !moments.length) return null;
	const marker = (id: string, time: number, label: string, active: boolean, extraClass = "") => {
		const seconds =
			timeline.projection?.id === id
				? Math.max(
						info.start,
						Math.min(info.start + info.duration, timeline.projection.timelineSec),
					)
				: info.start + time;
		return (
			<button
				key={id}
				type="button"
				className={`tl2-keypoint ${extraClass}`}
				data-motion-marker={info.locked ? undefined : id}
				aria-label={label}
				aria-pressed={active}
				aria-disabled={info.locked}
				style={{ left: seconds * props.pxPerSec }}
				onClick={(e) => {
					if (e.detail === 0 || info.locked) choose(id, e.shiftKey);
				}}
				onKeyDown={(e) => {
					if (!["ArrowLeft", "ArrowRight", "Delete", "Backspace"].includes(e.key)) return;
					e.preventDefault();
					e.stopPropagation();
					change(
						id,
						e.key === "ArrowLeft" || e.key === "ArrowRight"
							? info.start + time + (e.key === "ArrowLeft" ? -FRAME : FRAME)
							: undefined,
					);
				}}
			>
				<span aria-hidden="true">◆</span>
			</button>
		);
	};
	const isSelected = (time: number, property?: NumericAnimationProperty) =>
		selected !== null &&
		selected.target === targetKey &&
		selected.property === property &&
		selected.times.some((t) => Math.abs(t - time) < 1e-6);
	/* Box-select across the expanded lanes, after OpenCut: sweep empty lane space and every
	   moment whose time falls inside the sweep is selected (Shift adds to the selection). */
	const boxStart = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (e.target !== e.currentTarget || e.button !== 0 || props.coarse) return;
		const rect = e.currentTarget.getBoundingClientRect(),
			x0 = e.clientX,
			add = e.shiftKey;
		e.stopPropagation();
		e.currentTarget.setPointerCapture(e.pointerId);
		const lane = e.currentTarget;
		const track = (move: PointerEvent) =>
			setBox({ left: Math.min(x0, move.clientX) - rect.left, width: Math.abs(move.clientX - x0) });
		const finish = (end: PointerEvent) => {
			lane.removeEventListener("pointermove", track);
			lane.removeEventListener("pointerup", finish);
			lane.removeEventListener("pointercancel", finish);
			setBox(null);
			const [a, b] = [Math.min(x0, end.clientX), Math.max(x0, end.clientX)].map(
				(x) => (x - rect.left) / props.pxPerSec - info.start,
			);
			const inside = momentMarkers
				.map((m) => m.time)
				.filter((t) => t >= a! - 1e-6 && t <= b! + 1e-6);
			const times = add ? [...new Set([...selectedTimes, ...inside])] : inside;
			setSelected(times.length ? { target: targetKey, times } : null);
		};
		lane.addEventListener("pointermove", track);
		lane.addEventListener("pointerup", finish);
		lane.addEventListener("pointercancel", finish);
	};
	return (
		<div
			ref={timeline.scrollerRef}
			className="tl2-keylanes"
			aria-label="Selected clip keyframes"
			onPointerDownCapture={(e) => {
				additive.current = e.shiftKey;
			}}
		>
			<div className="tl2-keymoments" aria-label="Keyframes on the selected clip">
				{momentMarkers.map((m) =>
					marker(
						m.id,
						m.time,
						`Keyframe at ${m.time.toFixed(3)} seconds: ${m.properties.map((p) => (isNumericAnimationProperty(p) ? NUMERIC_ANIMATION_PROPERTIES[p].label : COLOR_ANIMATION_PROPERTIES[p].label)).join(", ")}`,
						isSelected(m.time),
						"moment",
					),
				)}
			</div>
			{expanded &&
				properties.map((property) => (
					<div
						key={property}
						className="tl2-keylane"
						aria-label={`${labelOf(property)} keyframes`}
						onPointerDown={boxStart}
					>
						{box && <span className="tl2-keybox" style={{ left: box.left, width: box.width }} />}
						<span
							className="tl2-keyrange"
							style={{ left: info.start * props.pxPerSec, width: info.duration * props.pxPerSec }}
						/>
						{laneMarkers
							.filter((m) => m.property === property)
							.map((m) =>
								marker(
									m.id,
									m.time,
									`${labelOf(property)} key at ${m.time.toFixed(3)} seconds`,
									isSelected(m.time, property),
								),
							)}
					</div>
				))}
			{error && <Note tone="error">{error}</Note>}
		</div>
	);
}

/** The clip context menu's Expand / Collapse keyframes item (after OpenCut): shows the
 *  selected clip's per-property lanes under its row. Absent when the clip has no keys. */
export function ExpandKeyframesItem({
	store,
	selection,
	chromeStore,
	onDone,
}: {
	store: TimelineDocumentStore;
	selection: Selection;
	chromeStore: EditorChromeStore;
	onDone: () => void;
}) {
	const doc = useDocumentSelector(store, (value) => value.getDoc());
	const [visual] = useChromeField(chromeStore, "clipKeyVisual"),
		[expanded, setExpanded] = useChromeField(chromeStore, "clipKeyLanesOpen");
	const target = selectedClipAnimationTarget(doc, selection, visual),
		info = target && clipAnimationInfo(doc, target);
	if (!info || !keyMoments(info.animation).length) return null;
	return (
		<button
			type="button"
			role="menuitem"
			onClick={() => {
				setExpanded(!expanded);
				onDone();
			}}
		>
			{Ic.keyframe(ICON.sm)} {expanded ? "Collapse keyframes" : "Expand keyframes"}
		</button>
	);
}

/** Copy keyframes / Paste keyframes in the clip context menu (after OpenCut's keyframe
 *  clipboard): the whole animation of one clip onto another, one undo step. */
export function KeyframeClipboardItems({
	projectId,
	store,
	selection,
	chromeStore,
	writers,
	onDone,
}: {
	projectId: string | null;
	store: TimelineDocumentStore;
	selection: Selection;
	chromeStore: EditorChromeStore;
	writers: DocumentWriters;
	onDone: () => void;
}) {
	const doc = useDocumentSelector(store, (value) => value.getDoc());
	const [visual] = useChromeField(chromeStore, "clipKeyVisual"),
		[clipboard, setClipboard] = useChromeField(chromeStore, "clipKeyClipboard");
	const target = selectedClipAnimationTarget(doc, selection, visual);
	const copied = target && copyClipKeys(doc, target);
	const keys = target && clipboard?.projectId === projectId ? clipboard.keys : undefined;
	// Checked against the document before offering it, so a paste that cannot apply reads disabled with its reason.
	const pasteError =
		target && keys
			? pasteRefusal(() =>
					pasteClipKeys({ doc, slides: [], posts: [], mediaAssets: [] }, target, keys),
				)
			: undefined;
	if (!copied && !keys) return null;
	return (
		<>
			{copied && (
				<button
					type="button"
					role="menuitem"
					onClick={() => {
						setClipboard({ projectId, keys: copied });
						onDone();
					}}
				>
					{Ic.copy(ICON.sm)} Copy keyframes
				</button>
			)}
			{keys && (
				<button
					type="button"
					role="menuitem"
					disabled={Boolean(pasteError)}
					title={pasteError ?? undefined}
					onClick={() => {
						writers.apply((scope) => pasteClipKeys(scope, target!, keys));
						onDone();
					}}
				>
					{Ic.copy(ICON.sm)} Paste keyframes
				</button>
			)}
		</>
	);
}

/** Why a paste cannot apply, or null when it can. */
function pasteRefusal(build: () => unknown): string | null {
	try {
		build();
		return null;
	} catch (failure) {
		return failure instanceof Error ? failure.message : "Keyframes cannot be pasted here";
	}
}
