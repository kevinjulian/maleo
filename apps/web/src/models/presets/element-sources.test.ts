import { describe, expect, test } from "vite-plus/test";
import { isOverridden } from "@maleo/shared";
import {
	parseElementSources,
	parseRenderOverrides,
	sourceFor,
	withSource,
	withSources,
	withoutSource,
} from "./element-sources.ts";

/* These read persisted JSON, so the tests are mostly about hostile input. A blob can
 * carry an older shape, a hand-edited row, or a key from a build that has since
 * renamed it — and the wrong response to any of those is to coerce it into a source,
 * because that invents provenance the system does not have. */
describe("parsing a source map tolerates anything a blob can hold", () => {
	test("a well-formed map round-trips", () => {
		const raw = {
			"settings.voice": { layer: "project-preset", defaulterId: "cp_9f3a" },
			style: { layer: "operator", defaulterId: null },
		} as const;
		expect(parseElementSources(raw)).toEqual(raw);
	});

	test("absent, null, and non-object blobs read as an empty map", () => {
		for (const raw of [undefined, null, 0, "", "settings", [], [{ layer: "operator" }]]) {
			expect(parseElementSources(raw)).toEqual({});
		}
	});

	/* An unknown layer is DROPPED, not coerced to a default. Coercing would assert a
	 * provenance nobody recorded; dropping leaves the element with no source, which
	 * reads as operator-owned — the safe direction. */
	test("an unknown layer is dropped rather than coerced", () => {
		const parsed = parseElementSources({
			"settings.voice": { layer: "from-the-future", defaulterId: "x" },
			"settings.language": { layer: "operator", defaulterId: null },
		});
		expect(parsed["settings.voice"]).toBeUndefined();
		expect(parsed["settings.language"]).toEqual({ layer: "operator", defaulterId: null });
	});

	test("a dropped entry reads as operator-owned, so it is never seeded over", () => {
		const parsed = parseElementSources({ "settings.voice": { layer: "nonsense" } });
		expect(isOverridden(sourceFor(parsed, "settings.voice"))).toBe(true);
	});

	test("a missing or blank defaulterId normalises to null", () => {
		const parsed = parseElementSources({
			a: { layer: "operator" },
			b: { layer: "project-preset", defaulterId: "" },
			c: { layer: "project-preset", defaulterId: 7 },
		});
		expect(parsed.a?.defaulterId).toBeNull();
		expect(parsed.b?.defaulterId).toBeNull();
		expect(parsed.c?.defaulterId).toBeNull();
	});

	test("a blank path is dropped, since it addresses nothing", () => {
		expect(parseElementSources({ "": { layer: "operator", defaulterId: null } })).toEqual({});
	});
});

describe("parsing render overrides", () => {
	test("values stay opaque, including falsy ones", () => {
		const raw = {
			maxVisualBeatSec: 6,
			staticSceneMovement: false,
			sceneTransition: "cut",
			musicVolume: 0,
		};
		expect(parseRenderOverrides(raw)).toEqual(raw);
	});

	/* An override whose value is undefined cannot be told apart from no override, and
	 * keeping the key would make "is this overridden?" answer yes with nothing to
	 * show for it. */
	test("an undefined value is dropped, not kept as an empty override", () => {
		expect(
			parseRenderOverrides({ maxVisualBeatSec: undefined, staticSceneMovement: true }),
		).toEqual({
			staticSceneMovement: true,
		});
	});

	test("null survives, because null is a value a field can hold", () => {
		expect(parseRenderOverrides({ musicUrl: null })).toEqual({ musicUrl: null });
	});

	test("absent and non-object blobs read as an empty map", () => {
		for (const raw of [undefined, null, "x", 3, []]) expect(parseRenderOverrides(raw)).toEqual({});
	});
});

describe("writing sources never mutates the map it was given", () => {
	const base = parseElementSources({ style: { layer: "project-preset", defaulterId: "cp_1" } });

	test("withSource returns a new map and leaves the original alone", () => {
		const next = withSource(base, "settings.voice", { layer: "operator", defaulterId: null });
		expect(next["settings.voice"]).toEqual({ layer: "operator", defaulterId: null });
		expect(base["settings.voice"]).toBeUndefined();
	});

	test("withSources applies several at once", () => {
		const next = withSources(base, [
			["settings.voice", { layer: "operator", defaulterId: null }],
			["pacingDevices", { layer: "project-preset", defaulterId: "cp_1" }],
		]);
		expect(Object.keys(next).sort()).toEqual(["pacingDevices", "settings.voice", "style"]);
		expect(Object.keys(base)).toEqual(["style"]);
	});

	test("withSources with no entries returns the same map", () => {
		expect(withSources(base, [])).toBe(base);
	});

	test("withoutSource drops one key and leaves the original alone", () => {
		const next = withoutSource(base, "style");
		expect(next.style).toBeUndefined();
		expect(base.style).toBeDefined();
	});

	test("withoutSource on an absent key returns the same map", () => {
		expect(withoutSource(base, "nope")).toBe(base);
	});

	/* Dropping a source is how revert works: the element stops being owned and goes
	 * back to being supplied by whatever the cascade resolves. */
	test("a dropped source reads as operator-owned until something supplies it again", () => {
		expect(isOverridden(sourceFor(withoutSource(base, "style"), "style"))).toBe(true);
	});
});
