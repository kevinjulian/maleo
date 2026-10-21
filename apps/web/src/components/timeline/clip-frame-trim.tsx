/* Frame-accurate In and Out for a clip.
 *
 * This is the one control in the touch work where the phone beats the desktop
 * affordance rather than approximating it. At normal zoom a frame is well under
 * a pixel wide, so trimming by dragging an edge — with a finger OR a mouse —
 * cannot resolve one; the drag quantises to 0.1s and the operator lands on
 * whichever frame the arithmetic gives them. A stepper resolves exactly one
 * frame, every time, at any zoom.
 *
 * So the split is deliberate rather than a fallback: handles position the clip
 * roughly, and this makes it exact. Trim is coarse by gesture, fine by control.
 *
 * In and Out rather than Start and Duration, because that is what the operator
 * is looking at. Moving Out changes duration and leaves In alone; moving In
 * changes start AND duration so the Out edge does not walk — which is what a
 * trim means and what "Start / Duration" number boxes silently get wrong the
 * first time someone drags the start.
 */
import type { JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { FieldRow } from "@design-system/patterns/inspector.tsx";
import { Note } from "@design-system/components/note.tsx";

/** Seconds, rendered as the timecode plus the frame within the second — the
 *  frame number is the whole point of the control, so it is shown. */
function fmtFrames(sec: number, fps: number): string {
	const total = Math.round(sec * fps);
	const f = total % fps;
	const s = Math.floor(total / fps);
	return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}.${String(f).padStart(2, "0")}`;
}

/** Snap to the frame grid. Every value this control writes passes through here,
 *  so a clip edited by stepper always lands on a frame boundary even if the
 *  drag that preceded it did not. */
function toFrame(sec: number, fps: number): number {
	return Math.round(sec * fps) / fps;
}

export function ClipFrameTrim({
	start,
	dur,
	fps,
	total,
	minDur = 0.1,
	onChange,
}: {
	start: number;
	dur: number;
	fps: number;
	/** Timeline length, so Out cannot be stepped past the end of the project. */
	total: number;
	minDur?: number;
	onChange: (patch: { start: number; dur: number }) => void;
}): JSX.Element {
	const step = 1 / fps;
	const end = start + dur;

	/* In moves the start edge and keeps the out edge fixed. Bounded at 0 and at
	 * one minimum-duration short of the out edge, so a held stepper cannot
	 * invert the clip. */
	const setIn = (nextStart: number): void => {
		const s = Math.max(0, Math.min(end - minDur, toFrame(nextStart, fps)));
		onChange({ start: s, dur: end - s });
	};
	/* Out moves the end edge, so only duration changes. */
	const setOut = (nextEnd: number): void => {
		const e = Math.max(start + minDur, Math.min(total, toFrame(nextEnd, fps)));
		onChange({ start, dur: e - start });
	};

	const row = (label: string, value: number, apply: (next: number) => void): JSX.Element => (
		<div className="tl2-frametrim-row" data-cell="trim">
			<span className="tl2-frametrim-label">{label}</span>
			<button
				type="button"
				className="tl2-frametrim-step"
				aria-label={`${label} back one frame`}
				onClick={() => apply(value - step)}
			>
				{Ic.chevronLeft(ICON.sm)}
			</button>
			<b className="tl2-frametrim-value">{fmtFrames(value, fps)}</b>
			<button
				type="button"
				className="tl2-frametrim-step"
				aria-label={`${label} forward one frame`}
				onClick={() => apply(value + step)}
			>
				{Ic.chevronRight(ICON.sm)}
			</button>
		</div>
	);

	return (
		<div className="tl2-frametrim">
			<FieldRow label="Trim">
				{row("In", start, setIn)}
				{row("Out", end, setOut)}
			</FieldRow>
			<Note>
				One frame at {Math.round(fps)}fps. A frame is smaller than a pixel at normal zoom, so drag
				the handles to place a clip and step here to land it.
			</Note>
		</div>
	);
}
