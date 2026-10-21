/* The JSON-column decoders every family reads a row through.
 *
 * Untested until now, which mattered more than it looks: these are the functions
 * that decide what a project does when a column holds something the writer never
 * intended. They never throw — a malformed column degrades to a fallback rather
 * than making a project fail to open — and that tolerance is the behaviour worth
 * pinning, because it is invisible until the day a row is bad. */
import { describe, expect, test } from "vite-plus/test";
import { parseJsonObject, parseJsonStringArray, parseJsonValue } from "./row-json.ts";

describe("parseJsonObject", () => {
	test("decodes an object column", () => {
		expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
	});

	test("an absent column is null, not an empty object", () => {
		// The distinction is load-bearing: "no brief" and "an empty brief" are
		// different answers to a caller deciding whether to write one.
		expect(parseJsonObject(null)).toBeNull();
		expect(parseJsonObject("")).toBeNull();
	});

	test("a non-object payload is null rather than the wrong shape", () => {
		expect(parseJsonObject("[1,2]")).toBeNull();
		expect(parseJsonObject('"a string"')).toBeNull();
		expect(parseJsonObject("42")).toBeNull();
		expect(parseJsonObject("null")).toBeNull();
	});

	test("unparseable text is null, never a throw", () => {
		expect(parseJsonObject("{not json")).toBeNull();
	});
});

describe("parseJsonValue", () => {
	test("decodes any JSON value", () => {
		expect(parseJsonValue<number[]>("[1,2]", [])).toEqual([1, 2]);
		expect(parseJsonValue<number>("7", 0)).toBe(7);
	});

	test("an absent or unparseable column takes the caller's fallback", () => {
		expect(parseJsonValue(null, "fb")).toBe("fb");
		expect(parseJsonValue("", "fb")).toBe("fb");
		expect(parseJsonValue("{oops", "fb")).toBe("fb");
	});

	test("a stored null decodes as null, not as the fallback", () => {
		// JSON.parse("null") succeeds, so the column said null and is believed. The
		// fallback is for a column that could not be read at all.
		expect(parseJsonValue<unknown>("null", "fb")).toBeNull();
	});
});

describe("parseJsonStringArray", () => {
	test("decodes a string array", () => {
		expect(parseJsonStringArray('["a","b"]')).toEqual(["a", "b"]);
	});

	test("non-string members are dropped rather than failing the column", () => {
		expect(parseJsonStringArray('["a",1,null,{"b":2},"c"]')).toEqual(["a", "c"]);
	});

	test("absent, unparseable, or non-array input is an empty array", () => {
		expect(parseJsonStringArray(null)).toEqual([]);
		expect(parseJsonStringArray("")).toEqual([]);
		expect(parseJsonStringArray("[oops")).toEqual([]);
		expect(parseJsonStringArray('{"a":1}')).toEqual([]);
	});
});
