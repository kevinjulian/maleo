import { describe, expect, it } from "vite-plus/test";
import { compositionConfigSchema, compositionParams } from "./composition-schema.ts";
import { compileMotion } from "./motion-compile.ts";
import { MOTION_EXAMPLES } from "./motion-examples.ts";
import { motionSamples, overlayGeometryAt } from "./motion-geometry.ts";
import type { MotionIntent } from "./motion-intent.ts";
import { lintMotion } from "./motion-lint.ts";
import { MOTION_RULES } from "./motion-tokens.ts";

const example = (presentation: string) =>
	MOTION_EXAMPLES.find((e) => e.presentation === presentation)!;
const compile = (presentation: string) => {
	const e = example(presentation);
	return compileMotion(e.intent, { spanSec: e.spanSec });
};
const layer = (config: ReturnType<typeof compile>, intent: MotionIntent, id: string) =>
	config.overlays[intent.layers.findIndex((l) => l.id === id)]!;

/** First sampled time a layer's geometry differs from its first sample. */
const firstMove = (overlay: ReturnType<typeof compile>["overlays"][number]) => {
	const samples = motionSamples(overlay, 240);
	const g0 = samples[0]!.g;
	return samples.find(({ g }) =>
		Object.keys(g).some((k) => Math.abs(g[k as keyof typeof g] - g0[k as keyof typeof g0]) > 1e-6),
	)?.t;
};

describe("compileMotion", () => {
	it("compiles the same intent to an equal composition", () => {
		for (const e of MOTION_EXAMPLES)
			expect(compileMotion(e.intent, { spanSec: e.spanSec })).toEqual(
				compileMotion(e.intent, { spanSec: e.spanSec }),
			);
	});

	it("produces supported compositions that survive the params round trip", () => {
		for (const e of MOTION_EXAMPLES) {
			const config = compileMotion(e.intent, { spanSec: e.spanSec });
			expect(compositionConfigSchema.parse(config)).toEqual(config);
			expect(compositionConfigSchema.parse(compositionParams(config))).toEqual(config);
			for (const overlay of config.overlays)
				expect(overlay.relStart + overlay.dur).toBeLessThanOrEqual(e.spanSec + 1e-9);
		}
	});

	it("starts the secondary 100 to 200 ms after the hero", () => {
		const config = compile("explainer"),
			intent = example("explainer").intent;
		const hero = firstMove(layer(config, intent, "claim"))!,
			secondary = firstMove(layer(config, intent, "evidence"))!;
		expect(secondary - hero).toBeGreaterThanOrEqual(0.1 - 1e-6);
		expect(secondary - hero).toBeLessThanOrEqual(0.2 + 1e-6);
	});

	it("cascades many secondaries so no two start on the same frame", () => {
		const base = example("headline");
		const dots = Array.from({ length: 6 }, (_, i) => ({
			id: `dot-${i}`,
			primitive: "shape-circle" as const,
			content: "",
			role: "secondary" as const,
			class: "accent" as const,
			box: { xPct: 10 + i * 12, yPct: 70, widthPct: 4, heightPct: 4 },
			opacity: 1,
			enter: { state: "in", from: "up" as const },
		}));
		const intent: MotionIntent = { ...base.intent, layers: [...base.intent.layers, ...dots] };
		const config = compileMotion(intent, { spanSec: 4 });
		const starts = config.overlays.slice(3).map((o) => o.relStart);
		for (let i = 1; i < starts.length; i++)
			expect(starts[i]! - starts[i - 1]!).toBeCloseTo(MOTION_RULES.cascadeGapSec, 6);
		expect(lintMotion(config).filter((f) => f.code === "simultaneous_large_moves")).toEqual([]);
	});

	it("starts text once its container is half way through its move", () => {
		const config = compile("headline"),
			intent = example("headline").intent;
		const bar = layer(config, intent, "bar"),
			title = layer(config, intent, "title");
		expect(bar.relStart).toBe(0);
		expect(title.relStart).toBeCloseTo(0.3, 6);
	});

	it("never takes opacity past its start or end value", () => {
		for (const e of MOTION_EXAMPLES) {
			const config = compileMotion(e.intent, { spanSec: e.spanSec });
			config.overlays.forEach((overlay, i) => {
				const max = e.intent.layers[i]!.opacity;
				for (const { g } of motionSamples(overlay, 240)) {
					expect(g.opacity).toBeGreaterThanOrEqual(0);
					expect(g.opacity).toBeLessThanOrEqual(max + 1e-3);
				}
			});
		}
	});

	it("leads an indicator with its front edge, so it stretches while moving", () => {
		const base = example("explainer");
		const intent: MotionIntent = {
			...base.intent,
			states: [
				{ id: "in", atSec: 0, changes: [] },
				{ id: "focus", atSec: 2, changes: [{ layer: "marker", xPct: 50 }] },
			],
		};
		const marker = layer(compileMotion(intent, { spanSec: 3.6 }), intent, "marker");
		const widths = motionSamples(marker, 240)
			.filter(({ t }) => t > 2 && t < 2.5)
			.map(({ g }) => g.width);
		expect(Math.max(...widths)).toBeGreaterThan(30 + 2);
		expect(overlayGeometryAt(marker, 3.5)!.width).toBeCloseTo(30, 1);
		expect(overlayGeometryAt(marker, 3.5)!.left).toBeCloseTo(50, 1);
	});

	it("moves an indicator's top and bottom edges together", () => {
		const config = compile("explainer"),
			intent = example("explainer").intent;
		const marker = layer(config, intent, "marker");
		for (const { g } of motionSamples(marker, 240)) expect(g.height).toBeCloseTo(1.2, 3);
	});

	it("lands every resting layer on its box", () => {
		const config = compile("headline"),
			intent = example("headline").intent;
		const title = overlayGeometryAt(layer(config, intent, "title"), 2.4)!;
		expect(title.top).toBeCloseTo(42, 1);
		expect(title.opacity).toBeCloseTo(1, 3);
	});

	it("keeps ambient layers moving within their amplitude", () => {
		const config = compile("headline"),
			intent = example("headline").intent;
		const spark = layer(config, intent, "spark");
		const tops = motionSamples(spark, 60).map(({ g }) => g.top);
		expect(Math.max(...tops) - Math.min(...tops)).toBeGreaterThan(1);
		for (const top of tops)
			expect(Math.abs(top - 34)).toBeLessThanOrEqual(MOTION_RULES.ambientAmplitudePct + 0.05);
	});

	it("makes an exit shorter than the same layer's entrance", () => {
		const base = example("headline");
		const intent: MotionIntent = {
			...base.intent,
			layers: base.intent.layers.map((l) =>
				l.id === "title" ? { ...l, exit: { state: "out", to: "up" } } : l,
			),
			states: [...base.intent.states, { id: "out", atSec: 2, changes: [] }],
		};
		const title = compileMotion(intent, { spanSec: 3 }).overlays[1]!;
		const samples = motionSamples(title, 240);
		const rest = samples.filter(
			({ t, g }) => t > 0.3 && t < 2 && Math.abs(g.top - 42) < 0.05 && g.opacity > 0.999,
		);
		const entrance = rest[0]!.t - title.relStart;
		const exit = title.relStart + title.dur - 2;
		expect(exit).toBeLessThan(entrance);
		expect(overlayGeometryAt(title, title.relStart + title.dur)!.opacity).toBeCloseTo(0, 3);
	});

	it("keeps keys few", () => {
		for (const e of MOTION_EXAMPLES)
			for (const overlay of compileMotion(e.intent, { spanSec: e.spanSec }).overlays)
				for (const keys of Object.values(overlay.anim?.tracks ?? {}))
					expect(keys!.length).toBeLessThanOrEqual(40);
	});
});
