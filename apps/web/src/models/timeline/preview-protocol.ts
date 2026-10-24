/* The preview worker's message protocol (OpenSpec p2-preview-runtime D5).
 * The worker (`preview-worker/worker.ts`) runs the engine's preview session
 * (`crates/preview` through `crates/renderer-wasm`); the main thread talks to
 * it through `preview-client.ts`. Times are seconds on the shared clock
 * `(performance.timeOrigin + performance.now()) / 1000`, which the page and
 * the worker read alike. */
import type { CoverageEntry, FrameTimes } from "./rust-compare.ts";

/** Main thread to worker. */
export type PreviewRequest =
	| { type: "init"; canvas: OffscreenCanvas }
	| { type: "storyboard"; json: string; fps: number; durationFrames: number; images: string[] }
	| { type: "seek"; frame: number }
	| { type: "play"; position: number; at: number; rate: number }
	| { type: "pause"; position: number }
	| { type: "remotion"; position: number; at: number }
	| { type: "resize"; width: number; height: number };

export type PreviewStatus = "loading" | "ready" | "playing" | "paused" | "device-lost" | "failed";

/** The session's state (`crates/renderer-wasm` `state()`), plus the last
 *  refused request, if any. */
export interface PreviewState {
	status: PreviewStatus;
	message: string | null;
	position: number;
	frame: number;
	dropped: number;
	times: FrameTimes | null;
	/** The session's playhead minus Remotion's, in frames. */
	drift: number | null;
	coverage: CoverageEntry[];
	error: string | null;
}

/** Worker to main thread. */
export type PreviewEvent = { type: "state"; state: PreviewState };

/** The shared clock, in seconds. */
export function previewNow(): number {
	return (performance.timeOrigin + performance.now()) / 1000;
}

const STATUSES: readonly PreviewStatus[] = [
	"loading",
	"ready",
	"playing",
	"paused",
	"device-lost",
	"failed",
];

function isStatus(value: unknown): value is PreviewStatus {
	return STATUSES.some((status) => status === value);
}

/** Reads a state message; anything else is refused by name. */
export function parsePreviewEvent(data: unknown): PreviewEvent {
	// SAFETY: every field read below is checked before it is used.
	const event = data as { type?: unknown; state?: Partial<PreviewState> } | null;
	const state = event?.state;
	const status = state?.status;
	if (event?.type !== "state" || !state || !isStatus(status)) {
		throw new Error(`preview worker: unexpected message ${JSON.stringify(data)}`);
	}
	return {
		type: "state",
		state: {
			status,
			message: state.message ?? null,
			position: state.position ?? 0,
			frame: state.frame ?? 0,
			dropped: state.dropped ?? 0,
			times: state.times ?? null,
			drift: state.drift ?? null,
			coverage: state.coverage ?? [],
			error: state.error ?? null,
		},
	};
}
