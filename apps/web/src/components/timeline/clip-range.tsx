/* One free clip, as an element the surface drives.
 *
 * It owns no pointer. `@maleo/vui`'s surface holds capture on the scroller and
 * resolves which clip a press concerns by hit-testing this element's
 * `data-clipid`; the gesture then lives in the kernel's store, keyed by its own
 * identity. That is what lets this element re-render, change lane, or unmount
 * mid-drag without the gesture noticing — the constraint that used to force the
 * lane change to land on commit.
 *
 * What it does own: how a clip looks, what it is called, which affordances
 * exist, and the keyboard alternative. An affordance for a declined capability
 * is not rendered at all, never rendered and hidden — a handle hidden in CSS
 * keeps its hit area and takes the press meant for the body underneath.
 */
import {
	memo,
	type CSSProperties,
	type DragEvent as ReactDragEvent,
	type KeyboardEvent as ReactKeyboardEvent,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	type JSX,
} from "react";

/* What this element reads off a clip, and nothing more.
 *
 * Narrowed from `TimelineClip` deliberately: the base track's scenes are
 * derived rather than stored, so they have no `source` in the free-clip
 * vocabulary at all — and requiring one meant fabricating a field to satisfy a
 * type nothing here reads. An element that draws a bar needs an identity, a
 * name, and a span. */
export interface ClipRangeSubject {
	readonly id: string;
	readonly label: string;
	readonly start: number;
	readonly dur: number;
}

/** What this clip currently allows. Maleo's policy, in Maleo's words. */
export interface ClipCapabilities {
	readonly move: boolean;
	readonly trimStart: boolean;
	readonly trimEnd: boolean;
	readonly select: boolean;
	readonly readOnly: boolean;
}

export interface ClipRangeProps {
	readonly clip: ClipRangeSubject;
	readonly selected: boolean;
	readonly capabilities: ClipCapabilities;
	readonly className: string;
	readonly style: CSSProperties;
	readonly title?: string;
	readonly body: ReactNode;
	/** Decoration that is neither body nor handle — a delete button, a badge. */
	readonly extra?: ReactNode;
	/** Keyboard nudge, in seconds. The pointer path never reaches here. */
	nudge?(patch: { start?: number; dur?: number }): void;
	/* A clip that is itself a drop target. The base track's scenes are: an image
	 * dropped on one becomes a second visual in that beat. Declared here rather
	 * than left to the lane, because the lane cannot tell which clip the pointer
	 * was over without re-deriving geometry the clip already knows. */
	onDragOver?(event: ReactDragEvent<HTMLButtonElement>): void;
	onDrop?(event: ReactDragEvent<HTMLButtonElement>): void;
	onSelect(event: ReactMouseEvent<HTMLButtonElement>): void;
	onDoubleClick?(event: ReactMouseEvent<HTMLButtonElement>): void;
	onContextMenu(event: ReactMouseEvent<HTMLButtonElement>): void;
}

/** One frame at the project rate, which is the keyboard's fine step. */
const FRAME_SEC = 1 / 30;
const COARSE_STEP_FACTOR = 10;

export const ClipRange = memo(function ClipRange({
	clip,
	selected,
	capabilities,
	className,
	style,
	title,
	body,
	extra,
	nudge,
	onDragOver,
	onDrop,
	onSelect,
	onDoubleClick,
	onContextMenu,
}: ClipRangeProps): JSX.Element {
	const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
		if (capabilities.readOnly || !nudge) return;
		const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
		if (direction === 0) return;
		event.preventDefault();
		/* Ctrl/Meta takes the coarse step and Shift picks the end edge, separately.
		 * Shift used to mean both at once, which made the end edge reachable only
		 * in coarse steps and the coarse step unreachable for a move. */
		const step = FRAME_SEC * (event.ctrlKey || event.metaKey ? COARSE_STEP_FACTOR : 1) * direction;
		if (event.altKey && capabilities.trimStart) {
			const start = Math.max(0, Math.min(clip.start + clip.dur - FRAME_SEC, clip.start + step));
			nudge({ start, dur: Math.max(FRAME_SEC, clip.start + clip.dur - start) });
			return;
		}
		if (event.shiftKey && capabilities.trimEnd) {
			nudge({ dur: Math.max(FRAME_SEC, clip.dur + step) });
			return;
		}
		if (!capabilities.move) return;
		nudge({ start: Math.max(0, clip.start + step) });
	};

	return (
		<button
			type="button"
			/* `data-clipid` is what the surface hit-tests. `data-vui-slot` is the
			 * published targeting contract the Playwright suite moves onto; the
			 * `tl2-*` classes remain Maleo's own styling and stay private. */
			data-clipid={clip.id}
			data-vui-slot="item"
			data-vui-focusable=""
			className={className}
			style={style}
			title={title}
			role="option"
			aria-selected={selected}
			aria-disabled={capabilities.readOnly || undefined}
			aria-label={`${clip.label}, starts at ${clip.start.toFixed(2)} seconds`}
			aria-keyshortcuts="ArrowLeft ArrowRight"
			tabIndex={selected ? 0 : -1}
			onClick={(event) => {
				if (!capabilities.select) return;
				onSelect(event);
			}}
			onDoubleClick={onDoubleClick}
			onContextMenu={onContextMenu}
			onDragOver={onDragOver}
			onDrop={onDrop}
			onKeyDown={onKeyDown}
		>
			<span className="tl2-clip-body-wrap">{body}</span>
			{extra}
			{/* Rendered only when granted. A declined capability produces no element,
			    so there is no hit area for it to leave behind. */}
			{capabilities.trimStart ? (
				<i
					className="tl2-clip-handle l"
					data-vui-slot="trim-start"
					aria-hidden="true"
					title="Trim start"
				>
					<span className="tl2-clip-resize l" />
				</i>
			) : null}
			{capabilities.trimEnd ? (
				<i
					className="tl2-clip-handle"
					data-vui-slot="trim-end"
					aria-hidden="true"
					title="Drag to change duration"
				>
					<span className="tl2-clip-resize" />
				</i>
			) : null}
		</button>
	);
});

/** Maleo's capability policy, independent of the previous implementation. */
export function clipCapabilities(input: {
	kind: "scene" | "free";
	locked: boolean;
	/** A press on an unselected clip selects it rather than dragging, on a finger. */
	touchUnselected: boolean;
	/** Too narrow to hold a body between two handles. */
	tooNarrowToTrim: boolean;
}): ClipCapabilities {
	const editable = !input.locked && !input.touchUnselected;
	const trimmable = editable && !input.tooNarrowToTrim;
	return {
		move: editable,
		/* A scene's head is the previous scene's tail, so it is rolled rather than
		 * trimmed and has no start handle of its own. */
		trimStart: trimmable && input.kind !== "scene",
		trimEnd: trimmable,
		/* Selection survives a lock: an operator still has to be able to inspect a
		 * locked clip, and the lock is about editing it. */
		select: true,
		readOnly: input.locked,
	};
}
