import { expect, test } from "vite-plus/test";
import {
	NUMERIC_ANIMATION_PROPERTIES,
	NUMERIC_ANIMATION_PROPERTY_NAMES,
	ANIMATION_ELEMENT_KINDS,
	numericPropertiesFor,
	colorPropertiesFor,
} from "./animation-properties.ts";
import {
	animationSchemaFor,
	clipAnimationSchema,
	textAnimationSchema,
	type Animation,
} from "./clip-animation.ts";

const span = (min: number, max: number) => (max - min) / 2 + min;

test("every registry property validates in range and rejects out of range for each kind that allows it", () => {
	for (const kind of ANIMATION_ELEMENT_KINDS) {
		const schema = animationSchemaFor(kind);
		for (const property of numericPropertiesFor(kind)) {
			const { min, max } = NUMERIC_ANIMATION_PROPERTIES[property];
			const track = (v: number) => ({ tracks: { [property]: [{ t: 0, v }] } });
			expect(schema.safeParse(track(span(min, max))).success).toBe(true);
			expect(schema.safeParse(track(min)).success).toBe(true);
			expect(schema.safeParse(track(max)).success).toBe(true);
			expect(schema.safeParse(track(min - 1)).success).toBe(false);
			expect(schema.safeParse(track(max + 1)).success).toBe(false);
		}
	}
});

test("a kind rejects properties the registry does not give it", () => {
	expect(
		animationSchemaFor("image").safeParse({ tracks: { volume: [{ t: 0, v: 0.5 }] } }).success,
	).toBe(false);
	expect(
		animationSchemaFor("audio").safeParse({ tracks: { xPct: [{ t: 0, v: 0 }] } }).success,
	).toBe(false);
	expect(clipAnimationSchema.safeParse({ tracks: { fontSize: [{ t: 0, v: 40 }] } }).success).toBe(
		false,
	);
	expect(clipAnimationSchema.safeParse({ tracks: {}, colorTracks: { fill: [] } }).success).toBe(
		false,
	);
	for (const kind of ANIMATION_ELEMENT_KINDS) {
		const allowed = new Set<string>(numericPropertiesFor(kind));
		for (const property of NUMERIC_ANIMATION_PROPERTY_NAMES.filter((p) => !allowed.has(p)))
			expect(
				animationSchemaFor(kind).safeParse({
					tracks: { [property]: [{ t: 0, v: NUMERIC_ANIMATION_PROPERTIES[property].neutral }] },
				}).success,
			).toBe(false);
	}
});

test("text carries colour tracks", () => {
	expect(colorPropertiesFor("text")).toEqual(["fill", "bodyFill", "accent", "background"]);
	expect(colorPropertiesFor("video")).toEqual([]);
	const parsed = textAnimationSchema.parse({
		tracks: {
			opacity: [
				{ t: 0, v: 0 },
				{ t: 1, v: 1, easing: "bezier" },
			],
		},
		colorTracks: {
			fill: [
				{ t: 0, v: "#fff" },
				{ t: 2, v: "red" },
			],
		},
	});
	expect(parsed.colorTracks?.fill).toHaveLength(2);
	expect(
		textAnimationSchema.safeParse({
			tracks: {},
			colorTracks: {
				fill: [
					{ t: 1, v: "#fff" },
					{ t: 1, v: "#000" },
				],
			},
		}).success,
	).toBe(false);
	expect(textAnimationSchema.safeParse({ tracks: {}, pivot: "frame" }).success).toBe(false);
});

test("existing ordinary-clip animation documents still parse", () => {
	const stored: Animation = {
		tracks: {
			xPct: [
				{ t: 0, v: 0 },
				{ t: 1.5, v: 25, easing: "in-out" },
			],
			scale: [
				{ t: 0, v: 1 },
				{ t: 4, v: 1.5 },
			],
			volume: [
				{ t: 0, v: 0.7 },
				{ t: 2, v: 0.3, easingRange: [0.25, 1] },
			],
		},
	};
	expect(clipAnimationSchema.parse(stored)).toEqual(stored);
});
