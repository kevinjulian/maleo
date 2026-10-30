import { expect, test } from "vite-plus/test";
import { reserveSourceMemory, releaseSourceMemory } from "./source-memory.ts";

test("compressed memory ceiling spans workers and returns on failure or disposal", () => {
	const first = Symbol(),
		second = Symbol();
	try {
		expect(reserveSourceMemory(first, 40 * 1024 * 1024)).toBe(true);
		expect(reserveSourceMemory(second, 25 * 1024 * 1024)).toBe(false);
		expect(reserveSourceMemory(second, 24 * 1024 * 1024)).toBe(true);
		expect(reserveSourceMemory(first, 1)).toBe(false);
		releaseSourceMemory(first, 10 * 1024 * 1024);
		expect(reserveSourceMemory(second, 10 * 1024 * 1024)).toBe(true);
		releaseSourceMemory(second);
		expect(reserveSourceMemory(first, 34 * 1024 * 1024)).toBe(true);
		expect(reserveSourceMemory(first, NaN)).toBe(false);
		expect(reserveSourceMemory(first, -1)).toBe(false);
	} finally {
		releaseSourceMemory(first);
		releaseSourceMemory(second);
	}
});
