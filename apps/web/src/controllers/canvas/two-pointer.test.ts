import { expect, test } from "vite-plus/test";
import { createTwoPointer } from "./two-pointer.ts";

test("a second pointer starts a pinch; distance is the scale, the turn is the angle", () => {
	const pointers = createTwoPointer();
	expect(pointers.down(1, { x: 0, y: 0 })).toBe(false);
	expect(pointers.move(1, { x: 1, y: 0 })).toBeNull();
	expect(pointers.down(2, { x: 101, y: 0 })).toBe(true);
	expect(pointers.pinching()).toBe(true);
	expect(pointers.move(2, { x: 201, y: 0 })).toEqual({ scale: 2, angle: 0 });
	const turned = pointers.move(2, { x: 1, y: 200 })!;
	expect(turned.scale).toBeCloseTo(2, 9);
	expect(turned.angle).toBeCloseTo(90, 9);
	expect(pointers.down(3, { x: 5, y: 5 })).toBe(false);
	expect(pointers.move(3, { x: 9, y: 9 })).toBeNull();
	expect(pointers.up(2)).toBe(true);
	expect(pointers.pinching()).toBe(false);
	expect(pointers.up(1)).toBe(false);
});

test("a twist past 180 degrees keeps counting", () => {
	const pointers = createTwoPointer();
	pointers.down(1, { x: 0, y: 0 });
	pointers.down(2, { x: -100, y: 1 });
	pointers.move(2, { x: -100, y: -1 });
	const sample = pointers.move(2, { x: -100, y: -30 })!;
	expect(sample.angle).toBeGreaterThan(0);
	expect(sample.angle).toBeLessThan(30);
});
