import { describe, expect, it } from "vite-plus/test";
import { compositionConfigSchema } from "./composition-schema.ts";

const layer = {
	relStart: 2,
	dur: 3,
	track: 1,
	preset: "shape-rect",
	content: "",
	params: { fill: "transparent", stroke: "#fff", strokeWidth: "0", radius: 0, opacity: 0 },
	style: {
		fontFamily: "Inter",
		fontSize: 64,
		weight: 700,
		fill: "#fff",
		align: "center",
		bgOpacity: 0,
	},
	layout: {
		xPct: 0,
		yPct: 0,
		widthPct: 100,
		heightPct: 0,
		fit: "contain",
		opacity: 0,
		flipX: false,
	},
	anim: {
		tracks: {
			opacity: [
				{ t: 0, v: 0 },
				{ t: 1, v: 1, easing: "out", easingRange: [0, 1] },
			],
		},
		colorTracks: { fill: [{ t: 0, v: "transparent" }] },
	},
};
const legacy = { overlays: [layer], spanSec: 8 };

describe("composition contract", () => {
	it("normalizes compatible unversioned bundles without value loss", () => {
		const parsed = compositionConfigSchema.parse(legacy);
		expect(parsed).toEqual({ ...legacy, schemaVersion: 1 });
		expect(compositionConfigSchema.parse(parsed)).toEqual(parsed);
		expect(legacy).not.toHaveProperty("schemaVersion");
	});

	it("preserves blank text, null animation and fractional short durations", () => {
		const input = {
			schemaVersion: 1,
			overlays: [{ preset: "plain", relStart: 0, dur: 0.1, content: "", anim: null }],
			spanSec: 0.1,
		};
		expect(compositionConfigSchema.parse(input)).toEqual(input);
	});

	it("rejects versions, retired IDs, nested containers and invalid surviving data with paths", () => {
		for (const schemaVersion of [0, 2, "1", null])
			expect(compositionConfigSchema.safeParse({ ...legacy, schemaVersion }).success).toBe(false);
		for (const preset of ["title", "rve-logo-fade-reveal", "", "motion-comp", "unknown"]) {
			const result = compositionConfigSchema.safeParse({
				...legacy,
				overlays: [{ ...layer, preset }],
			});
			expect(result.success).toBe(false);
			if (!result.success) expect(result.error.issues[0]?.path).toEqual(["overlays", 0, "preset"]);
		}
		for (const invalid of [
			{
				...layer,
				layout: { ...layer.layout, animation: { tracks: { opacity: [{ t: 0, v: 1 }] } } },
			},
			{ ...layer, dur: 0 },
			{ ...layer, relStart: -1 },
			{ ...layer, track: 0.5 },
			{ ...layer, params: { strokeWidth: Infinity } },
			{ ...layer, params: { opacity: "NaN" } },
			{ ...layer, params: { opacity: 2 } },
			{ ...layer, params: { script: "alert(1)" } },
			{ ...layer, preset: "shape-star" },
			{ ...layer, layout: { ...layer.layout, mystery: true } },
			{ ...layer, style: { ...layer.style, fontSize: NaN } },
			{ ...layer, anim: { tracks: { opacity: [{ t: 2, v: 1 }] } } },
			{
				...layer,
				anim: {
					tracks: {
						opacity: [
							{ t: 1, v: 0 },
							{ t: 0, v: 1 },
						],
					},
				},
			},
			{ ...layer, anim: { tracks: { script: [] } } },
		])
			expect(compositionConfigSchema.safeParse({ ...legacy, overlays: [invalid] }).success).toBe(
				false,
			);
		expect(compositionConfigSchema.safeParse({ ...legacy, spanSec: 4 }).success).toBe(false);
		expect(compositionConfigSchema.safeParse({ overlays: [], spanSec: 0 }).success).toBe(false);
	});
});
