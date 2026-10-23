/* The create→load round trip for a preset-seeded project.
 *
 * A Project Preset supplies Materials and a Video Template (plus the legacy axes
 * it still carries), and `createProject` is the only writer that runs before the
 * debounced autosave exists. This drives the real create body through
 * `parseLoadedProject`, so it fails if either side of the round trip drifts,
 * rather than asserting which arguments were passed. */
import { describe, expect, test } from "vite-plus/test";
import { createProject } from "./projects.ts";
import {
	parseLoadedProject,
	type LoadedProjectDetail,
	type StoryboardJson,
} from "@models/storyboard/parse-loaded-project.ts";
import { DEFAULT_PACING_DEVICES } from "@models/presets/generation-defaults.ts";
import { DEFAULT_SETTINGS } from "@models/presets/creative-settings.ts";
import {
	EMPTY_CREATIVE_DIRECTION,
	EMPTY_PROJECT_SELECTION,
	MATERIAL_GROUPS,
	type ProjectMaterials,
	findPresetFixture,
	MATERIAL_FIXTURES,
	type CreativeDirection,
	type StyleKnobs,
} from "@maleo/shared";
import type { Config, PacingDevices, ProjectSelection, RefsState } from "@maleo/shared";

const knobs = (styleId: string): StyleKnobs => findPresetFixture(styleId)!.bundle.style!;

const EMPTY_REFS: RefsState = {
	images: [],
	speakers: [],
	notes: [],
	style: { tone: "", palette: "", music: "" },
};

/** Materials as the create form hands them over: resolved values, not ids. */
const SEEDED_MATERIALS: ProjectMaterials = {
	story: { body: "one honest demo", assetIds: [], referenceSettings: [], materialId: "m-story" },
	visual: {
		body: "warm kitchen documentary",
		assetIds: ["ent-kitchen"],
		referenceSettings: [],
		materialId: "m-visual",
	},
	voice: { body: "calm", assetIds: [], referenceSettings: [], materialId: "m-voice" },
	rules: { body: "no captions", assetIds: [], referenceSettings: [], materialId: "m-rules" },
	styleBible: { body: "", locked: false },
};

/** What a preset writes into component state before `generate` runs. */
const PRESET = {
	config: {
		title: "Serum launch",
		format: "9:16",
		style: knobs("cinematic-story"),
		styleName: "Cinematic Story",
	} as Config,
	direction: {
		raw: "warm kitchen documentary",
		story: "one honest demo",
		visual: "warm kitchen documentary",
		voice: "calm",
		rules: "",
	} as CreativeDirection,
	projectReferences: {
		prompt: "keep the kitchen consistent",
		entityIds: ["ent-kitchen", "ent-bottle"],
	} as ProjectSelection,
	settings: { ...DEFAULT_SETTINGS, aspectRatio: "9:16", timelineTemplateId: "tpl-editorial" },
	pacingDevices: { chapterPills: true, progressBar: true, variant: "minimal" } as PacingDevices,
};

/** Run `createProject` against a stubbed transport and return the POSTed body. */
async function capturedCreateBody(
	input: Parameters<typeof createProject>[0],
): Promise<Record<string, unknown>> {
	const priorFetch = globalThis.fetch;
	let body: Record<string, unknown> | undefined;
	globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
		body = JSON.parse(String(init?.body)) as Record<string, unknown>;
		return new Response(JSON.stringify({ project: { project: { id: "proj-1" } } }), {
			status: 201,
			headers: { "content-type": "application/json" },
		});
	}) as typeof fetch;
	try {
		await createProject(input);
	} finally {
		globalThis.fetch = priorFetch;
	}
	if (!body) throw new Error("createProject did not POST");
	return body;
}

/** The project detail the API would return for a row created from this body,
 *  with nothing else having been written since — no autosave has run. */
function detailFromCreateBody(body: Record<string, unknown>): LoadedProjectDetail {
	const seed = body.seed_storyboard as { storyboard_json: StoryboardJson };
	return {
		project: {
			id: "proj-1",
			title: String(body.title),
			type: "video",
			target_audience: (body.target_audience as string | null) ?? null,
			target_duration_sec: null,
			target_format: (body.target_format as string | null) ?? null,
			target_platform: (body.target_platform as string | null) ?? null,
			brief_json: body.brief_json as LoadedProjectDetail["project"]["brief_json"],
			reference_notes: (body.reference_notes as string | null) ?? null,
			editor_state_json:
				(body.editor_state as LoadedProjectDetail["project"]["editor_state_json"]) ?? null,
		},
		storyboards: [{ storyboard_json: seed.storyboard_json }],
		entities: [],
		notes: [],
		speakers: [],
	};
}

describe("a preset-seeded project survives a reload before the first autosave", () => {
	test("all five preset axes round-trip through create and load", async () => {
		const body = await capturedCreateBody({
			type: "video",
			config: PRESET.config,
			refs: EMPTY_REFS,
			pool: [],
			title: "Serum launch",
			status: "brief",
			editorState: { chat: [], settings: PRESET.settings, direction: PRESET.direction },
			projectReferences: PRESET.projectReferences,
			pacingDevices: PRESET.pacingDevices,
			materials: SEEDED_MATERIALS,
		});
		const parsed = parseLoadedProject(detailFromCreateBody(body));

		expect(parsed.direction).toEqual(PRESET.direction);
		expect(parsed.projectReferences).toEqual(PRESET.projectReferences);
		expect(parsed.settings.timelineTemplateId).toBe("tpl-editorial");
		expect(parsed.pacingDevices).toEqual(PRESET.pacingDevices);
	});

	test("a project created with no preset loads back with the defaults", async () => {
		const body = await capturedCreateBody({
			type: "video",
			config: { title: "Bare project" },
			refs: EMPTY_REFS,
			pool: [],
			title: "Bare project",
			status: "brief",
			editorState: { chat: [], settings: DEFAULT_SETTINGS },
		});
		const parsed = parseLoadedProject(detailFromCreateBody(body));

		expect(parsed.direction).toEqual(EMPTY_CREATIVE_DIRECTION);
		expect(parsed.projectReferences).toEqual(EMPTY_PROJECT_SELECTION);
		expect(parsed.settings).toEqual(DEFAULT_SETTINGS);
		expect(parsed.pacingDevices).toEqual(DEFAULT_PACING_DEVICES);
	});

	test("a project created before this change still loads", () => {
		// The old shape: an empty seed storyboard and an editor state with no
		// direction. The seed becoming non-empty must not make these unreadable.
		const parsed = parseLoadedProject({
			project: {
				id: "proj-old",
				title: "Legacy project",
				type: "video",
				target_audience: null,
				target_duration_sec: null,
				target_format: "9:16",
				target_platform: null,
				brief_json: { goal: null, style_preset: null },
				reference_notes: null,
				editor_state_json: { chat: [], media_assets: [], settings: DEFAULT_SETTINGS },
			},
			storyboards: [{ storyboard_json: { schemaVersion: 2, clips: [], markers: [] } }],
			entities: [],
			notes: [],
			speakers: [],
		});

		expect(parsed.direction).toEqual(EMPTY_CREATIVE_DIRECTION);
		expect(parsed.projectReferences).toEqual(EMPTY_PROJECT_SELECTION);
		expect(parsed.pacingDevices).toEqual(DEFAULT_PACING_DEVICES);
		expect(parsed.clips).toEqual([]);
	});
});

/* Materials and the Video Template are what a Project Preset actually supplies, so
 * they have to survive the same reload-before-autosave window as the axes above.
 * Both are written WITH the row: materials on the seed storyboard, the template on
 * `editor_state.settings.timelineTemplateId`. */
describe("preset materials and video template survive create", () => {
	test("seeded materials round-trip through create and load", async () => {
		const body = await capturedCreateBody({
			type: "video",
			config: PRESET.config,
			refs: EMPTY_REFS,
			pool: [],
			title: "Serum launch",
			status: "brief",
			editorState: { chat: [], settings: PRESET.settings },
			materials: SEEDED_MATERIALS,
		});
		const parsed = parseLoadedProject(detailFromCreateBody(body));
		expect(parsed.materials).toEqual(SEEDED_MATERIALS);
	});

	test("the selected video template round-trips", async () => {
		const body = await capturedCreateBody({
			type: "video",
			config: PRESET.config,
			refs: EMPTY_REFS,
			pool: [],
			title: "Serum launch",
			status: "brief",
			editorState: {
				chat: [],
				settings: { ...PRESET.settings, timelineTemplateId: "tpl-override" },
			},
		});
		expect(parseLoadedProject(detailFromCreateBody(body)).settings.timelineTemplateId).toBe(
			"tpl-override",
		);
	});

	test("animated systems explainer preset state round-trips through create and load", async () => {
		/* The preset's materials are fixture Material rows now, resolved to local ids at
		 * bootstrap. The test supplies the bodies the same way seeding would, but through
		 * the material records rather than the retired inline fallback. */
		const preset = findPresetFixture("animated-systems-explainer")!;
		const materials: ProjectMaterials = {
			...SEEDED_MATERIALS,
			styleBible: { body: "", locked: false },
		};
		for (const group of MATERIAL_GROUPS) {
			const slug = preset.materialSlugs[group];
			const fixture = MATERIAL_FIXTURES.find((material) => material.slug === slug)!;
			materials[group] = { body: fixture.body, assetIds: [], materialId: `local-${slug}` };
		}

		const body = await capturedCreateBody({
			type: "video",
			config: { ...PRESET.config, style: preset.bundle.style ?? undefined, styleName: preset.name },
			refs: EMPTY_REFS,
			pool: [],
			title: "Systems story",
			status: "brief",
			editorState: {
				chat: [],
				settings: { ...PRESET.settings, timelineTemplateId: "local-template" },
			},
			materials,
		});
		const parsed = parseLoadedProject(detailFromCreateBody(body));
		expect(parsed.materials.story.body).toContain("systems-explainer");
		expect(parsed.materials.visual.body).toContain("flat editorial animation");
		expect(parsed.materials.voice.body).toContain("calm, precise");
		expect(parsed.materials.rules.body).toContain("Do not imitate");
		expect(parsed.settings.timelineTemplateId).toBe("local-template");
	});

	/* A project created without materials must not read as "materials are empty" if
	 * it has legacy direction to migrate — that is what keeps prior projects working. */
	test("a project created with no materials derives them from its legacy fields", async () => {
		const body = await capturedCreateBody({
			type: "video",
			config: PRESET.config,
			refs: EMPTY_REFS,
			pool: [],
			title: "Legacy shaped",
			status: "brief",
			editorState: { chat: [], settings: PRESET.settings, direction: PRESET.direction },
			projectReferences: PRESET.projectReferences,
		});
		const parsed = parseLoadedProject(detailFromCreateBody(body));
		expect(parsed.materials.story.body).toBe("one honest demo");
		expect(parsed.materials.voice.body).toBe("calm");
		expect(parsed.materials.visual.body).toBe(
			"warm kitchen documentary\n\nkeep the kitchen consistent",
		);
		expect(parsed.materials.visual.assetIds).toEqual(["ent-kitchen", "ent-bottle"]);
		// The unrouted original never becomes a group.
		expect(parsed.materials.rules.body).toBe("");
	});
});
