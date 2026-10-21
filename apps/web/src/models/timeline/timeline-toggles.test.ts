import { beforeEach, describe, expect, test } from "vite-plus/test";
import {
	deleteModeFor,
	rippleEnabled,
	snapEnabled,
	storeRippleEnabled,
	storeSnapEnabled,
} from "./timeline-toggles.ts";

const store = new Map<string, string>();
let throwing = false;
(globalThis as unknown as { window: unknown }).window = {
	localStorage: {
		getItem: (k: string) => {
			if (throwing) throw new Error("denied");
			return store.get(k) ?? null;
		},
		setItem: (k: string, v: string) => {
			if (throwing) throw new Error("denied");
			store.set(k, v);
		},
	},
};

describe("timeline editing toggles", () => {
	beforeEach(() => {
		store.clear();
		throwing = false;
	});

	test("defaults keep today's behaviour: snapping on, ripple off", () => {
		expect(snapEnabled()).toBe(true);
		expect(rippleEnabled()).toBe(false);
	});

	test("a stored choice round-trips, each independently", () => {
		storeSnapEnabled(false);
		expect(snapEnabled()).toBe(false);
		expect(rippleEnabled()).toBe(false);
		storeRippleEnabled(true);
		expect(rippleEnabled()).toBe(true);
		storeSnapEnabled(true);
		expect(snapEnabled()).toBe(true);
	});

	test("unreadable or garbage storage falls back to the defaults", () => {
		store.set("maleo.timeline.snapping", "maybe");
		expect(snapEnabled()).toBe(true);
		throwing = true;
		expect(snapEnabled()).toBe(true);
		expect(rippleEnabled()).toBe(false);
		expect(() => storeRippleEnabled(true)).not.toThrow();
	});
});

describe("delete follows the ripple mode, and Shift inverts it", () => {
	test.each([
		[false, false, "plain"],
		[false, true, "ripple"],
		[true, false, "ripple"],
		[true, true, "plain"],
	] as const)("ripple %j, shift %j → %s", (ripple, shift, expected) => {
		expect(deleteModeFor(ripple, shift)).toBe(expected);
	});
});
