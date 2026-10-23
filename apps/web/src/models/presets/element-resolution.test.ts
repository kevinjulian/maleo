import { describe, expect, test } from "vite-plus/test";
import {
	DEFAULT_TIMELINE_TEMPLATE,
	DEFAULT_TIMELINE_TEMPLATE_ID,
	type TimelineTemplate,
} from "@maleo/shared";
import { parseElementSources, parseRenderOverrides } from "./element-sources.ts";
import { resolveProjectElement, resolveRenderElement } from "./element-resolution.ts";

const template = (over: Partial<TimelineTemplate> = {}): TimelineTemplate => ({
	...DEFAULT_TIMELINE_TEMPLATE,
	id: "tt_doc",
	slug: null,
	source: "user",
	retired: false,
	createdAt: 0,
	updatedAt: 0,
	...over,
});

describe("a render-scope element resolves override, then template, then code default", () => {
	test("the project's override wins and reads as the operator's", () => {
		const resolved = resolveRenderElement(
			"maxVisualBeatSec",
			parseRenderOverrides({ maxVisualBeatSec: 6 }),
			template({ maxVisualBeatSec: 8 }),
		);

		expect(resolved.value).toBe(6);
		expect(resolved.source.layer).toBe("operator");
		expect(resolved.source.defaulterId).toBeNull();
	});

	test("an override that does not fit the field is ignored, not rendered", () => {
		const resolved = resolveRenderElement(
			"maxVisualBeatSec",
			parseRenderOverrides({ maxVisualBeatSec: "six" }),
			template({ maxVisualBeatSec: 8 }),
		);

		expect(resolved.value).toBe(8);
		expect(resolved.overridden).toBe(false);
		expect(resolved.source.layer).toBe("render-template");
	});

	test("without an override the template supplies it, and names itself", () => {
		const resolved = resolveRenderElement(
			"maxVisualBeatSec",
			{},
			template({ maxVisualBeatSec: 8 }),
		);

		expect(resolved.value).toBe(8);
		expect(resolved.source).toEqual({ layer: "render-template", defaulterId: "tt_doc" });
	});

	/* No template selected is a real state: `settings.timelineTemplateId` defaults to
	 * "" and the render falls back to the shipped default. The source has to say
	 * code-default rather than naming a template that is not there. */
	test("with no template at all the code default supplies it", () => {
		const resolved = resolveRenderElement("maxVisualBeatSec", {}, null);

		expect(resolved.value).toBe(DEFAULT_TIMELINE_TEMPLATE.maxVisualBeatSec);
		expect(resolved.source).toEqual({ layer: "code-default", defaulterId: null });
	});

	test("an override of a falsy value still counts as an override", () => {
		// `staticSceneMovement: false` and `musicVolume: 0` are the cases a truthiness check breaks.
		expect(
			resolveRenderElement(
				"staticSceneMovement",
				parseRenderOverrides({ staticSceneMovement: false }),
				template({ staticSceneMovement: true }),
			).value,
		).toBe(false);
		expect(
			resolveRenderElement(
				"musicVolume",
				parseRenderOverrides({ musicVolume: 0 }),
				template({ musicVolume: 1 }),
			).value,
		).toBe(0);
	});

	test("an override of one field leaves its neighbours on the template", () => {
		const overrides = parseRenderOverrides({ maxVisualBeatSec: 6 });
		const tpl = template({ maxVisualBeatSec: 8, sceneTransition: "wipe" });

		expect(resolveRenderElement("maxVisualBeatSec", overrides, tpl).source.layer).toBe("operator");
		expect(resolveRenderElement("sceneTransition", overrides, tpl).source.layer).toBe(
			"render-template",
		);
		expect(resolveRenderElement("sceneTransition", overrides, tpl).value).toBe("wipe");
	});

	test("the default template names itself when it is the selected one", () => {
		const resolved = resolveRenderElement(
			"sectionGapSec",
			{},
			template({ id: DEFAULT_TIMELINE_TEMPLATE_ID }),
		);

		expect(resolved.source).toEqual({
			layer: "render-template",
			defaulterId: DEFAULT_TIMELINE_TEMPLATE_ID,
		});
	});
});

describe("a project-scope element reports the source that was recorded", () => {
	test("a recorded source is returned as-is", () => {
		const sources = parseElementSources({
			style: { layer: "project-preset", defaulterId: "cp_9f3a" },
		});
		const resolved = resolveProjectElement("style", sources, { pacing: "fast" });

		expect(resolved.value).toEqual({ pacing: "fast" });
		expect(resolved.source).toEqual({ layer: "project-preset", defaulterId: "cp_9f3a" });
		expect(resolved.overridden).toBe(false);
	});

	/* The safety property: no recorded source means operator-owned, so a project that
	 * predates provenance is never seeded over on the strength of not knowing. */
	test("an unrecorded element reads as the operator's", () => {
		const resolved = resolveProjectElement("style", {}, { pacing: "fast" });

		expect(resolved.source).toEqual({ layer: "operator", defaulterId: null });
		expect(resolved.overridden).toBe(true);
	});

	test("overridden tracks the layer, not the value", () => {
		const sources = parseElementSources({
			a: { layer: "operator", defaulterId: null },
			b: { layer: "code-default", defaulterId: null },
		});

		expect(resolveProjectElement("a", sources, "x").overridden).toBe(true);
		expect(resolveProjectElement("b", sources, "x").overridden).toBe(false);
	});

	/* A value that happens to equal its default is NOT evidence of anything. This is
	 * the bug the whole change exists to remove: the old seeding read that equality as
	 * "untouched" and overwrote a deliberate choice. */
	test("a value equal to the default is still the operator's when recorded so", () => {
		const sources = parseElementSources({
			"settings.aspectRatio": { layer: "operator", defaulterId: null },
		});

		expect(resolveProjectElement("settings.aspectRatio", sources, "9:16").overridden).toBe(true);
	});
});
