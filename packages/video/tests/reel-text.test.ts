import { describe, expect, it } from "vite-plus/test";
import { paramStr } from "../src/compositions/reel-text";

describe("template text params", () => {
	it("respects explicit blank strings", () => {
		expect(paramStr({ subtitle: "" }, "subtitle", "A Cinematic Experience")).toBe("");
	});

	it("uses fallback when param is missing", () => {
		expect(paramStr({}, "subtitle", "A Cinematic Experience")).toBe("A Cinematic Experience");
	});
});
