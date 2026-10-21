import { describe, expect, test } from "vite-plus/test";
import {
	fixtureSlugForLegacyBuiltinId,
	findPresetFixture,
	MATERIAL_FIXTURES,
	PRESET_FIXTURES,
} from "./content-preset-builtins.ts";
import { contentPresetSchema } from "./content-preset.ts";
import { ANIMATED_SYSTEMS_EXPLAINER_TEMPLATE_SLUG } from "./timeline-template.ts";
import { MATERIAL_GROUPS } from "./project-materials.ts";

/* Fixtures ship in code, so a bad value reaches every workspace at once — bootstrap
 * rewrites the row from these definitions on every boot, so there is no row to fix it
 * in. The schema check is the only thing standing between a typo and a global
 * breakage. */

describe("preset fixtures", () => {
	test("every fixture bundle parses against the preset schema", () => {
		for (const fixture of PRESET_FIXTURES) {
			// The id and timestamps a row carries are assigned at bootstrap; what is
			// checked here is the part that ships.
			const parsed = contentPresetSchema.safeParse({
				id: fixture.slug,
				name: fixture.name,
				description: fixture.description,
				bundle: fixture.bundle,
				slug: fixture.slug,
				source: "fixture",
				retired: false,
				createdAt: 0,
				updatedAt: 0,
			});
			expect(
				parsed.success,
				`${fixture.slug} failed: ${parsed.success ? "" : parsed.error.message}`,
			).toBe(true);
		}
	});

	test("slugs are unique and kebab-case", () => {
		const slugs = PRESET_FIXTURES.map((f) => f.slug);
		expect(new Set(slugs).size).toBe(slugs.length);
		for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
	});

	test("no fixture names an id", () => {
		// Ids are local to one database. A definition that carried one would make the
		// same fixture a different row on every device that ran an older build.
		for (const fixture of PRESET_FIXTURES) {
			expect(Object.keys(fixture)).not.toContain("id");
			expect(fixture.bundle.videoTemplateId, fixture.slug).toBeNull();
		}
	});

	test("ten styles ship", () => {
		expect(PRESET_FIXTURES.length).toBe(10);
	});

	test("every fixture carries knobs, settings and direction", () => {
		for (const fixture of PRESET_FIXTURES) {
			expect(fixture.bundle.style, fixture.slug).not.toBeNull();
			expect(Object.keys(fixture.bundle.settings).length, fixture.slug).toBeGreaterThan(0);
			expect(fixture.videoTemplateSlug, fixture.slug).toBeTruthy();
			expect(fixture.bundle.direction?.story?.trim(), fixture.slug).toBeTruthy();
			expect(fixture.bundle.direction?.visual?.trim(), fixture.slug).toBeTruthy();
		}
	});

	test("animated systems explainer names a material per group and its template", () => {
		const fixture = findPresetFixture("animated-systems-explainer");
		expect(fixture?.name).toBe("Animated Systems Explainer");
		expect(fixture?.videoTemplateSlug).toBe(ANIMATED_SYSTEMS_EXPLAINER_TEMPLATE_SLUG);
		for (const group of MATERIAL_GROUPS) {
			const slug = fixture!.materialSlugs[group];
			expect(slug, group).toBeTruthy();
			expect(MATERIAL_FIXTURES.find((m) => m.slug === slug)?.body.trim(), group).toBeTruthy();
		}
	});

	test("animated systems explainer materials avoid protected channel imitation", () => {
		const slugs = Object.values(findPresetFixture("animated-systems-explainer")!.materialSlugs);
		const text = MATERIAL_FIXTURES.filter((m) => slugs.includes(m.slug))
			.map((m) => m.body)
			.join("\n")
			.toLowerCase();
		for (const protectedName of [
			"bright-systems-animation",
			"ted-ed",
			"editorial-map-explainer",
			"alan becker",
			"theodd1sout",
		]) {
			expect(text).not.toContain(protectedName);
		}
	});

	test("no fixture ships project references", () => {
		// References are workspace-owned; a fixture cannot name entities that exist.
		for (const fixture of PRESET_FIXTURES) {
			expect(fixture.bundle.projectRefs, fixture.slug).toEqual({});
		}
	});

	test("fixtures carry a name and description", () => {
		for (const fixture of PRESET_FIXTURES) {
			expect(fixture.name.trim(), fixture.slug).toBeTruthy();
			expect(fixture.description.trim(), fixture.slug).toBeTruthy();
		}
	});
});

describe("material fixtures", () => {
	test("slugs are unique and every one is claimed by a preset", () => {
		const slugs = MATERIAL_FIXTURES.map((m) => m.slug);
		expect(new Set(slugs).size).toBe(slugs.length);
		const claimed = new Set(PRESET_FIXTURES.flatMap((f) => Object.values(f.materialSlugs)));
		for (const slug of slugs) expect(claimed.has(slug), slug).toBe(true);
	});

	test("every material a preset names exists", () => {
		const bySlug = new Set(MATERIAL_FIXTURES.map((m) => m.slug));
		for (const fixture of PRESET_FIXTURES) {
			for (const [group, slug] of Object.entries(fixture.materialSlugs)) {
				expect(bySlug.has(slug!), `${fixture.slug}.${group}`).toBe(true);
			}
		}
	});

	test("every fixture material carries a body", () => {
		for (const material of MATERIAL_FIXTURES) {
			expect(material.body.trim(), material.slug).toBeTruthy();
		}
	});
});

describe("legacy builtin ids", () => {
	/* Default pointers and provenance written before fixtures existed still hold
	 * `builtin:<key>`. They resolve through the alias rather than being rewritten. */
	test("a shipped builtin id resolves to its fixture slug", () => {
		expect(fixtureSlugForLegacyBuiltinId("builtin:high-energy-challenge")).toBe(
			"high-energy-challenge",
		);
		expect(fixtureSlugForLegacyBuiltinId("builtin:mrbeast")).toBe("high-energy-challenge");
		expect(fixtureSlugForLegacyBuiltinId("builtin:animated-systems-explainer")).toBe(
			"animated-systems-explainer",
		);
	});

	test("an unprefixed or unknown id resolves to nothing", () => {
		expect(fixtureSlugForLegacyBuiltinId("high-energy-challenge")).toBeNull();
		expect(fixtureSlugForLegacyBuiltinId("builtin:never-shipped")).toBeNull();
		expect(fixtureSlugForLegacyBuiltinId("some-workspace-row-id")).toBeNull();
	});
});
