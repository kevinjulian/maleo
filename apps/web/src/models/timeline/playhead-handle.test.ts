import { describe, expect, test } from "vite-plus/test";
import { createPlayheadHandle } from "./playhead-handle.ts";

describe("playhead handle", () => {
	test("reads back what was written", () => {
		const playhead = createPlayheadHandle();
		expect(playhead.get()).toBe(0);
		playhead.set(2.5);
		expect(playhead.get()).toBe(2.5);
	});

	test("notifies subscribers on a change", () => {
		const playhead = createPlayheadHandle();
		let notified = 0;
		playhead.subscribe(() => {
			notified += 1;
		});
		playhead.set(1);
		playhead.set(2);
		expect(notified).toBe(2);
	});

	test("a write of the same value notifies nobody", () => {
		const playhead = createPlayheadHandle(1);
		let notified = 0;
		playhead.subscribe(() => {
			notified += 1;
		});
		playhead.set(1);
		expect(notified).toBe(0);
	});

	test("unsubscribing stops the notifications", () => {
		const playhead = createPlayheadHandle();
		let notified = 0;
		const off = playhead.subscribe(() => {
			notified += 1;
		});
		playhead.set(1);
		off();
		playhead.set(2);
		expect(notified).toBe(1);
		// The value still moved; only the listener went away.
		expect(playhead.get()).toBe(2);
	});
});
