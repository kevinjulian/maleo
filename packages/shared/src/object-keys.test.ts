import { describe, expect, test } from "vite-plus/test";
import { textOf } from "./object-keys.ts";

describe("textOf", () => {
	test("keeps a string and writes out a scalar", () => {
		expect(textOf("caption")).toBe("caption");
		expect(textOf(42)).toBe("42");
		expect(textOf(false)).toBe("false");
		expect(textOf(7n)).toBe("7");
	});

	test("never turns an object into `[object Object]`", () => {
		expect(textOf({ text: "x" }, "fallback")).toBe("fallback");
		expect(textOf(["a"])).toBe("");
		expect(textOf(null, "none")).toBe("none");
		expect(textOf(undefined)).toBe("");
	});
});
