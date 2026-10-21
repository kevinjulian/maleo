import { describe, expect, test } from "vite-plus/test";
import {
	findPresetFixture,
	isOverridden,
	type ContentPresetBundle,
	type StyleKnobs,
} from "@maleo/shared";
import { parseElementSources } from "./element-sources.ts";
import { planPushUp, recordPushedSources, repointForkedPresetSources } from "./element-push.ts";
import { seedElementValue } from "./element-writes.ts";

const DOC: StyleKnobs = findPresetFixture("dark-documentary")!.bundle.style!;

const SETTINGS_PATHS = {
	aspectRatio: "settings.aspectRatio",
	voice: "settings.voice",
} as unknown as Readonly<Record<string, string>>;
const AXIS_PATHS = {
	config: "style",
	projectReferences: "projectReferences",
	pacingDevices: "pacingDevices",
	infographicStyle: "infographicStyle",
};

const target = (over: Partial<ContentPresetBundle> = {}): ContentPresetBundle =>
	({
		style: null,
		projectRefs: {},
		settings: { aspectRatio: "9:16" },
		pacingDevices: {},
		infographicStyle: {},
		...over,
	}) as ContentPresetBundle;

/* `targetIsFixture` is a parameter now rather than something derived from the id: a
   shipped preset used to be recognisable by a `builtin:` prefix, and is an ordinary row
   with an ordinary id today. */
const plan = (
	paths: string[],
	targetId = "cp_1",
	targetBundle = target(),
	targetIsFixture = false,
) =>
	planPushUp({
		paths,
		targetId,
		targetIsFixture,
		targetBundle,
		style: DOC,
		projectReferences: { prompt: "warm", entityIds: ["ent-1"] },
		settings: { aspectRatio: "16:9", voice: "Kore" } as never,
		pacingDevices: { chapterPills: true, progressBar: false, variant: "pill" } as never,
		infographicStyle: { bgColor: "#123456" } as never,
		settingsPaths: SETTINGS_PATHS as never,
		axisPaths: AXIS_PATHS,
	});

describe("a push writes the project's value into the target bundle", () => {
	test("a settings field lands in the bundle's settings", () => {
		const out = plan(["settings.aspectRatio"]);
		expect((out.bundle.settings as Record<string, unknown>).aspectRatio).toBe("16:9");
		expect(out.pushed).toEqual(["settings.aspectRatio"]);
	});

	test("a field not pushed keeps the target's own value", () => {
		const out = plan(["settings.voice"]);
		expect((out.bundle.settings as Record<string, unknown>).aspectRatio).toBe("9:16");
		expect((out.bundle.settings as Record<string, unknown>).voice).toBe("Kore");
	});

	test("each object-valued axis lands whole", () => {
		expect(plan(["style"]).bundle.style).toEqual(DOC);
		expect(plan(["projectReferences"]).bundle.projectRefs).toEqual({
			prompt: "warm",
			entityIds: ["ent-1"],
		});
		expect(plan(["pacingDevices"]).bundle.pacingDevices).toEqual({
			chapterPills: true,
			progressBar: false,
			variant: "pill",
		});
		expect(plan(["infographicStyle"]).bundle.infographicStyle).toEqual({ bgColor: "#123456" });
	});

	test("the target bundle it was given is not mutated", () => {
		const bundle = target();
		plan(["settings.aspectRatio", "style"], "cp_1", bundle);
		expect((bundle.settings as Record<string, unknown>).aspectRatio).toBe("9:16");
		expect(bundle.style).toBeNull();
	});

	/* `pushed` is what the caller records sources from, so a path this plan cannot promote
	 * must not appear in it — otherwise the project would claim an element is supplied by
	 * a preset that never received it. */
	test("an unknown path is skipped rather than reported as pushed", () => {
		const out = plan(["settings.aspectRatio", "somethingElse"]);
		expect(out.pushed).toEqual(["settings.aspectRatio"]);
	});
});

describe("a fixture target is forked, never edited", () => {
	test("a fixture target sets fork", () => {
		expect(plan(["settings.aspectRatio"], "cp_fixture", target(), true).fork).toBe(true);
	});

	test("an operator's preset does not", () => {
		expect(plan(["settings.aspectRatio"], "cp_1").fork).toBe(false);
	});

	/* The bundle is prepared the same way either way. Whether it becomes a new record or
	 * an update is the caller's move; this only says which is required, so the decision
	 * cannot be made differently in two places. */
	test("the prepared bundle does not depend on forking", () => {
		expect(plan(["settings.aspectRatio"], "cp_fixture", target(), true).bundle).toEqual(
			plan(["settings.aspectRatio"], "cp_1").bundle,
		);
	});
});

describe("after a push the element is supplied, not owned", () => {
	const owned = parseElementSources({
		"settings.aspectRatio": { layer: "operator", defaulterId: null },
		"settings.voice": { layer: "operator", defaulterId: null },
	});

	test("the pushed element records the target", () => {
		const sources = recordPushedSources(["settings.aspectRatio"], "cp_1", owned);
		expect(sources["settings.aspectRatio"]).toEqual({
			layer: "project-preset",
			defaulterId: "cp_1",
		});
		expect(isOverridden(sources["settings.aspectRatio"])).toBe(false);
	});

	/* Leaving it operator-owned would report the project as diverged from a preset it now
	 * agrees with — the library's divergence view would be wrong the moment a push
	 * succeeded. */
	test("it is no longer reported as the operator's", () => {
		const sources = recordPushedSources(["settings.aspectRatio"], "cp_1", owned);
		expect(isOverridden(sources["settings.aspectRatio"])).toBe(false);
	});

	test("an element that was not pushed stays the operator's", () => {
		const sources = recordPushedSources(["settings.aspectRatio"], "cp_1", owned);
		expect(sources["settings.voice"]).toEqual({ layer: "operator", defaulterId: null });
	});

	/* And it is seedable again by that preset, which is what "supplied by" has to mean
	 * for the rest of the system to behave consistently. */
	test("the target can seed it afterwards", () => {
		const sources = recordPushedSources(["settings.aspectRatio"], "cp_1", owned);
		expect(
			seedElementValue("settings.aspectRatio", "16:9", "1:1", sources, "project-preset", "cp_1")
				.value,
		).toBe("1:1");
	});

	/* When a fixture was forked the write landed on the CLONE, so that is the id to
	 * record. Recording the fixture's would name a record the project no longer uses. */
	test("the recorded id is the one the write landed on", () => {
		const sources = recordPushedSources(["settings.aspectRatio"], "cp_clone", owned);
		expect(sources["settings.aspectRatio"]?.defaulterId).toBe("cp_clone");
	});
});

describe("forking a fixture repoints the rest of the project", () => {
	test("sources still naming the fixture move to the clone", () => {
		const sources = parseElementSources({
			style: { layer: "project-preset", defaulterId: "cp_fixture" },
			"settings.voice": { layer: "operator", defaulterId: null },
			"settings.aspectRatio": { layer: "project-preset", defaulterId: "cp_other" },
		});
		expect(
			repointForkedPresetSources({
				sources,
				fromDefaulterId: "cp_fixture",
				toDefaulterId: "cp_clone",
			}),
		).toEqual({
			style: { layer: "project-preset", defaulterId: "cp_clone" },
			"settings.voice": { layer: "operator", defaulterId: null },
			"settings.aspectRatio": { layer: "project-preset", defaulterId: "cp_other" },
		});
	});
});
