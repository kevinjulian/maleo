import { describe, expect, it } from "vite-plus/test";
import { contentPresetBundleSchema } from "../src/content-preset.ts";

/* `pacingDevices` and `infographicStyle` were `z.record(z.unknown())`, which cost
 * every reader an assertion. Naming them is only safe if the schema stays as
 * tolerant as the cast it replaces — a preset bundle is a SNAPSHOT, so it may
 * predate a field, carry one added later, or have been written by a build that
 * disagreed about a value's type. These three cases are what makes the narrowing
 * safe, so they are asserted rather than assumed. */
describe("content preset bundle — the two named snapshot blocks", () => {
	it("round-trips a stored bundle unchanged", () => {
		const stored = {
			pacingDevices: { chapterPills: false, progressBar: true, variant: "pill" as const },
			infographicStyle: {
				bgColor: "#080a10",
				bgOpacity: 0.72,
				borderColor: "#ffffff",
				borderOpacity: 0.18,
				borderRadius: 8,
				blur: 10,
			},
		};

		const parsed = contentPresetBundleSchema.parse(stored);

		expect(parsed.pacingDevices).toEqual(stored.pacingDevices);
		expect(parsed.infographicStyle).toEqual(stored.infographicStyle);
	});

	it("keeps a key added by a later build", () => {
		const parsed = contentPresetBundleSchema.parse({
			pacingDevices: { chapterPills: true, futureKey: 42 },
		});

		// Stripping here would delete an operator's setting on the next save, which
		// is why the block passes through rather than closing.
		expect(parsed.pacingDevices).toEqual({ chapterPills: true, futureKey: 42 });
	});

	it("degrades a block that is not an object instead of failing the whole bundle", () => {
		// This schema runs on every preset read. A bundle written with the wrong
		// kind in one block must not make a workspace's presets unloadable.
		const parsed = contentPresetBundleSchema.parse({
			pacingDevices: "not-an-object",
			infographicStyle: 42,
		});

		expect(parsed.pacingDevices).toEqual({});
		expect(parsed.infographicStyle).toEqual({});
	});

	it("drops only the wrong-kinded field, keeping the rest of the block", () => {
		// The whole-object guard this replaced returned `{}` here, so a bundle from
		// a build that wrote `blur` as a word lost its `bgColor` as well — which
		// presents as a preset that half-applied, not as a preset that failed.
		const parsed = contentPresetBundleSchema.parse({
			pacingDevices: { chapterPills: "yes", progressBar: true },
			infographicStyle: { bgColor: "#101010", blur: "lots", legacyShadow: true },
		});

		expect(parsed.pacingDevices.chapterPills).toBeUndefined();
		expect(parsed.pacingDevices.progressBar).toBe(true);
		expect(parsed.infographicStyle.bgColor).toBe("#101010");
		expect(parsed.infographicStyle.blur).toBeUndefined();
		expect(parsed.infographicStyle).toMatchObject({ legacyShadow: true });
	});

	it("defaults both blocks when a bundle predates them", () => {
		const parsed = contentPresetBundleSchema.parse({});

		expect(parsed.pacingDevices).toEqual({});
		expect(parsed.infographicStyle).toEqual({});
	});
});
