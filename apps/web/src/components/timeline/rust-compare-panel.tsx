/* Compare mode's panel (`?renderer=compare`, OpenSpec p2-render-foundation D8,
 * p2-preview-runtime): the Rust preview session's frame for the same
 * storyboard as the Remotion Player beside it, playing on its own clock, with
 * its frame time, dropped frames, its drift from the Remotion playhead and
 * its coverage report. Remotion
 * stays the preview; this panel is for looking. It is mounted only in compare
 * mode, and `useRustCompare` loads the renderer module only then. */
import { useMemo, useState, type JSX, type MutableRefObject } from "react";
import type { PlayerRef } from "@remotion/player";
import { Note } from "@design-system/components/note.tsx";
import { PanelHeader } from "@design-system/patterns/panel-header.tsx";
import type { PlayheadHandle } from "@models/timeline/playhead-handle.ts";
import type { PreviewState } from "@models/timeline/preview-protocol.ts";
import { playerSignals, useRustCompare } from "@hooks/timeline/use-rust-compare.ts";

const ms = (value: number): string => `${value.toFixed(1)} ms`;

/** The session's frame times, dropped frames and drift, in one line. */
export function sessionLine(preview: PreviewState): string {
	const { times, dropped, drift } = preview;
	const frame = times
		? `Frame ${ms(times.last)} · p50 ${ms(times.p50)} · p95 ${ms(times.p95)} (${times.count})`
		: "Waiting for a frame";
	const rounded = drift == null ? null : Math.round(drift);
	const driftText = rounded == null ? "drift —" : `drift ${rounded > 0 ? "+" : ""}${rounded} f`;
	return `${frame} · ${dropped} dropped · ${driftText}`;
}

export function RustComparePanel({
	storyboard,
	playhead,
	playerRef,
	fps,
	durationFrames,
	width,
	height,
}: {
	storyboard: object;
	playhead: PlayheadHandle;
	playerRef: MutableRefObject<PlayerRef | null>;
	fps: number;
	durationFrames: number;
	width: number;
	height: number;
}): JSX.Element {
	const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
	const player = useMemo(() => playerSignals(playerRef), [playerRef]);
	const state = useRustCompare({
		enabled: true,
		canvas,
		storyboard,
		playhead,
		player,
		fps,
		durationFrames,
		width,
		height,
	});
	return (
		<section className="tl2-rust-compare" aria-label="Rust renderer">
			<PanelHeader
				density="compact"
				title="Rust renderer"
				sub={state.status === "ready" ? sessionLine(state.preview) : undefined}
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
			{state.status === "ready" && state.preview.error && (
				<Note tone="error" role="alert">
					The Rust preview refused a change: {state.preview.error}
				</Note>
			)}
			{state.status === "ready" &&
				(state.preview.coverage.length === 0 ? (
					<Note tone="muted">Every element at this frame is drawn.</Note>
				) : (
					<ul className="tl2-rust-compare-coverage" aria-label="Not drawn yet">
						{state.preview.coverage.map((entry) => (
							<li key={`${entry.path}:${entry.reason}`}>
								<code>{entry.path}</code> {entry.reason}
							</li>
						))}
					</ul>
				))}
		</section>
	);
}
