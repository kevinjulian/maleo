/* TEST SUPPORT: does a renderer adapter satisfy the renderer contract?
 *
 * Moved from VUI's shipped conformance kit (task 4.9) beside the one adapter
 * it now holds, the Remotion renderer, so the contract is a suite the adapter
 * passes rather than a claim.
 *
 * It returns a report rather than calling anyone's `expect`, because a consumer
 * runs it in whatever runner they already have. Every failure names the rule of
 * the contract that was broken, since "expected 3 to be 2" tells an adapter
 * author nothing about their adapter.
 */
import {
	conformanceReport,
	type ConformanceCheck,
	type ConformanceReport,
} from "@maleo/shared/editor";
import { projectTime, type ProjectTime } from "@models/timeline-view/tick.ts";
import type { Timebase } from "@models/timeline-view/timebase.ts";
import { checkRendererContractVersion, type RendererAdapter } from "./renderer-contract.ts";

/** What the suite needs to drive an adapter it knows nothing else about. */
export interface RendererConformanceOptions {
	/** Build a fresh adapter. Called once per rule that needs a clean one. */
	create(): RendererAdapter & { dispose?(): void };
	/** The timebase the adapter is expected to report. */
	readonly timebase: Timebase;
	/** A position inside the renderer's duration, for the seek rules. */
	readonly seekTo: ProjectTime;
	/**
	 * Let the adapter settle after a command.
	 *
	 * Synchronous by default. A real player answers asynchronously, so a consumer
	 * passes a function that flushes their own queue.
	 */
	settle?(): void;
}

function check(
	rule: string,
	requirement: string,
	passed: boolean,
	detail?: string,
): ConformanceCheck {
	return { rule, requirement, passed, detail: passed ? undefined : detail };
}

export const RENDERER_CONFORMANCE_RULES = [
	"contract-version",
	"snapshot-shape",
	"readiness",
	"time-reporting",
	"seek-clamping",
	"play-pause",
	"subscription",
	"teardown",
] as const;

/** Run every renderer rule against one adapter. */
export function rendererConformance(options: RendererConformanceOptions): ConformanceReport {
	const settle = options.settle ?? ((): void => undefined);
	const checks: ConformanceCheck[] = [];

	const adapter = options.create();
	const snapshot = adapter.getSnapshot();

	checks.push(
		check(
			"contract-version",
			"An adapter declares a contract version this build supports.",
			checkRendererContractVersion(adapter.contractVersion).accepted,
			`declared ${adapter.contractVersion}`,
		),
	);

	checks.push(
		check(
			"snapshot-shape",
			"A snapshot reports dimensions, duration, and the project timebase.",
			snapshot.widthPx > 0 &&
				snapshot.heightPx > 0 &&
				snapshot.duration.ticks >= 0 &&
				snapshot.timebase.ticksPerSecond.numerator === options.timebase.ticksPerSecond.numerator &&
				snapshot.timebase.ticksPerSecond.denominator ===
					options.timebase.ticksPerSecond.denominator &&
				snapshot.timebase.ticksPerFrame === options.timebase.ticksPerFrame,
			`got ${snapshot.widthPx}x${snapshot.heightPx}, duration ${snapshot.duration.ticks} ticks, tick rate ${snapshot.timebase.ticksPerSecond.numerator}/${snapshot.timebase.ticksPerSecond.denominator}`,
		),
	);

	checks.push(
		check(
			"readiness",
			"An adapter reports readiness, and reports a boolean for it before it is ready.",
			typeof snapshot.ready === "boolean",
			`ready was ${String(snapshot.ready)}`,
		),
	);

	/* Time reporting and seeking are one interaction: seek, settle, and read.
	 * A renderer that accepted the seek and never moved passes a "seek does not
	 * throw" test and fails this one, which is the point. */
	adapter.seek(options.seekTo);
	settle();
	const afterSeek = adapter.getSnapshot();
	checks.push(
		check(
			"time-reporting",
			"After a seek the adapter reports the position it was asked for.",
			afterSeek.currentTime.ticks === options.seekTo.ticks,
			`asked for ${options.seekTo.ticks} ticks, reported ${afterSeek.currentTime.ticks}`,
		),
	);

	/* Past the end and before the beginning. A renderer that clamps to its own
	 * duration keeps the timeline's arithmetic and its own in agreement; one
	 * that reports a position outside its duration makes every consumer clamp. */
	adapter.seek(projectTime(snapshot.duration.ticks * 4));
	settle();
	const beyond = adapter.getSnapshot().currentTime.ticks;
	adapter.seek(projectTime(-snapshot.duration.ticks));
	settle();
	const before = adapter.getSnapshot().currentTime.ticks;
	checks.push(
		check(
			"seek-clamping",
			"A seek outside the duration is clamped into it, never reported outside.",
			beyond <= snapshot.duration.ticks && before >= 0,
			`beyond the end reported ${beyond}, before the start reported ${before}, duration is ${snapshot.duration.ticks}`,
		),
	);

	adapter.play();
	settle();
	const playing = adapter.getSnapshot().playing;
	adapter.pause();
	settle();
	const paused = adapter.getSnapshot().playing;
	checks.push(
		check(
			"play-pause",
			"Play and pause are reflected in the reported play state.",
			playing && !paused,
			`play reported ${playing}, pause reported ${paused}`,
		),
	);

	let notified = 0;
	const unsubscribe = adapter.subscribe(() => {
		notified += 1;
	});
	adapter.seek(projectTime(0));
	settle();
	const notifiedWhileSubscribed = notified;
	unsubscribe();
	adapter.seek(options.seekTo);
	settle();
	checks.push(
		check(
			"subscription",
			"Subscribers are notified of changes, and stop being notified once unsubscribed.",
			notifiedWhileSubscribed > 0 && notified === notifiedWhileSubscribed,
			`notified ${notifiedWhileSubscribed} times while subscribed, ${notified - notifiedWhileSubscribed} times after unsubscribing`,
		),
	);

	/* Teardown last, and its own adapter: a suite that tore down the one it had
	 * been using would be asserting nothing about a fresh one. */
	const disposable = options.create();
	let leaked = 0;
	disposable.subscribe(() => {
		leaked += 1;
	});
	disposable.dispose?.();
	disposable.seek(options.seekTo);
	settle();
	checks.push(
		check(
			"teardown",
			"After disposal an adapter notifies nobody.",
			leaked === 0,
			`notified ${leaked} times after disposal`,
		),
	);
	adapter.dispose?.();

	return conformanceReport("renderer", checks);
}
