/* The renderer contract: something that shows frames and reports where it is.
 *
 * Remotion, a `<video>`, a WebGL compositor, a remote preview — the timeline
 * does not care which, and the contract is deliberately small enough that all
 * four can satisfy it honestly.
 *
 * The hard part is not the method list, it is the feedback: a renderer reports
 * its time continuously, and a seek the timeline asked for comes back as a time
 * report. Treating that report as new input makes the playhead fight the
 * scrubber — the defect this contract's `seek` bookkeeping exists to prevent.
 */
import type { ProjectTime } from "@models/timeline-view/tick.ts";
import type { Timebase } from "@models/timeline-view/timebase.ts";

/** The renderer contract version this build speaks. An adapter declares the
 *  version it implements and is accepted or refused by name, so a mismatch is
 *  reported as a mismatch rather than as a missing method later. */
export const RENDERER_CONTRACT_VERSION = 1;
const SUPPORTED_RENDERER_CONTRACT_VERSIONS: readonly number[] = [RENDERER_CONTRACT_VERSION];

export type ContractCheck =
	| { readonly accepted: true }
	| { readonly accepted: false; readonly diagnostic: string };

/** Accept a declared renderer contract version, or refuse it naming both sides. */
export function checkRendererContractVersion(declared: number): ContractCheck {
	if (SUPPORTED_RENDERER_CONTRACT_VERSIONS.includes(declared)) return { accepted: true };
	return {
		accepted: false,
		diagnostic: `this renderer adapter declares contract version ${declared}, but this build supports ${SUPPORTED_RENDERER_CONTRACT_VERSIONS.join(", ")}.`,
	};
}

/** What a renderer is showing, at one moment. */
export interface RendererSnapshot {
	readonly widthPx: number;
	readonly heightPx: number;
	readonly duration: ProjectTime;
	readonly timebase: Timebase;
	/** False until the renderer can seek and play. */
	readonly ready: boolean;
	readonly currentTime: ProjectTime;
	readonly playing: boolean;
}

/** A renderer, as the library sees it. */
export interface RendererAdapter {
	readonly contractVersion: number;
	/** The current snapshot. Referentially stable until something changes. */
	getSnapshot(): RendererSnapshot;
	/** Told when the snapshot changed. Returns the unsubscribe. */
	subscribe(listener: () => void): () => void;
	/** Go to a time. Clamped by the renderer to its own duration. */
	seek(to: ProjectTime): void;
	play(): void;
	pause(): void;
}

/** A renderer with the timeline's seek bookkeeping in front of it. */
export interface RendererBinding {
	snapshot(): RendererSnapshot;
	subscribe(listener: () => void): () => void;
	/** Seek, unless this position has already been asked for. */
	seek(to: ProjectTime): void;
	play(): void;
	pause(): void;
	/** How many seek commands actually reached the renderer. */
	commandCount(): number;
	dispose(): void;
}

export interface RendererBindingOptions {
	readonly adapter: RendererAdapter;
	/**
	 * How close two positions have to be to count as the same one, in ticks.
	 *
	 * Zero by default: times are exact integers here, so "the same position" is
	 * an equality rather than a tolerance. A consumer whose renderer reports at a
	 * coarser rate than the project's timebase can widen it.
	 */
	readonly toleranceTicks?: number;
}

/**
 * Bind a renderer, suppressing the feedback its own seeks produce.
 *
 * One external seek becomes exactly one command, and the report that comes back
 * settles at the requested time rather than being re-issued. Several distinct
 * seeks produce no more commands than there were distinct positions — a scrub
 * that reports sixty positions per second is sixty commands at most, never sixty
 * plus sixty echoes.
 */
export function createRendererBinding(options: RendererBindingOptions): RendererBinding {
	const check = checkRendererContractVersion(options.adapter.contractVersion);
	if (!check.accepted) throw new Error(check.diagnostic);
	const tolerance = options.toleranceTicks ?? 0;
	const { adapter } = options;

	let requested: number | undefined;
	let commands = 0;

	/* The renderer's own report clears the outstanding request once it arrives at
	 * the requested position. Until then a repeat of that position is the echo of
	 * a command already sent, not a new instruction. */
	const unsubscribe = adapter.subscribe(() => {
		if (requested === undefined) return;
		if (Math.abs(adapter.getSnapshot().currentTime.ticks - requested) <= tolerance)
			requested = undefined;
	});

	return {
		snapshot: () => adapter.getSnapshot(),
		subscribe: (listener) => adapter.subscribe(listener),
		seek(to) {
			const current = adapter.getSnapshot().currentTime.ticks;
			if (requested !== undefined && Math.abs(to.ticks - requested) <= tolerance) return;
			if (requested === undefined && Math.abs(to.ticks - current) <= tolerance) return;
			requested = to.ticks;
			commands += 1;
			adapter.seek(to);
		},
		play: () => adapter.play(),
		pause: () => adapter.pause(),
		commandCount: () => commands,
		dispose() {
			unsubscribe();
			requested = undefined;
		},
	};
}
