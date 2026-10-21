import { describe, expect, test } from "vite-plus/test";
import {
	entityKeysOf,
	mintEntityKey,
	repairEntityKeys,
	SLIDE_KEY_PREFIX,
} from "./storyboard-entity-keys.ts";

interface Slide {
	key?: string;
	caption: string;
}

describe("mintEntityKey", () => {
	test("uses the prefix and avoids taken keys", () => {
		const key = mintEntityKey(SLIDE_KEY_PREFIX);
		expect(key.startsWith("slide_")).toBe(true);
	});

	test("does not collide with an existing key", () => {
		const taken = new Set(["slide_a", "slide_b"]);
		for (let i = 0; i < 50; i++)
			expect(taken.has(mintEntityKey(SLIDE_KEY_PREFIX, taken))).toBe(false);
	});

	test("minting does not depend on how many entities exist", () => {
		// The old `slide_${n + 1}` scheme reused a key after a delete. This one cannot.
		const existing = new Set(["slide_3"]);
		const minted = Array.from({ length: 20 }, () => mintEntityKey(SLIDE_KEY_PREFIX, existing));
		expect(minted).not.toContain("slide_3");
	});
});

describe("repairEntityKeys", () => {
	test("a fully keyed document is returned untouched", () => {
		const slides: Slide[] = [
			{ key: "slide_a", caption: "one" },
			{ key: "slide_b", caption: "two" },
		];
		const repaired = repairEntityKeys(slides, SLIDE_KEY_PREFIX);
		expect(repaired).toBe(slides);
		expect(repaired.map((s) => s.key)).toEqual(["slide_a", "slide_b"]);
	});

	test("a key-less legacy document gets unique keys for every entity", () => {
		const slides: Slide[] = [{ caption: "one" }, { caption: "two" }, { caption: "three" }];
		const repaired = repairEntityKeys(slides, SLIDE_KEY_PREFIX);
		expect(new Set(repaired.map((s) => s.key)).size).toBe(3);
		expect(repaired.every((s) => s.key?.startsWith("slide_"))).toBe(true);
		expect(repaired.map((s) => s.caption)).toEqual(["one", "two", "three"]);
	});

	test("a partially keyed document keeps the keys it has", () => {
		const slides: Slide[] = [{ key: "slide_keep", caption: "one" }, { caption: "two" }];
		const repaired = repairEntityKeys(slides, SLIDE_KEY_PREFIX);
		expect(repaired[0]?.key).toBe("slide_keep");
		expect(repaired[1]?.key).toBeDefined();
		expect(repaired[1]?.key).not.toBe("slide_keep");
	});

	test("duplicates are resolved by keeping the first holder", () => {
		const slides: Slide[] = [
			{ key: "slide_1", caption: "one" },
			{ key: "slide_1", caption: "two" },
			{ key: "slide_1", caption: "three" },
		];
		const repaired = repairEntityKeys(slides, SLIDE_KEY_PREFIX);
		expect(repaired[0]?.key).toBe("slide_1");
		expect(new Set(repaired.map((s) => s.key)).size).toBe(3);
		// Content never moves — repair changes identity, not order or payload.
		expect(repaired.map((s) => s.caption)).toEqual(["one", "two", "three"]);
	});

	test("repair is deterministic about which entity keeps a duplicated key", () => {
		const slides: Slide[] = [
			{ key: "dup", caption: "first" },
			{ key: "dup", caption: "second" },
		];
		const a = repairEntityKeys(slides, SLIDE_KEY_PREFIX);
		const b = repairEntityKeys(slides, SLIDE_KEY_PREFIX);
		expect(a[0]?.key).toBe("dup");
		expect(b[0]?.key).toBe("dup");
	});

	test("an empty or whitespace key counts as missing", () => {
		const slides: Slide[] = [
			{ key: "", caption: "one" },
			{ key: "   ", caption: "two" },
		];
		const repaired = repairEntityKeys(slides, SLIDE_KEY_PREFIX);
		expect(repaired.every((s) => (s.key ?? "").trim().length > 0)).toBe(true);
		expect(new Set(repaired.map((s) => s.key)).size).toBe(2);
	});

	test("reordering repaired entities does not change their keys", () => {
		const repaired = repairEntityKeys(
			[{ caption: "one" }, { caption: "two" }] as Slide[],
			SLIDE_KEY_PREFIX,
		);
		const reordered = [repaired[1]!, repaired[0]!];
		expect(repairEntityKeys(reordered, SLIDE_KEY_PREFIX).map((s) => s.key)).toEqual([
			repaired[1]?.key,
			repaired[0]?.key,
		]);
	});
});

describe("entityKeysOf", () => {
	test("collects defined keys only", () => {
		expect(entityKeysOf([{ key: "a" }, {}, { key: "b" }])).toEqual(new Set(["a", "b"]));
	});
});
