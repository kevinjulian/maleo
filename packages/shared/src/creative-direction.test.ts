import { describe, expect, test } from "vite-plus/test";
import {
	creativeDirectionSchema,
	isEmptyDirection,
	hasExplicitChannels,
	EMPTY_CREATIVE_DIRECTION,
} from "./creative-direction.ts";

describe("creativeDirectionSchema", () => {
	test("fills defaults for missing channels", () => {
		const d = creativeDirectionSchema.parse({ raw: "make it calm" });
		expect(d).toEqual({ raw: "make it calm", story: "", visual: "", voice: "", rules: "" });
	});

	test("rejects unknown keys", () => {
		expect(creativeDirectionSchema.safeParse({ raw: "x", other: 1 }).success).toBe(false);
	});
});

describe("isEmptyDirection", () => {
	test("true for null/empty", () => {
		expect(isEmptyDirection(null)).toBe(true);
		expect(isEmptyDirection(EMPTY_CREATIVE_DIRECTION)).toBe(true);
	});
	test("false when any channel set", () => {
		expect(isEmptyDirection({ raw: "", story: "theme", visual: "", voice: "", rules: "" })).toBe(
			false,
		);
	});
});

describe("hasExplicitChannels", () => {
	test("false when only raw set (needs routing)", () => {
		expect(
			hasExplicitChannels({ raw: "everything mixed", story: "", visual: "", voice: "", rules: "" }),
		).toBe(false);
	});
	test("true when a channel authored (skip router)", () => {
		expect(
			hasExplicitChannels({ raw: "x", story: "", visual: "stickman", voice: "", rules: "" }),
		).toBe(true);
	});
});
