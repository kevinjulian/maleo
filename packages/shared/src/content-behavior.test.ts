import { describe, expect, test } from "vite-plus/test";
import { parseContentBehavior } from "./content-behavior.ts";

describe("parseContentBehavior", () => {
	test("reads the mix and keeps well-formed rules", () => {
		const parsed = parseContentBehavior({
			behavior: {
				content: {
					mix: { "x.post": { text: 2, image: "3", video: -1 }, empty: { text: 0 } },
					rules: [{ id: "night", when: { hour_between: [22, 6] }, prefer: "text" }],
				},
			},
		});
		expect(parsed.mix).toEqual({ "x.post": { text: 2, image: 3 } });
		expect(parsed.rules).toEqual([
			{ id: "night", when: { hour_between: [22, 6] }, prefer: "text" },
		]);
	});

	test("drops a malformed rule instead of trusting its shape", () => {
		const parsed = parseContentBehavior({
			behavior: {
				content: {
					rules: [
						{ id: "ok", when: {} },
						{ id: 7, when: {} },
						{ id: "bad-type", when: {}, prefer: "audio" },
						"not a rule",
					],
				},
			},
		});
		expect(parsed.rules.map((rule) => rule.id)).toEqual(["ok"]);
	});

	test("reads nothing from config without a behavior block", () => {
		expect(parseContentBehavior(null)).toEqual({ mix: {}, rules: [] });
		expect(parseContentBehavior({ behavior: "x" })).toEqual({ mix: {}, rules: [] });
	});
});
