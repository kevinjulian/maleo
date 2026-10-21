import { describe, expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { EMPTY_PROJECT_MATERIALS, type ProjectMaterials } from "@maleo/shared";
import type { RefImage } from "@maleo/shared";
import { ProjectMaterialsDrawer, filledMaterialCount } from "./project-materials-drawer.tsx";
import { toggleAsset } from "@components/catalog/material-assets.tsx";

const POOL: RefImage[] = [
	{ id: "e1", label: "Kitchen", seed: 1, imageUrl: "/k.png", role: "location" },
	{ id: "e2", label: "Bottle", seed: 2, role: "product" },
	{ id: "e3", label: "Anna", seed: 3, role: "character" },
	{ id: "e4", label: "Ink wash", seed: 4, role: "style" },
	{ id: "e5", label: "Lantern", seed: 5, role: "prop" },
];

const noop = (): void => undefined;

function drawer(
	materials: ProjectMaterials,
	initialGroup: Parameters<typeof ProjectMaterialsDrawer>[0]["initialGroup"] = null,
	pool: RefImage[] = POOL,
): string {
	return renderToStaticMarkup(
		<ProjectMaterialsDrawer
			materials={materials}
			setMaterials={noop}
			sources={{}}
			setSources={noop}
			preset={null}
			library={[]}
			pool={pool}
			onLibraryChanged={noop}
			settingsSummary="9:16 · en"
			initialGroup={initialGroup}
			onClose={noop}
		/>,
	);
}

const source = (): string =>
	readFileSync(`${import.meta.dirname}/project-materials-drawer.tsx`, "utf8");
const assetsSource = (): string =>
	readFileSync(`${import.meta.dirname}/../catalog/material-assets.tsx`, "utf8");

describe("ProjectMaterialsDrawer", () => {
	test("opens on the four material groups", () => {
		const html = drawer(EMPTY_PROJECT_MATERIALS);
		for (const label of ["Story", "Visual", "Voice", "Rules"]) {
			expect(html).toContain(label);
		}
	});

	test("it is labelled Project Materials, not Project Refs", () => {
		const html = drawer(EMPTY_PROJECT_MATERIALS);
		expect(html).toContain("Project Materials");
		expect(html).not.toContain("Project refs");
	});

	/* Compact first is the whole point: showing every textarea at once is what made
	 * the surfaces this replaces unusable. */
	test("the scan view shows summaries, not prompt inputs", () => {
		const html = drawer(EMPTY_PROJECT_MATERIALS);
		expect(html).not.toContain("<textarea");
		expect(html).toContain("tl2-materials-row-sum");
	});

	test("opening a group mounts its prompt input", () => {
		const html = drawer(EMPTY_PROJECT_MATERIALS, "visual");
		expect(html).toContain("<textarea");
		expect(html).toContain('aria-label="Visual material"');
	});

	test("Rules shows project settings read-only rather than editing them", () => {
		const html = drawer(EMPTY_PROJECT_MATERIALS, "rules");
		expect(html).toContain("From settings: 9:16 · en");
		// One textarea — the constraints. No duration or platform control.
		expect(html.match(/<textarea/g)?.length).toBe(1);
	});

	test("the style guide sits inside Visual, not as its own group", () => {
		const html = drawer(EMPTY_PROJECT_MATERIALS, "visual");
		expect(html).toContain("Style guide");
		expect(drawer(EMPTY_PROJECT_MATERIALS)).not.toContain("Style guide");
	});

	test("an edited style bible advertises that regeneration will not replace it", () => {
		const locked = {
			...EMPTY_PROJECT_MATERIALS,
			styleBible: { body: "flat vector", locked: true },
		};
		expect(drawer(locked, "visual")).toContain("kept on regenerate");
	});

	test("a group's origin is shown so the operator can see what is inherited", () => {
		expect(drawer(EMPTY_PROJECT_MATERIALS)).toContain("Not set");
	});

	/* Project-local by default is what makes editing safe: a library row other
	 * projects depend on must not change because someone tried something here. */
	test("saving back to a reusable material is explicit", () => {
		const src = source();
		expect(src).toContain("Save as reusable");
		expect(src).toContain("Save back to material");
		expect(src).toContain("createContentMaterial(");
		expect(src).toContain("updateContentMaterial(");
	});

	test("it offers replace-source and reset-to-preset", () => {
		const src = source();
		expect(src).toContain("Reset to preset");
		expect(src).toContain("resetMaterialGroupToPreset");
		expect(src).toContain("canResetToPreset");
	});

	test("editing a group records the operator, never the preset", () => {
		expect(source()).toContain("overrideMaterialGroup(materials, sources, group, value)");
	});
});

describe("filledMaterialCount", () => {
	test("counts only groups carrying content", () => {
		expect(filledMaterialCount(EMPTY_PROJECT_MATERIALS)).toBe(0);
		expect(
			filledMaterialCount({
				...EMPTY_PROJECT_MATERIALS,
				story: { body: "brief", assetIds: [], materialId: null },
				visual: { body: "", assetIds: ["e1"], materialId: null },
			}),
		).toBe(2);
	});

	test("a group naming a material but holding nothing does not count", () => {
		expect(
			filledMaterialCount({
				...EMPTY_PROJECT_MATERIALS,
				story: { body: "", assetIds: [], materialId: "m1" },
			}),
		).toBe(0);
	});

	test("the style bible alone is not a filled group", () => {
		expect(
			filledMaterialCount({ ...EMPTY_PROJECT_MATERIALS, styleBible: { body: "x", locked: false } }),
		).toBe(0);
	});
});

/* The regenerate path has to make the Visual material reachable before or during
 * the action — an operator who dislikes a frame should not have to go hunting for
 * what produced it. */
describe("regeneration reaches the visual material", () => {
	/* Two entry points, two files. The canvas button lives on the stage; the
	   inspector's scene editor reaches it through `onRegenScene`, and that moved
	   with the inspector when it left the stage for the workspace's inspector
	   slot. Both are asserted, because losing either one loses the requirement on
	   that surface only — which is exactly how it would go unnoticed. */
	test("the stage opens the drawer on Visual as it regenerates", () => {
		const stage = readFileSync(`${import.meta.dirname}/timeline-stage.tsx`, "utf8");
		expect(stage).toContain('setMaterialsGroup("visual")');
		expect(stage).toContain("const regenScene");
		expect(stage).toContain("onClick={() => regenScene(");
	});

	test("the inspector opens the drawer on Visual as it regenerates", () => {
		const inspector = readFileSync(`${import.meta.dirname}/timeline-clip-inspector.tsx`, "utf8");
		expect(inspector).toContain('setMaterialsGroup("visual")');
		expect(inspector).toContain("const regenScene");
		expect(inspector).toContain("onRegenScene={regenScene}");
	});

	test("the stage no longer mounts the project-references popover", () => {
		const stage = readFileSync(`${import.meta.dirname}/timeline-stage.tsx`, "utf8");
		expect(stage).toContain("ProjectMaterialsDrawer");
		expect(stage).not.toContain("<ProjectReferencesPopover");
	});
});

/* Visual references are images used by generation. Story, Voice and Rules keep
 * their text/material source controls, without image-reference pickers. */
describe("reference assets", () => {
	const withRefs = (ids: string[]): ProjectMaterials => ({
		...EMPTY_PROJECT_MATERIALS,
		visual: { body: "stickman", assetIds: ids, materialId: null },
	});

	test("an opened group offers a way to add references", () => {
		const html = drawer(EMPTY_PROJECT_MATERIALS, "visual");
		expect(html).toContain("References");
		expect(html).toContain('aria-label="Add Visual reference"');
	});

	test("visual reference picker filters the fixed visual roles", () => {
		const html = readFileSync(`${import.meta.dirname}/../catalog/material-assets.tsx`, "utf8");
		for (const label of ["Style", "Characters", "Locations", "Products", "Props"]) {
			expect(html).toContain(`"${label}"`);
		}
		expect(html).toContain("roleForRef(ref) === createRole");
		expect(html).not.toContain("Logo");
	});

	test("an empty group says so rather than showing nothing", () => {
		expect(drawer(EMPTY_PROJECT_MATERIALS, "visual")).toContain("None attached.");
	});

	test("attached references render as edit cards", () => {
		const html = drawer(withRefs(["e1"]), "visual");
		expect(html).toContain("Kitchen");
		expect(html).toContain('aria-label="Edit Kitchen reference"');
		expect(html).not.toContain("None attached.");
	});

	test("visual references expose project-level reference use", () => {
		const html = drawer(
			{
				...EMPTY_PROJECT_MATERIALS,
				visual: {
					body: "",
					assetIds: ["e3"],
					materialId: null,
					referenceSettings: [
						{
							entityId: "e3",
							role: "character",
							referenceUse: "inspiration",
							selectionHint: "",
							state: "user-set",
							locked: false,
						},
					],
				},
			},
			"visual",
		);
		expect(html).toContain('aria-label="Edit Anna reference"');
		expect(html).toContain("<i>inspiration</i>");
		expect(assetsSource()).toContain("aria-label={`${panelRef.label} reference use`}");
	});

	test("visual references expose project-level selection hints", () => {
		const html = drawer(
			{
				...EMPTY_PROJECT_MATERIALS,
				visual: {
					body: "",
					assetIds: ["e3"],
					materialId: null,
					referenceSettings: [
						{
							entityId: "e3",
							role: "character",
							referenceUse: "exact",
							selectionHint: "Anna, woman",
							state: "user-set",
							locked: false,
						},
					],
				},
			},
			"visual",
		);
		expect(html).toContain("Anna, woman");
		expect(assetsSource()).toContain("aria-label={`${panelRef.label} selection hint`}");
	});

	test("a reference with no image falls back to its initial", () => {
		expect(drawer(withRefs(["e2"]), "visual")).toContain("tl2-ref-chip-empty");
	});

	/* An id the pool cannot resolve is COUNTED, not dropped. Hiding it would make
	 * the material look emptier than what generation actually receives. */
	test("an unresolved id is surfaced rather than silently hidden", () => {
		expect(drawer(withRefs(["gone"]), "visual")).toContain("1 unresolved");
	});

	test("an empty pool disables adding rather than offering an empty picker", () => {
		expect(drawer(EMPTY_PROJECT_MATERIALS, "visual", [])).toContain("No references in library");
	});

	test("only Visual offers image references", () => {
		for (const [group, label] of [
			["story", "Story"],
			["voice", "Voice"],
			["rules", "Rules"],
		] as const) {
			expect(drawer(EMPTY_PROJECT_MATERIALS, group)).not.toContain(
				`aria-label="Add ${label} reference"`,
			);
			expect(drawer(EMPTY_PROJECT_MATERIALS, group)).not.toContain("References");
		}
	});

	test("the scan view shows no reference controls", () => {
		expect(drawer(withRefs(["e1"]))).not.toContain('aria-label="Add Visual reference"');
	});

	test("the row summary counts attached references", () => {
		expect(drawer(withRefs(["e1", "e2"]))).toContain("2 references");
	});
});

describe("toggleAsset", () => {
	test("adds by appending, so provider order is stable", () => {
		expect(toggleAsset(["e1"], "e2")).toEqual(["e1", "e2"]);
	});

	test("removes an already-selected id", () => {
		expect(toggleAsset(["e1", "e2"], "e1")).toEqual(["e2"]);
	});

	/* Re-adding must not reorder the rest: `routedAssetIds` hands the provider its
	 * references in this order, so a toggle that reshuffled would make the same
	 * selection produce a different prompt. */
	test("removing then re-adding keeps the others in place", () => {
		const once = toggleAsset(["e1", "e2", "e3"], "e2");
		expect(toggleAsset(once, "e2")).toEqual(["e1", "e3", "e2"]);
	});

	test("does not mutate the input", () => {
		const before = ["e1"];
		toggleAsset(before, "e2");
		expect(before).toEqual(["e1"]);
	});
});

/* The badge is the operator's only signal that a group still matches the library
 * row it came from. Claiming clean inheritance after they rewrote the text is the
 * kind of lie that gets discovered at generation time. */
describe("a group edited away from its material", () => {
	const backed = (over: Partial<ProjectMaterials["visual"]> = {}): ProjectMaterials => ({
		...EMPTY_PROJECT_MATERIALS,
		visual: { body: "stickman on white", assetIds: [], materialId: "m1", ...over },
	});
	const faithful = { "materials.visual": { layer: "operator" as const, defaulterId: "m1" } };
	const edited = { "materials.visual": { layer: "operator" as const, defaulterId: null } };

	function render(
		materials: ProjectMaterials,
		sources: Record<string, { layer: "operator"; defaulterId: string | null }>,
	): string {
		return renderToStaticMarkup(
			<ProjectMaterialsDrawer
				materials={materials}
				setMaterials={noop}
				sources={sources}
				setSources={noop}
				preset={null}
				library={[]}
				pool={POOL}
				onLibraryChanged={noop}
				settingsSummary="9:16"
				initialGroup="visual"
				onClose={noop}
			/>,
		);
	}

	test("a faithful copy reads as from the material", () => {
		const html = render(backed(), faithful);
		expect(html).toContain("From material");
		expect(html).not.toContain("Modified from material");
	});

	test("an edited copy says so instead of claiming clean inheritance", () => {
		expect(render(backed({ body: "my own words" }), edited)).toContain("Modified from material");
	});

	test("only the edited copy offers a way back to the material", () => {
		expect(render(backed({ body: "my own words" }), edited)).toContain("Revert to material");
		expect(render(backed(), faithful)).not.toContain("Revert to material");
	});
});

/* The writer style picker.
 *
 * This suite renders static markup, so effects never run and the fetched picker
 * cannot be driven here. What IS checkable is the pair of properties that would
 * actually cause damage if they regressed: the picker must not appear without a
 * workspace, and choosing one must write to workspace config rather than into the
 * project's Story material body. The second is read from the source, the way
 * `http-boundary.test.ts` reads for `fetch(` — a type cannot catch it, because
 * both spellings are legal calls.
 */
describe("writer style picker", () => {
	test("no workspace means no picker rather than a guessed one", () => {
		const html = drawer(EMPTY_PROJECT_MATERIALS, "story");
		expect(html).not.toContain("Writer style");
		expect(html).not.toContain("Narration writer style");
	});

	test("it lives in the Story group, next to the narration it governs", () => {
		expect(source()).toContain('group === "story" && workspace && writerStyle');
	});

	/* The whole reason it is workspace-scoped: a project-local copy would let two
	 * projects in one workspace disagree about the channel's voice. */
	test("choosing one writes to workspace config, never into the Story body", () => {
		const chooser = source().slice(
			source().indexOf("const chooseWriterStyle"),
			source().indexOf("/** A hand edit"),
		);
		expect(chooser).toContain("saveWriterStyle(workspace");
		expect(chooser).not.toContain("writeGroup");
		expect(chooser).not.toContain("setMaterials");
	});

	test("a failed save rolls the picker back instead of showing a value the workspace lacks", () => {
		const chooser = source().slice(
			source().indexOf("const chooseWriterStyle"),
			source().indexOf("/** A hand edit"),
		);
		expect(chooser).toContain("previous");
		expect(chooser).toContain("setError");
	});

	/* Clearing the selection is a real state — "narrate as this workspace did
	 * before writer styles existed" — so it has to stay reachable in the list. */
	test("the list offers a way back to no writer style", () => {
		expect(source()).toContain('value: "", label: "No writer style"');
	});

	/* `oneOf` rather than `e.target.value as WriterStyle`: the empty option is
	 * reachable, so the cast would be a claim the browser cannot honour. */
	test("the selected value is narrowed, not asserted", () => {
		expect(source()).toContain("oneOf(e, WRITER_STYLES)");
		expect(source()).not.toContain("as WriterStyle)");
	});
});
