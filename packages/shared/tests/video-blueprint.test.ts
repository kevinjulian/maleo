import { describe, expect, test } from "vite-plus/test";
import { inferBeat } from "../src/video-blueprint.ts";

describe("inferBeat", () => {
	test("first is hook, last is cta", () => {
		expect(inferBeat(0, 5)).toBe("hook");
		expect(inferBeat(4, 5)).toBe("cta");
	});
});
