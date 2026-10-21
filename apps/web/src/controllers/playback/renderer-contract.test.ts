/* The renderer contract, and the suite that holds an adapter to it.
 *
 * Moved with the contract from VUI (task 4.9). The document contract's half of
 * this file retired with it: the editor's document boundary is the command
 * executor now, held by `@maleo/shared`'s executor conformance suite. */
import { describe, expect, test } from "vite-plus/test";
import { describeFailures } from "@maleo/shared/editor";
import { framesToProject, projectTime, type ProjectTime } from "@models/timeline-view/tick.ts";
import { rational } from "@models/timeline-view/rational.ts";
import { timebase } from "@models/timeline-view/timebase.ts";
import { rendererConformance } from "./renderer-conformance.ts";
import {
	createRendererBinding,
	RENDERER_CONTRACT_VERSION,
	type RendererAdapter,
	type RendererSnapshot,
} from "./renderer-contract.ts";

const BASE = timebase(rational(30, 1));

/** A fake renderer that behaves, so a misbehaving one has something to differ from. */
function fakeRenderer(
	overrides: Partial<{ clamp: boolean; reportSeeks: boolean; notifyAfterDispose: boolean }> = {},
) {
	const clamp = overrides.clamp ?? true;
	const duration = framesToProject(300, BASE);
	let snapshot: RendererSnapshot = {
		widthPx: 1920,
		heightPx: 1080,
		duration,
		timebase: BASE,
		ready: true,
		currentTime: projectTime(0),
		playing: false,
	};
	let disposed = false;
	const listeners = new Set<() => void>();
	const notify = (): void => {
		if (disposed && overrides.notifyAfterDispose !== true) return;
		for (const listener of [...listeners]) listener();
	};
	const adapter: RendererAdapter & { dispose(): void; seeks: number[] } = {
		contractVersion: RENDERER_CONTRACT_VERSION,
		seeks: [],
		getSnapshot: () => snapshot,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		seek(to) {
			adapter.seeks.push(to.ticks);
			if (overrides.reportSeeks === false) return;
			const ticks = clamp ? Math.max(0, Math.min(duration.ticks, to.ticks)) : to.ticks;
			snapshot = { ...snapshot, currentTime: projectTime(ticks) };
			notify();
		},
		play() {
			snapshot = { ...snapshot, playing: true };
			notify();
		},
		pause() {
			snapshot = { ...snapshot, playing: false };
			notify();
		},
		dispose() {
			disposed = true;
			if (overrides.notifyAfterDispose !== true) listeners.clear();
		},
	};
	return adapter;
}

/* ---- 11.3, 11.4 The renderer contract and seek suppression ----------------- */

describe("renderer contract", () => {
	test("a fake renderer satisfies the contract in a unit fixture", () => {
		const adapter = fakeRenderer();
		const binding = createRendererBinding({ adapter });
		const snapshot = binding.snapshot();

		expect(snapshot.widthPx).toBe(1920);
		expect(snapshot.timebase.ticksPerFrame).toBe(BASE.ticksPerFrame);
		expect(snapshot.ready).toBe(true);
		binding.play();
		expect(binding.snapshot().playing).toBe(true);
		binding.pause();
		expect(binding.snapshot().playing).toBe(false);
		binding.dispose();
	});

	test("one external seek produces one command and settles at the requested time", () => {
		const adapter = fakeRenderer();
		const binding = createRendererBinding({ adapter });
		const target: ProjectTime = framesToProject(45, BASE);

		binding.seek(target);
		expect(binding.commandCount()).toBe(1);
		expect(binding.snapshot().currentTime.ticks).toBe(target.ticks);

		/* The renderer's report of the position we asked for is not new input.
		 * Re-issuing it is the loop that makes a playhead fight a scrubber. */
		binding.seek(target);
		expect(binding.commandCount()).toBe(1);
		expect(adapter.seeks.length).toBe(1);
	});

	test("several distinct seeks produce no more commands than distinct positions", () => {
		const adapter = fakeRenderer();
		const binding = createRendererBinding({ adapter });
		const positions = [10, 20, 20, 30, 30, 30, 40].map((frame) => framesToProject(frame, BASE));
		for (const position of positions) binding.seek(position);

		const distinct = new Set(positions.map((position) => position.ticks)).size;
		expect(distinct).toBe(4);
		expect(binding.commandCount()).toBeLessThanOrEqual(distinct);
		expect(binding.snapshot().currentTime.ticks).toBe(framesToProject(40, BASE).ticks);
	});

	test("a renderer that never reports the seek does not get it re-sent forever", () => {
		const adapter = fakeRenderer({ reportSeeks: false });
		const binding = createRendererBinding({ adapter });
		const target = framesToProject(45, BASE);
		binding.seek(target);
		binding.seek(target);
		binding.seek(target);
		/* Still one command: the request is outstanding, and asking again for the
		 * position already asked for is the echo case whether or not the renderer
		 * has answered yet. */
		expect(adapter.seeks).toEqual([target.ticks]);
	});
});

/* ---- 11.5 Contract versions ------------------------------------------------ */

describe("contract versions", () => {
	test("an unsupported renderer version is refused with a diagnostic naming both", () => {
		const adapter = { ...fakeRenderer(), contractVersion: 99 };
		expect(() => createRendererBinding({ adapter })).toThrow(
			`this renderer adapter declares contract version 99, but this build supports ${RENDERER_CONTRACT_VERSION}.`,
		);
	});
});

/* ---- 11.6, 11.7 The conformance suites ------------------------------------- */

describe("conformance suites", () => {
	const rendererOptions = { timebase: BASE, seekTo: framesToProject(45, BASE) };

	test("a correct renderer adapter passes every rule", () => {
		const report = rendererConformance({ create: () => fakeRenderer(), ...rendererOptions });
		expect(describeFailures(report)).toBeUndefined();
		expect(report.passed).toBe(true);
		expect(report.checks.length).toBe(8);
	});

	test("a renderer that does not clamp fails, and the failure names the rule", () => {
		const report = rendererConformance({
			create: () => fakeRenderer({ clamp: false }),
			...rendererOptions,
		});
		expect(report.passed).toBe(false);
		const failed = report.checks.filter((check) => !check.passed).map((check) => check.rule);
		expect(failed).toEqual(["seek-clamping"]);
		/* The message describes the contract, not the assertion that noticed. */
		expect(describeFailures(report)).toMatch(
			/seek-clamping: A seek outside the duration is clamped/,
		);
		expect(describeFailures(report)).toMatch(/beyond the end reported/);
	});

	test("a renderer that ignores seeks fails time reporting", () => {
		const report = rendererConformance({
			create: () => fakeRenderer({ reportSeeks: false }),
			...rendererOptions,
		});
		expect(report.checks.find((check) => check.rule === "time-reporting")!.passed).toBe(false);
		expect(describeFailures(report)).toMatch(/asked for \d+ ticks, reported 0/);
	});

	test("a renderer that keeps notifying after disposal fails teardown", () => {
		const report = rendererConformance({
			create: () => fakeRenderer({ notifyAfterDispose: true }),
			...rendererOptions,
		});
		expect(report.checks.find((check) => check.rule === "teardown")!.passed).toBe(false);
	});
});
