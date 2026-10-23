import { describe, expect, it } from "vite-plus/test";
import {
	contentPresetBundleSchema,
	contentPresetWriteBundleSchema,
} from "../src/content-preset.ts";

/* `pacingDevices` was `z.record(z.unknown())`, which cost every reader an
 * assertion. Naming it is only safe if the schema stays as tolerant as the cast
 * it replaces — a preset bundle is a SNAPSHOT, so it may predate a field, carry
 * one added later, or have been written by a build that disagreed about a value's
 * type. These cases are what makes the narrowing safe, so they are asserted
 * rather than assumed. */
describe("content preset bundle — the named snapshot block", () => {
	it("round-trips a stored bundle unchanged", () => {
		const stored = {
			pacingDevices: { chapterPills: false, progressBar: true, variant: "pill" as const },
		};

		const parsed = contentPresetBundleSchema.parse(stored);

		expect(parsed.pacingDevices).toEqual(stored.pacingDevices);
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
		const parsed = contentPresetBundleSchema.parse({ pacingDevices: "not-an-object" });

		expect(parsed.pacingDevices).toEqual({});
	});

	it("drops only the wrong-kinded field, keeping the rest of the block", () => {
		const parsed = contentPresetBundleSchema.parse({
			pacingDevices: { chapterPills: "yes", progressBar: true },
		});

		expect(parsed.pacingDevices.chapterPills).toBeUndefined();
		expect(parsed.pacingDevices.progressBar).toBe(true);
	});

	it("defaults the block when a bundle predates it", () => {
		expect(contentPresetBundleSchema.parse({}).pacingDevices).toEqual({});
	});

	it("loads a stored bundle that carries an infographic style without it", () => {
		const stored = {
			pacingDevices: { chapterPills: true },
			infographicStyle: { bgColor: "#080a10", blur: 10 },
		};

		const read = contentPresetBundleSchema.parse(stored);
		const written = contentPresetWriteBundleSchema.parse(stored);

		expect(read).not.toHaveProperty("infographicStyle");
		expect(written).not.toHaveProperty("infographicStyle");
		expect(read.pacingDevices).toEqual({ chapterPills: true });
	});
});
