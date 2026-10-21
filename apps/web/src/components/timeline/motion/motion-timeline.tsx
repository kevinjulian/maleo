/* Motion Studio's timeline, on `@maleo/vui`.
 *
 * One surface for the whole region: it takes capture on the scroller and
 * resolves what a press concerns by hit-testing — a layer bar, or a keyframe on
 * a nested track. Neither owns a pointer, which is what lets a keyframe be
 * dragged while the row it sits in re-renders around it.
 *
 * The distinction this region exists to keep is the one a keyframe editor lives
 * or dies by: **a tap selects a keyframe and a drag retimes it.** A keyframe
 * that moved because it was touched is a keyframe nobody can inspect, and on a
 * finger it is the difference between an editor and a hazard. The recognizer
 * decides which happened, once, and the library applies it.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from "react";
import { createStore } from "@models/timeline-view/store.ts";
import { distanceAndHoldRecognizer, distanceRecognizer } from "@models/timeline-view/engagement.ts";
import { type GestureState } from "@models/timeline-view/gesture.ts";
import { type TimelineState } from "@models/timeline-view/types.ts";
import { createGeometryQuery } from "@controllers/surface/query.ts";
import {
	createTimelineSurface,
	type SurfaceHitTest,
	type TimelineSurface,
} from "@controllers/surface/surface.ts";
import { uniformRows } from "@services/paint/scene.ts";
import { motionTicksToSeconds } from "@models/timeline/motion-document-adapter.ts";
import type { MotionLaneRange } from "@models/timeline/motion-vui-adapter.ts";
import { publishGeometry } from "@controllers/surface/geometry-probe.ts";

/** One row's height, and the studio's vertical rhythm. */
export const MOTION_ROW_H = 24;

/**
 * One row the studio draws: a layer, or one of its nested property tracks.
 *
 * The studio's own shape rather than the library's. What a row IS here — a
 * layer stack with its curves indented under it — is a fact about Motion
 * Studio, and the library resolves time and leaves the vertical axis alone.
 */
export interface MotionTimelineRow {
	id: string;
	label: string;
	depth?: number;
	ranges?: MotionLaneRange[];
}

/** Motion's engagement rule. The same shape the content editor declares, once. */
const fine = distanceRecognizer({ distancePx: 4, holdMs: 0 });
const coarse = distanceAndHoldRecognizer({ distancePx: 12, holdMs: 90 });

export interface MotionTimelineProps {
	/** The composition as the library's model. */
	state: TimelineState;
	durationSec: number;
	pxPerSec: number;
	coarsePointer: boolean;
	/** A press that never became a drag, on a layer bar or a keyframe. */
	onSelect(id: string, kind: "layer" | "keyframe"): void;
	/** A committed drag. Seconds on the studio's own timeline. */
	onMoveLayer(layerRowId: string, startSec: number): void;
	onMoveKeyframe(markerId: string, timelineSec: number): void;
	/** Capture caller-owned edit eligibility before a gesture can change it. */
	onGestureStart?(): void;
	/** Where a keyframe currently sits, in studio seconds. Only the caller knows. */
	markerSecondsOf(markerId: string): number;
	/** The rows, drawn by the caller: it owns the gutter, the curves, and the labels. */
	children: ReactNode;
	className?: string;
}

interface MotionGesture {
	readonly id: string;
	readonly kind: "layer" | "keyframe";
	readonly originSec: number;
}

/** What the caller draws while a drag is open, so nothing is written early. */
export interface MotionProjection {
	readonly id: string;
	readonly kind: "layer" | "keyframe";
	readonly timelineSec: number;
}

/** What the studio gets back: where to attach, and what is in flight. */
export interface MotionTimelineHandle {
	/** Attach the scroller the surface takes capture on. */
	readonly scrollerRef: (node: HTMLDivElement | null) => void;
	readonly scroller: HTMLDivElement | null;
	readonly gesture: GestureState | undefined;
	readonly projection: MotionProjection | undefined;
	readonly surface: TimelineSurface | undefined;
}

export function useMotionTimeline(
	props: Omit<MotionTimelineProps, "children" | "className">,
): MotionTimelineHandle {
	/* The scroller as STATE, not as a ref.
	 *
	 * The region is rendered through a prop and mounts after this hook's first
	 * effects run, so a ref would still be null when the surface was created and
	 * the effect — keyed on stable values — would never run again. A callback ref
	 * that sets state re-runs it the moment the element exists. */
	const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
	const scrollerRef = useCallback((node: HTMLDivElement | null) => setScroller(node), []);
	const surfaceRef = useRef<TimelineSurface | undefined>(undefined);
	const openRef = useRef<MotionGesture | undefined>(undefined);
	const [gesture, setGesture] = useState<GestureState | undefined>(undefined);
	const [projection, setProjection] = useState<MotionProjection | undefined>(undefined);
	/* The latest props, read by the callbacks the surface holds for its lifetime.
	 * The surface is created once: an effect keyed on a per-render object would
	 * rebuild it mid-drag, and disposing a surface ends its gesture as `unmount`. */
	const latest = useRef(props);
	latest.current = props;

	const store = useMemo(
		() =>
			createStore(props.state, {
				scaleLimits: { minScale: 1e-6, maxScale: 1 },
				rowHeightPx: 24,
				recognizer: (observation) =>
					observation.coarse || latest.current.coarsePointer
						? coarse(observation)
						: fine(observation),
				autoScroll: { edgePx: 32, pixelsPerSecond: 600 },
			}),
		// eslint-disable-next-line react-hooks/exhaustive-deps -- created once and fed by `replaceItems`.
		[],
	);

	/* The composition changed under us — a layer added, a keyframe deleted, an
	 * inspector edit. The kernel is told rather than rebuilt, so the gesture in
	 * flight and every slice subscription survive it. */
	useEffect(() => {
		store.dispatch({
			type: "replaceItems",
			items: [...props.state.items.values()],
			duration: props.state.duration,
		});
	}, [store, props.state]);

	const hitTest = useCallback<SurfaceHitTest>((_point, event) => {
		const element = globalThis.document?.elementFromPoint(event.clientX, event.clientY);
		/* SAFETY: `elementFromPoint` returns an `Element`, and `closest` is all that
		 * is read from it. A point over nothing returns null, handled below. */
		const target = (element as HTMLElement | null)?.closest<HTMLElement>(
			"[data-motion-marker], [data-motion-layer]",
		);
		if (!target) return undefined;
		const marker = target.dataset.motionMarker;
		if (marker !== undefined) return { kind: "item", id: marker };
		const layer = target.dataset.motionLayer;
		return layer === undefined ? undefined : { kind: "item", id: layer };
	}, []);

	const secondsAt = useCallback(
		(deltaPx: number): number => deltaPx / Math.max(1, latest.current.pxPerSec),
		[],
	);
	/* The last position the projection reported, which is what a commit writes.
	 * Recomputing it from the terminal event would ask where the pointer ended
	 * rather than where the edit was shown to land, and the two differ by
	 * whatever the last sample did not deliver. */
	const projectedSecRef = useRef<number | undefined>(undefined);

	useEffect(() => {
		if (!scroller) return;
		const surface = createTimelineSurface({
			root: scroller,
			store,
			scroller,
			hitTest,
			/* Escape is heard on the document: the scroller is a plain `div` and
			 * never holds focus, so a keydown would never reach it. */
			keySource: globalThis.document,
		});
		surfaceRef.current = surface;
		// Escape cancels this gesture before the host can clear clip selection.
		const ownEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape" && surface.activeGestures().length) event.preventDefault();
		};
		globalThis.document.addEventListener("keydown", ownEscape, true);
		/* The kernel's boxes, published on the region they describe, so a caller
		 * can ask where a layer or a keyframe IS without measuring an element that
		 * may be re-rendering underneath the question. */
		publishGeometry(
			scroller,
			createGeometryQuery({
				state: () => store.getState(),
				rows: uniformRows(
					store.getState().rows.map((row) => row.id),
					scroller.querySelector("[data-vui-slot='row']")?.getBoundingClientRect().height ??
						MOTION_ROW_H,
				),
				rulerHeightPx:
					scroller.querySelector("[data-vui-slot='ruler']")?.getBoundingClientRect().height ?? 0,
			}),
		);
		return () => {
			publishGeometry(scroller, undefined);
			globalThis.document.removeEventListener("keydown", ownEscape, true);
			surface.dispose();
			surfaceRef.current = undefined;
		};
	}, [store, hitTest, scroller, props.coarsePointer]);

	useEffect(() => {
		const slice = store.slice((state) => [...state.gestures.values()][0]);
		return slice.subscribe(() => {
			const current = slice.get();
			setGesture(current);

			if (current && !openRef.current && current.target.kind === "item") {
				latest.current.onGestureStart?.();
				const isMarker = current.target.id.includes(":");
				const item = isMarker ? undefined : store.getState().items.get(current.target.id);
				openRef.current = {
					id: current.target.id,
					kind: isMarker ? "keyframe" : "layer",
					originSec: item
						? motionTicksToSeconds(item.start.ticks)
						: latest.current.markerSecondsOf(current.target.id),
					/* A layer bar and a keyframe are both "one thing moving in time",
					 * so both are a trim of the item's own span rather than two
					 * machines. What differs is what the commit writes. */
				};
			}

			const open = openRef.current;
			if (!current) {
				openRef.current = undefined;
				setProjection(undefined);
				if (!open) return;
				const ended = store.getState().lastGesture;
				if (!ended || ended.phase !== "commit" || !ended.engaged) {
					/* A tap selects and writes nothing; a cancelled drag writes nothing
					 * either. The recognizer already decided which this was. */
					if (ended?.phase === "commit" && !ended.engaged)
						latest.current.onSelect(open.id, open.kind);
					return;
				}
				const seconds = projectedSecRef.current;
				projectedSecRef.current = undefined;
				if (seconds === undefined) return;
				if (open.kind === "layer") latest.current.onMoveLayer(open.id, seconds);
				else latest.current.onMoveKeyframe(open.id, seconds);
				return;
			}
			if (!open || !current.engaged) return;
			const seconds = Math.max(
				0,
				open.originSec + secondsAt(current.current.xPx - current.origin.xPx),
			);
			projectedSecRef.current = seconds;
			setProjection({ id: open.id, kind: open.kind, timelineSec: seconds });
		});
	}, [store, secondsAt]);

	return { scrollerRef, scroller, gesture, projection, surface: surfaceRef.current };
}

/** The scrolling region the surface owns. The rows inside it are the caller's. */
export function MotionTimelineViewport({
	scrollerRef,
	widthPx,
	children,
	className,
}: {
	scrollerRef: (node: HTMLDivElement | null) => void;
	widthPx: number;
	children: ReactNode;
	className?: string;
}): JSX.Element {
	return (
		<div
			ref={scrollerRef}
			data-vui-slot="timeline-scroller"
			className={
				className === undefined ? "tl2-motion-viewport" : `tl2-motion-viewport ${className}`
			}
		>
			<div style={{ position: "relative", minWidth: `${widthPx}px` }}>{children}</div>
		</div>
	);
}
