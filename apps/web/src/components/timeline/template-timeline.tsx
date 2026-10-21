/* The template editor's preview timeline, on `@maleo/vui`.
 *
 * One surface for the whole region. It takes capture on the scroller and
 * resolves what a press concerns by hit-testing the bar and, within it, the
 * handle — so no bar owns a pointer and a range is free to be rebuilt beneath a
 * drag. It is rebuilt constantly here: every bar's position is derived from the
 * draft, and the draft changes on every inspector keystroke.
 *
 * What a drag means is narrower than in a real editor, and deliberately so. A
 * preview range stands for ONE NUMBER — a title duration, a gap, a maximum
 * beat — so its edges are draggable and its body is not: there is no setting
 * that "move this bar" would write. A press on the body still opens a gesture,
 * because the person did press something, and it commits nothing.
 */
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type JSX,
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
} from "react";
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
import { useTimelineSlice } from "@hooks/editor-workspace/store-bindings.ts";
import { publishGeometry } from "@controllers/surface/geometry-probe.ts";
import {
	TEMPLATE_PREVIEW_FPS,
	TEMPLATE_TIMEBASE,
	templateEdgeSeconds,
	templateTicksToSeconds,
	type TemplateRange,
} from "@models/timeline/template-document-adapter.ts";

/** One lane's height, and the preview's vertical rhythm. */
export const TEMPLATE_LANE_H = 48;
/** The ruler's height, which the gutter's spacer has to match. */
export const TEMPLATE_RULER_H = 30;
/** The platform's touch minimum, which nothing interactive here goes under. */
const TEMPLATE_MIN_HIT_PX = 44;
/** The narrowest a bar is ever drawn, so a sub-second setting stays visible. */
const TEMPLATE_MIN_PAINT_PX = 2;
/** The trim handle's drawn width, matching `.tl2-clip-handle` in tracks-interaction.css. */
const TEMPLATE_HANDLE_PX = 16;
/** One frame at the preview rate, which is the keyboard's fine step. */
const TEMPLATE_STEP_SEC = 1 / TEMPLATE_PREVIEW_FPS;
const COARSE_STEP_FACTOR = 10;

/** The editor's engagement rule, declared once and handed to the kernel. */
const fine = distanceRecognizer({ distancePx: 4, holdMs: 0 });
const coarse = distanceAndHoldRecognizer({ distancePx: 12, holdMs: 90 });

export interface TemplateTimelineOptions {
	/** The preview lanes as the library's model. */
	readonly state: TimelineState;
	readonly durationSec: number;
	readonly coarsePointer: boolean;
	/** The range an identity names, as the draft currently describes it. */
	rangeOf(id: string): TemplateRange | undefined;
	/** A press that never became a drag, anywhere on a bar. */
	onSelect(rangeId: string): void;
	/** A committed edge drag. The absolute preview second the edge landed on. */
	onResize(rangeId: string, edge: "start" | "end", sec: number): void;
}

export interface TemplateTimelineHandle {
	/** Attach the scroller the surface takes capture on. */
	readonly scrollerRef: (node: HTMLDivElement | null) => void;
	readonly scroller: HTMLDivElement | null;
	readonly gesture: GestureState | undefined;
	readonly surface: TimelineSurface | undefined;
	/* The viewport as the kernel publishes it. The kernel is its single writer —
	 * a zoom, a pan and a scroll all land there — so the consumer READS its scale
	 * rather than holding a second one that disagrees the first time either
	 * changes. */
	readonly pxPerSec: number;
	readonly startSec: number;
	readonly endSec: number;
}

/**
 * The press in flight.
 *
 * A body press carries no edge, because there is no setting
 * "move this bar" would write — but it is still tracked, because whether it
 * became a drag is what separates a selection from an edit, and the recognizer
 * is the only thing that knows.
 */
interface OpenPress {
	readonly id: string;
	readonly edge: "start" | "end" | null;
	readonly originSec: number;
}

export function useTemplateTimeline(options: TemplateTimelineOptions): TemplateTimelineHandle {
	/* The scroller as STATE rather than a ref: the region is rendered through a
	 * prop and mounts after this hook's first effects, so a ref would still be
	 * null when the surface was created and the effect — keyed on stable values —
	 * would never run again. */
	const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
	const scrollerRef = useCallback((node: HTMLDivElement | null) => setScroller(node), []);
	const surfaceRef = useRef<TimelineSurface | undefined>(undefined);
	const openRef = useRef<OpenPress | undefined>(undefined);
	const [gesture, setGesture] = useState<GestureState | undefined>(undefined);
	/* The latest options, read by the callbacks the surface holds for its
	 * lifetime. The surface is created once: an effect keyed on a per-render
	 * object would rebuild it mid-drag, and disposing a surface ends its gesture
	 * as `unmount`. */
	const latest = useRef(options);
	latest.current = options;

	const store = useMemo(
		() =>
			createStore(options.state, {
				scaleLimits: { minScale: 1e-6, maxScale: 1 },
				rowHeightPx: TEMPLATE_LANE_H,
				recognizer: (observation) =>
					observation.coarse || latest.current.coarsePointer
						? coarse(observation)
						: fine(observation),
				autoScroll: { edgePx: 32, pixelsPerSecond: 600 },
			}),
		// eslint-disable-next-line react-hooks/exhaustive-deps -- created once and fed by `replaceItems`.
		[],
	);

	/* The draft changed under us — a number typed in the inspector, a policy
	 * switched, a title preset cleared. The kernel is told rather than rebuilt,
	 * so a gesture in flight and every slice subscription survive it. */
	useEffect(() => {
		store.dispatch({
			type: "replaceItems",
			items: [...options.state.items.values()],
			duration: options.state.duration,
		});
	}, [store, options.state]);

	const hitTest = useCallback<SurfaceHitTest>((_point, event) => {
		/* SAFETY: `elementFromPoint` returns an `Element`, and only `closest` and
		 * `dataset` are read from it. A point over nothing returns null, handled on
		 * the next line. */
		const element = globalThis.document?.elementFromPoint(
			event.clientX,
			event.clientY,
		) as HTMLElement | null;
		const bar = element?.closest<HTMLElement>("[data-template-range]");
		const id = bar?.dataset.templateRange;
		if (id === undefined) return undefined;
		/* On a finger, a press on an unselected bar is a selection and a press
		 * anywhere else belongs to the view. Declining here rather than opening a
		 * gesture and refusing it later is what leaves the browser free to scroll —
		 * capture taken is a pan lost. */
		if (latest.current.coarsePointer && latest.current.rangeOf(id)?.selected !== true)
			return undefined;
		const handle = element?.closest<HTMLElement>('[data-vui-slot^="trim-"]');
		if (handle)
			return { kind: "item", id, edge: handle.dataset.vuiSlot === "trim-start" ? "start" : "end" };
		return { kind: "item", id };
	}, []);

	/* The viewport the kernel publishes, subscribed to as its own slice so a zoom
	 * or a scroll re-renders the region and a selection change does not. */
	const viewport = useTimelineSlice(
		store,
		useMemo(() => (state: TimelineState) => state.viewport, []),
	);
	const pxPerSec = viewport.scale * TEMPLATE_PREVIEW_FPS * TEMPLATE_TIMEBASE.ticksPerFrame;
	/* Read by the surface's callbacks, which outlive any one render. */
	const pxPerSecRef = useRef(pxPerSec);
	pxPerSecRef.current = pxPerSec;

	/* How wide the region is, told to the kernel rather than measured by it: edge
	 * auto-scroll and clamping both need it, and only the host can see it. */
	useEffect(() => {
		if (!scroller) return;
		store.dispatch({ type: "resize", widthPx: scroller.clientWidth });
		store.dispatch({ type: "scroll", leftPx: scroller.scrollLeft });
	}, [store, scroller]);

	useEffect(() => {
		if (!scroller) return;
		const surface = createTimelineSurface({
			root: scroller,
			store,
			scroller,
			hitTest,
			/* This region drives its own horizontal axis. The bars are laid out in
			 * the kernel's pixel space, so a pan or a pinch has to move the kernel's
			 * viewport for the drawing to follow it — and the stylesheet says the
			 * same with `touch-action: pan-y`, so the browser is not also scrolling. */
			touchViewport: {
				pan: true,
				pinch: true,
				/* The ruler scrubs, so its fingers are not the view's. The hit test
				 * already declines them — no BAR is under them — but "no item here"
				 * and "this finger belongs to the view" are different statements, and
				 * conflating them made a ruler drag pan the timeline underneath the
				 * playhead it was moving. */
				/* The ruler is the region's top band, so this is geometry rather than
				 * a hit test: a finger whose press was inside it is the ruler's for
				 * the rest of the gesture, wherever it travels. Asking the document
				 * what is under the point instead would answer for whatever the
				 * scroller had scrolled under it. */
				pans: (event) =>
					event.clientY - scroller.getBoundingClientRect().top >
					(scroller.querySelector("[data-vui-slot='ruler']")?.getBoundingClientRect().height ??
						TEMPLATE_RULER_H),
			},
			/* Escape is heard on the document: the scroller is a plain `div` and
			 * never holds focus, so a keydown would never reach it. */
			keySource: globalThis.document,
		});
		surfaceRef.current = surface;
		/* The kernel's boxes, published on the region they describe. The bars are
		 * elements here, but their duration, their drawn width and their touch
		 * target are three different numbers and only one of them is the element's
		 * box — so "is the hit target big enough without the bar lying about time"
		 * is a question only this can answer. */
		publishGeometry(
			scroller,
			createGeometryQuery({
				state: () => store.getState(),
				rows: uniformRows(
					store.getState().rows.map((row) => row.id),
					scroller.querySelector("[data-vui-slot='row']")?.getBoundingClientRect().height ??
						TEMPLATE_LANE_H,
				),
				rulerHeightPx:
					scroller.querySelector("[data-vui-slot='ruler']")?.getBoundingClientRect().height ??
					TEMPLATE_RULER_H,
				/* This region's own minimums, not the library's defaults. A bar here
				 * is drawn as narrow as two pixels — a breath is a fraction of a
				 * second — so the drawing is honest and only the touch target grows.
				 * A query padding at a different width than the stylesheet would
				 * report a discrepancy nobody can see. */
				geometry: {
					minHitPx: TEMPLATE_MIN_HIT_PX,
					minPaintPx: TEMPLATE_MIN_PAINT_PX,
					handlePx: TEMPLATE_HANDLE_PX,
				},
			}),
		);
		return () => {
			publishGeometry(scroller, undefined);
			surface.dispose();
			surfaceRef.current = undefined;
		};
	}, [store, hitTest, scroller, options.coarsePointer]);

	/* The last edge position the drag resolved, which is what a commit writes.
	 * Recomputing it from the terminal event would ask where the pointer ended
	 * rather than where the edge was shown to be. */
	const resolvedSecRef = useRef<number | undefined>(undefined);

	/* The published scroll position, re-applied after layout.
	 *
	 * A zoom widens the content, and the surface writes the new scroll position
	 * before React has re-rendered at the new scale — so the browser clamps it to
	 * the OLD width and the focal point drifts by whatever was clamped away. This
	 * runs after the wider content exists and puts it where the kernel said. The
	 * write echoes back as a `scroll` that resolves to the same viewport, which
	 * publishes nothing, so there is still one writer. */
	useEffect(() => {
		if (!scroller) return;
		const leftPx = templateTicksToSeconds(viewport.start.ticks) * pxPerSec;
		if (Math.abs(scroller.scrollLeft - leftPx) > 0.5) scroller.scrollLeft = leftPx;
	}, [scroller, viewport, pxPerSec]);

	useEffect(() => {
		const slice = store.slice((state) => [...state.gestures.values()][0]);
		return slice.subscribe(() => {
			const current = slice.get();
			setGesture(current);

			if (current && !openRef.current && current.target.kind === "item") {
				const range = latest.current.rangeOf(current.target.id);
				const edge = current.target.edge ?? null;
				if (range) {
					openRef.current = {
						id: current.target.id,
						edge,
						originSec: edge === null ? range.startSec : templateEdgeSeconds(range, edge),
					};
				}
			}

			const open = openRef.current;
			if (!current) {
				openRef.current = undefined;
				if (!open) return;
				const ended = store.getState().lastGesture;
				const seconds = resolvedSecRef.current;
				resolvedSecRef.current = undefined;
				/* Selection travels this path rather than the bar's `click`, because a
				 * captured pointer retargets the click to the scroller and the bar never
				 * hears it. The recognizer is what says which happened: a press that
				 * never engaged is a selection, and a cancelled drag writes nothing. */
				if (!ended || ended.phase !== "commit" || !ended.engaged) {
					if (ended?.phase === "commit" && !ended.engaged) latest.current.onSelect(open.id);
					return;
				}
				if (open.edge === null || seconds === undefined) return;
				latest.current.onResize(open.id, open.edge, seconds);
				return;
			}
			if (!open || open.edge === null || !current.engaged) return;
			const deltaSec =
				(current.current.xPx - current.origin.xPx) / Math.max(1, pxPerSecRef.current);
			resolvedSecRef.current = Math.max(
				0,
				Math.min(latest.current.durationSec, open.originSec + deltaSec),
			);
		});
	}, [store]);

	return {
		scrollerRef,
		scroller,
		gesture,
		surface: surfaceRef.current,
		pxPerSec,
		startSec: templateTicksToSeconds(viewport.start.ticks),
		endSec: templateTicksToSeconds(viewport.end.ticks),
	};
}

/** The scrolling region the surface owns. What is inside it is the caller's. */
export function TemplateTimelineViewport({
	scrollerRef,
	widthPx,
	startSec,
	endSec,
	pxPerSec,
	children,
}: {
	scrollerRef: (node: HTMLDivElement | null) => void;
	widthPx: number;
	startSec: number;
	endSec: number;
	pxPerSec: number;
	children: ReactNode;
}): JSX.Element {
	return (
		<div
			ref={scrollerRef}
			data-vui-slot="timeline-scroller"
			className="vui-timeline-viewport tl2-template-viewport"
			/* The published viewport, on the element. It is the only way a test — or
			   a consumer's own instrumentation — can read what the kernel resolved
			   without reaching into the store, and it is derived rather than stored,
			   so it cannot disagree with what is drawn. */
			data-vui-start={startSec}
			data-vui-end={endSec}
			data-vui-px-per-sec={pxPerSec}
		>
			<div style={{ position: "relative", minWidth: `${widthPx}px` }}>{children}</div>
		</div>
	);
}

export interface TemplateRangeBarProps {
	readonly range: TemplateRange;
	readonly durationSec: number;
	readonly pxPerSec: number;
	/** A pointer is down on this bar, so it reads as engaged rather than idle. */
	readonly gesturing: boolean;
	onSelect(rangeId: string): void;
	/** The keyboard alternative to dragging an edge. */
	onResize(rangeId: string, edge: "start" | "end", sec: number): void;
}

/**
 * One preview range.
 *
 * It owns no pointer: the surface hit-tests `data-template-range` and the
 * handles' own `data-vui-slot`, and the gesture then lives in the kernel keyed
 * by identity. What this owns is how the bar looks, which edges exist, and the
 * keyboard path — which is not a fallback here but the only precise one, since
 * the smallest setting on this timeline is a fiftieth of a second.
 */
export function TemplateRangeBar({
	range,
	durationSec,
	pxPerSec,
	gesturing,
	onSelect,
	onResize,
}: TemplateRangeBarProps): JSX.Element {
	const [announcement, setAnnouncement] = useState("");
	const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
		const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
		if (direction === 0) return;
		/* Alt picks the start edge and Shift the end, separately from Ctrl/Meta
		 * picking the coarse step, so every combination of edge and step is
		 * reachable. */
		const edge = event.altKey ? "start" : event.shiftKey ? "end" : null;
		if (edge === null || (edge === "start" ? range.resizeStart !== true : range.resizeEnd !== true))
			return;
		event.preventDefault();
		const step =
			TEMPLATE_STEP_SEC * (event.ctrlKey || event.metaKey ? COARSE_STEP_FACTOR : 1) * direction;
		const next = Math.max(0, Math.min(durationSec, templateEdgeSeconds(range, edge) + step));
		onResize(range.id, edge, next);
		/* The keyboard path has no visible drag to watch, so what it did is said
		 * out loud. The live region is rendered unconditionally below and only
		 * filled here: a region added to the DOM together with its text is not
		 * announced. */
		setAnnouncement(`${range.label} ${edge} is ${next.toFixed(2)} seconds`);
	};

	return (
		<button
			type="button"
			/* What the surface hit-tests. `data-vui-slot` is the published targeting
			   contract; the `vui-*` classes are this editor's own styling. */
			data-template-range={range.id}
			data-vui-slot="item"
			data-vui-focusable=""
			/* A gesture is open on this bar. Published as an attribute as well as a
			   class because "is something being dragged here" is a question a
			   consumer's own assertions ask, and a class is styling. */
			data-vui-gesturing={gesturing ? "" : undefined}
			className={`vui-range tl2-clip tl2-clip-compact tl2-template-range${range.selected ? " on" : ""}${gesturing ? " is-gesturing" : ""}`}
			style={{
				left: `${range.startSec * pxPerSec}px`,
				width: `${Math.max(2, range.durationSec * pxPerSec)}px`,
			}}
			role="option"
			aria-selected={range.selected === true}
			aria-label={`${range.label}, starts at ${range.startSec.toFixed(2)} seconds`}
			aria-keyshortcuts="ArrowLeft ArrowRight"
			onClick={() => onSelect(range.id)}
			/* Selection happens at the PRESS, not at the release. On a coarse
			   pointer that is the whole first gesture — the surface declines an
			   unselected bar so the browser keeps the pan — and the person still has
			   to see that the press landed somewhere. */
			onPointerDown={() => {
				if (range.selected !== true) onSelect(range.id);
			}}
			onKeyDown={onKeyDown}
		>
			{/* Grown to the touch minimum around a bar too short to hit, and only
			    around it: the bar's own box still means its duration. */}
			<span className="vui-range-hit-target" data-vui-slot="hit-target" aria-hidden="true" />
			<span className="vui-range-body tl2-clip-body" data-vui-slot="label">
				<b>{range.label}</b>
			</span>
			<span className="vui-sr-only" data-vui-slot="announcer" aria-live="polite">
				{announcement}
			</span>
			{/* Rendered only when the edge can actually be dragged. A declined
			    affordance produces no element, so it leaves no hit area behind. */}
			{range.resizeStart === true ? (
				<i
					className="vui-handle start tl2-clip-handle l"
					data-vui-slot="trim-start"
					aria-hidden="true"
					title={`Resize ${range.label} start`}
				>
					<span className="tl2-clip-resize l" />
				</i>
			) : null}
			{range.resizeEnd === true ? (
				<i
					className="vui-handle end tl2-clip-handle"
					data-vui-slot="trim-end"
					aria-hidden="true"
					title={`Resize ${range.label} end`}
				>
					<span className="tl2-clip-resize" />
				</i>
			) : null}
		</button>
	);
}
