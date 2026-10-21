import { describe, expect, test } from "vite-plus/test";
import { motionGraphicSchema } from "./video-blueprint.ts";

/* A model asked for `kind` sometimes answers with a description of the graphic it
 * imagined rather than one of the renderers this product can draw. That used to
 * reject the beat, which failed the whole sequence-direction pass, which stopped a
 * validated plan at its gate with `needsDirection` — one invented word discarding
 * an entire researched draft.
 *
 * Observed live: `"dance-to-vector mapping"` against
 * `none | stat_reveal | bar_chart | table_build | price_tag`. */
describe("motion graphic kind degrades instead of rejecting", () => {
	test("an invented kind becomes none", () => {
		const parsed = motionGraphicSchema.parse({
			needed: true,
			kind: "dance-to-vector mapping",
			purpose: "clarify",
			reason: "r",
		});
		expect(parsed.kind).toBe("none");
	});

	test("a known kind survives untouched", () => {
		for (const kind of ["none", "stat_reveal", "bar_chart", "table_build", "price_tag"] as const) {
			expect(
				motionGraphicSchema.parse({ needed: true, kind, purpose: "clarify", reason: "r" }).kind,
			).toBe(kind);
		}
	});

	test("spacing and hyphens are normalised before the lookup", () => {
		expect(motionGraphicSchema.parse({ kind: "Stat Reveal" }).kind).toBe("stat_reveal");
		expect(motionGraphicSchema.parse({ kind: "bar-chart" }).kind).toBe("bar_chart");
		expect(motionGraphicSchema.parse({ kind: "  TABLE_BUILD  " }).kind).toBe("table_build");
	});

	test("an absent or empty kind still defaults to none", () => {
		expect(motionGraphicSchema.parse({}).kind).toBe("none");
		expect(motionGraphicSchema.parse({ kind: "" }).kind).toBe("none");
	});

	/* Degrading is deliberate rather than substituting a renderer: a guessed kind
	 * would draw data the model never chose. */
	test("it never invents a renderer for an unknown kind", () => {
		expect(motionGraphicSchema.parse({ needed: true, kind: "waggle diagram" }).kind).toBe("none");
	});
});
