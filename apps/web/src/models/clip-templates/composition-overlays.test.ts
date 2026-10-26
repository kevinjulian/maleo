import { describe, expect, test } from "vite-plus/test";
import { compositionFromOverlays, overlaysFromComposition } from "./composition-overlays.ts";
import type { CompositionLayer } from "@maleo/shared";

const overlays: CompositionLayer[] = [
	{
		id: 1,
		content: "Hello",
		start: 4,
		dur: 2,
		preset: "plain",
		track: 1,
		anim: {
			tracks: {
				opacity: [
					{ t: 0, v: 0 },
					{ t: 1, v: 1 },
				],
			},
		},
	},
	{
		id: 2,
		content: "",
		start: 5,
		dur: 3,
		preset: "shape-rect",
		track: 2,
		params: { fill: "#fff" },
	},
];

describe("composition templates", () => {
	test("serializes relative to selection start and lowest track", () => {
		const c = compositionFromOverlays(overlays);
		expect(c.overlays[0].relStart).toBe(0);
		expect(c.overlays[1].relStart).toBe(1);
		expect(c.overlays[0].track).toBe(0);
		expect(c.overlays[1].track).toBe(1);
		expect(c.spanSec).toBe(4);
	});

	test("round-trips through place at a new position", () => {
		const c = compositionFromOverlays(overlays);
		const placed = overlaysFromComposition(c, 10, 0);
		expect(placed).toHaveLength(2);
		expect(placed[0].start).toBe(10);
		expect(placed[1].start).toBe(11);
		expect(placed[0].preset).toBe("plain");
		expect(placed[1].params).toEqual({ fill: "#fff" });
		expect(placed[0].anim?.tracks.opacity).toHaveLength(2);
		// fresh ids
		expect(placed[0].id).not.toBe(1);
	});

	test("editing a saved bundle preserves leading gaps, trailing span and relative tracks", () => {
		const config = {
			schemaVersion: 1 as const,
			spanSec: 10.125,
			overlays: [
				{
					preset: "shape-star" as const,
					content: "",
					relStart: 5,
					dur: 2,
					track: 3,
					params: { fill: "transparent", opacity: 0 },
				},
			],
		};
		const reopened = overlaysFromComposition(config, 0);
		expect(compositionFromOverlays(reopened, config.spanSec)).toEqual(config);
		expect(() => compositionFromOverlays(reopened, 6)).toThrow();
	});

	test("rejects empty legacy IDs rather than recreating a retired title", () => {
		expect(() =>
			overlaysFromComposition(
				// Invalid stored data must also fail at the runtime boundary.
				JSON.parse('{"overlays":[{"relStart":0,"dur":0,"preset":"","content":""}],"spanSec":0}'),
				2,
			),
		).toThrow();
	});
});
