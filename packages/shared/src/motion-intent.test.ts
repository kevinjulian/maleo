import { describe, expect, it } from "vite-plus/test";
import { MOTION_EXAMPLES } from "./motion-examples.ts";
import { layersMovingIn, parseMotionIntent, type MotionIntent } from "./motion-intent.ts";

const headline = MOTION_EXAMPLES.find((e) => e.presentation === "headline")!;
const withLayers = (patch: (intent: MotionIntent) => MotionIntent) =>
	patch(structuredClone(headline.intent));

describe("parseMotionIntent", () => {
	it("accepts every reference example against its own source text", () => {
		for (const example of MOTION_EXAMPLES)
			expect(parseMotionIntent(example.intent, example.spanSec, example.sourceText)).toEqual({
				ok: true,
				intent: example.intent,
			});
	});

	it("refuses an unknown or retired primitive, naming the layer", () => {
		const intent = withLayers((i) => ({
			...i,
			layers: i.layers.map((l) =>
				l.id === "bar" ? { ...l, primitive: "lower-third" as never } : l,
			),
		}));
		const result = parseMotionIntent(intent, 2.4);
		expect(result.ok).toBe(false);
		expect(!result.ok && result.error).toMatch(/layers\.0\.primitive/);
	});

	it("refuses two heroes in one state change, naming the state", () => {
		const intent = withLayers((i) => ({
			...i,
			layers: i.layers.map((l) => (l.id === "bar" ? { ...l, role: "hero" as const } : l)),
		}));
		expect(parseMotionIntent(intent, 2.4)).toEqual({
			ok: false,
			error: 'state "in" must move at most one hero layer, found 2',
		});
	});

	it("accepts a state led by a secondary layer when the hero stays still", () => {
		const intent = withLayers((i) => ({
			...i,
			states: [...i.states, { id: "nudge", atSec: 1.2, changes: [{ layer: "bar", yPct: 30 }] }],
		}));
		expect(parseMotionIntent(intent, 2.4).ok).toBe(true);
	});

	it("refuses a state that moves nothing", () => {
		const intent = withLayers((i) => ({
			...i,
			states: [...i.states, { id: "idle", atSec: 1.2, changes: [] }],
		}));
		expect(parseMotionIntent(intent, 2.4)).toEqual({
			ok: false,
			error: 'state "idle" moves no layer',
		});
	});

	it("reads a change's layer from id, target or layerId", () => {
		for (const key of ["id", "target", "layerId"]) {
			const raw = JSON.parse(JSON.stringify(headline.intent));
			raw.states.push({ id: "nudge", atSec: 1.2, changes: [{ [key]: "bar", yPct: 30 }] });
			const result = parseMotionIntent(raw, 2.4);
			expect(result.ok).toBe(true);
			if (result.ok) expect(result.intent.states[1]!.changes[0]!.layer).toBe("bar");
		}
	});

	it("refuses text that is not quoted from the source", () => {
		const intent = withLayers((i) => ({
			...i,
			layers: i.layers.map((l) => (l.id === "title" ? { ...l, content: "Ship 240% faster" } : l)),
		}));
		expect(parseMotionIntent(intent, 2.4, "Ship faster")).toEqual({
			ok: false,
			error: 'layer "title": text "Ship 240% faster" must be quoted from the source text',
		});
	});

	it("refuses states outside the moment and out of order", () => {
		const late = withLayers((i) => ({ ...i, states: [{ id: "in", atSec: 3, changes: [] }] }));
		expect(parseMotionIntent(late, 2.4)).toMatchObject({ ok: false });
		const unordered = withLayers((i) => ({
			...i,
			states: [
				{ id: "in", atSec: 1, changes: [] },
				{ id: "b", atSec: 0.5, changes: [{ layer: "title", opacity: 0.5 }] },
			],
		}));
		expect(parseMotionIntent(unordered, 2.4)).toEqual({
			ok: false,
			error: 'state "b" must come after the previous state',
		});
	});

	it("refuses shape settings on text and text settings on shapes", () => {
		const shapeText = withLayers((i) => ({
			...i,
			layers: i.layers.map((l) => (l.id === "bar" ? { ...l, text: { fontSize: 40 } } : l)),
		}));
		expect(parseMotionIntent(shapeText, 2.4)).toMatchObject({ ok: false });
		const radius = withLayers((i) => ({
			...i,
			layers: i.layers.map((l) => (l.id === "spark" ? { ...l, shape: { radius: 4 } } : l)),
		}));
		expect(parseMotionIntent(radius, 2.4)).toEqual({
			ok: false,
			error: 'layer "spark": corner radius applies only to shape-rect',
		});
	});

	it("refuses a colour change on a shape", () => {
		const intent = withLayers((i) => ({
			...i,
			states: [
				...i.states,
				{
					id: "glow",
					atSec: 1,
					changes: [
						{ layer: "title", opacity: 0.9 },
						{ layer: "bar", fill: "#ff0000" },
					],
				},
			],
		}));
		expect(parseMotionIntent(intent, 2.4)).toEqual({
			ok: false,
			error: 'state "glow": fill can change only on text layers',
		});
	});
});

describe("layersMovingIn", () => {
	it("counts entering, exiting and changed layers", () => {
		const explainer = MOTION_EXAMPLES.find((e) => e.presentation === "explainer")!.intent;
		expect(layersMovingIn(explainer, "in").map((l) => l.id)).toEqual(["claim", "evidence"]);
		expect(layersMovingIn(explainer, "focus").map((l) => l.id)).toEqual(["marker"]);
	});
});

describe("motion ids", () => {
	it("normalises model-written ids everywhere they appear, so they still match", () => {
		const intent = structuredClone(headline.intent);
		const raw = JSON.parse(
			JSON.stringify(intent)
				.replaceAll('"title"', '"Claim_Text"')
				.replaceAll('"in"', '"Intro State"'),
		);
		const result = parseMotionIntent(raw, 2.4, "Ship faster");
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.intent.layers.map((l) => l.id)).toEqual(["bar", "claim-text", "spark"]);
		expect(result.intent.states[0]!.id).toBe("intro-state");
		expect(result.intent.layers[1]!.enter).toEqual({ state: "intro-state", from: "up" });
	});

	it("still refuses an id with nothing usable in it", () => {
		const raw = structuredClone(headline.intent);
		raw.layers[0]!.id = "__";
		expect(parseMotionIntent(raw, 2.4)).toMatchObject({ ok: false });
	});
});
