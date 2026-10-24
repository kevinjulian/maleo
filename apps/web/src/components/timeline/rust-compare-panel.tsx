/* Compare mode's panel (`?renderer=compare`, OpenSpec p2-render-foundation D8):
 * the Rust renderer's frame for the same storyboard and playhead as the
 * Remotion Player beside it, its frame time and its coverage report. Remotion
 * stays the preview; this panel is for looking. It is mounted only in compare
 * mode, and `useRustCompare` loads the renderer module only then. */
import { useState, type JSX } from "react";
import { Note } from "@design-system/components/note.tsx";
import { PanelHeader } from "@design-system/patterns/panel-header.tsx";
import type { PlayheadHandle } from "@models/timeline/playhead-handle.ts";
import type { FrameTimes } from "@models/timeline/rust-compare.ts";
import { useRustCompare } from "@hooks/timeline/use-rust-compare.ts";

const ms = (value: number): string => `${value.toFixed(1)} ms`;

function timesLine(times: FrameTimes | null): string {
	return times
		? `Frame ${ms(times.last)} · p50 ${ms(times.p50)} · p95 ${ms(times.p95)} (${times.count})`
		: "Waiting for a frame";
}

export function RustComparePanel({
	storyboard,
	playhead,
	fps,
	width,
	height,
}: {
	storyboard: object;
	playhead: PlayheadHandle;
	fps: number;
	width: number;
	height: number;
}): JSX.Element {
	const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
	const state = useRustCompare({ enabled: true, canvas, storyboard, playhead, fps, width, height });
	return (
		<section className="tl2-rust-compare" aria-label="Rust renderer">
			<PanelHeader
				density="compact"
				title="Rust renderer"
				sub={state.status === "ready" ? timesLine(state.times) : undefined}
			/>
			{state.status === "unavailable" && (
				<Note tone="warn" role="status">
					The Rust renderer is not available in this browser: it needs WebGPU.
				</Note>
			)}
			{state.status === "error" && (
				<Note tone="error" role="alert">
					The Rust renderer failed: {state.message}
				</Note>
			)}
			{state.status === "loading" && <Note role="status">Loading the Rust renderer…</Note>}
			<canvas
				ref={setCanvas}
				className="tl2-rust-compare-canvas"
				width={width}
				height={height}
				hidden={state.status === "unavailable" || state.status === "error"}
				style={{ aspectRatio: `${width} / ${height}` }}
			/>
			{state.status === "ready" &&
				(state.coverage.length === 0 ? (
					<Note tone="muted">Every element at this frame is drawn.</Note>
				) : (
					<ul className="tl2-rust-compare-coverage" aria-label="Not drawn yet">
						{state.coverage.map((entry) => (
							<li key={`${entry.path}:${entry.reason}`}>
								<code>{entry.path}</code> {entry.reason}
							</li>
						))}
					</ul>
				))}
		</section>
	);
}
