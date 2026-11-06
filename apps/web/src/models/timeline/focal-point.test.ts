import { describe, expect, test } from "vite-plus/test";
import { focalPointAt, nudgeFocalPoint } from "./focal-point.ts";

/* One arrow press moves the point 5% of the frame (`controls.rs` FOCAL_STEP_PCT). */
const FOCAL_STEP_PCT = 5;

describe("the focal point picker", () => {
	test("a click picks the point under it, clamped to the frame", () => {
		const rect = { left: 100, top: 50, width: 200, height: 100 };
		expect(focalPointAt(150, 75, rect)).toEqual({ xPct: 25, yPct: 25 });
		expect(focalPointAt(400, 0, rect)).toEqual({ xPct: 100, yPct: 0 });
	});

	test("arrow keys move the point one step, from the centre when none is set", () => {
		expect(nudgeFocalPoint(undefined, "ArrowRight")).toEqual({
			xPct: 50 + FOCAL_STEP_PCT,
			yPct: 50,
		});
		expect(nudgeFocalPoint({ xPct: 20, yPct: 40 }, "ArrowUp")).toEqual({
			xPct: 20,
			yPct: 40 - FOCAL_STEP_PCT,
		});
		expect(nudgeFocalPoint({ xPct: 2, yPct: 99 }, "ArrowLeft")).toEqual({ xPct: 0, yPct: 99 });
		expect(nudgeFocalPoint({ xPct: 2, yPct: 99 }, "ArrowDown")).toEqual({ xPct: 2, yPct: 100 });
	});

	test("any other key is not a focal edit", () => {
		expect(nudgeFocalPoint({ xPct: 10, yPct: 10 }, "Enter")).toBeNull();
	});
});
