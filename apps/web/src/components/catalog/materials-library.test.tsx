import { describe, expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MATERIAL_GROUPS, EMPTY_PRESET_MATERIAL_SELECTION } from "@maleo/shared";
import { MaterialsLibrary } from "./materials-library.tsx";
import { defaultSelectionHint, MaterialAssets } from "./material-assets.tsx";
import { PresetMaterialPicker } from "./preset-material-picker.tsx";
import { pathToView, viewToPath } from "@models/core/routing.ts";
import { LibraryHeader } from "./library-chrome.tsx";

// Static render + source assertions (harness has no DOM/event layer).
describe("MaterialsLibrary", () => {
	test("renders the header and a create affordance", () => {
		const html = renderToStaticMarkup(<MaterialsLibrary />);
		expect(html).toContain("Materials");
		expect(html).toContain("New material");
	});

	test("wires CRUD to the API helpers", () => {
		const src = readFileSync(`${import.meta.dirname}/materials-library.tsx`, "utf8");
		for (const fn of [
			"listContentMaterials(",
			"createContentMaterial(",
			"updateContentMaterial(",
			"deleteContentMaterial(",
		]) {
			expect(src).toContain(fn);
		}
	});

	test("groups the library by the four material groups", () => {
		const src = readFileSync(`${import.meta.dirname}/materials-library.tsx`, "utf8");
		expect(src).toContain("MATERIAL_GROUP_ORDER.map");
		expect(MATERIAL_GROUPS).toEqual(["story", "visual", "voice", "rules"]);
	});
});

/* The library's top-level creative surfaces are the vocabulary an operator learns
 * first. These assert the words, because a heading that drifts is invisible to a
 * type checker and to every other test in this suite. */
describe("library vocabulary", () => {
	const headingOf = (type: Parameters<typeof LibraryHeader>[0]["type"]): string =>
		renderToStaticMarkup(<LibraryHeader type={type} />);

	test("presets are Project Presets, explained as Materials plus a Video Template", () => {
		const html = headingOf("presets");
		expect(html).toContain("Project Presets");
		expect(html).toContain("Project Materials plus one Video Template");
	});

	test("templates are Video Templates, described as structure and timing", () => {
		const html = headingOf("templates");
		expect(html).toContain("Video Templates");
		expect(html).toContain("structure and timing");
	});

	/* Renamed from Custom Elements when the surface grew from the saved blocks
	 * alone to the whole placeable catalogue. The saved ones are a group inside
	 * it now, so naming the page after them described a fifth of its contents. */
	test("elements are Elements, not Custom Elements, and are not described as defaults", () => {
		const html = headingOf("elements");
		expect(html).toContain(">Elements<");
		expect(html).not.toContain(">Custom Elements<");
		expect(html).toContain("Plain text, five shapes, and motion compositions you create.");
		expect(html).not.toContain("default");
	});

	test("materials are described as generation context, not clip defaults", () => {
		const html = headingOf("materials");
		expect(html).toContain("Reusable generation context");
		expect(html).not.toContain("default");
	});

	test("no library surface says defaulter", () => {
		for (const type of [
			"references",
			"voices",
			"presets",
			"materials",
			"templates",
			"elements",
		] as const) {
			expect(headingOf(type).toLowerCase()).not.toContain("defaulter");
		}
	});

	test("the library header does not duplicate route navigation", () => {
		const html = headingOf("presets");
		expect(html).not.toContain("catalog-scope-tabs");
		expect(html).not.toContain("<nav");
	});
});

/* Page identity without duplicated route navigation. The app shell already owns
 * the Library destinations, so the page body starts with the current surface. */
describe("library page hierarchy", () => {
	const types = ["references", "voices", "presets", "materials", "templates", "elements"] as const;

	test("the title and its blurb render without page-local scope navigation", () => {
		for (const type of types) {
			const html = renderToStaticMarkup(<LibraryHeader type={type} />);
			const title = html.indexOf("pg-title");
			const lead = html.indexOf("pg-lead");
			expect(title).toBeGreaterThan(-1);
			expect(lead).toBeGreaterThan(title);
			expect(html).not.toContain("catalog-scope-tabs");
		}
	});

	test("the page-level count sits with the title", () => {
		const html = renderToStaticMarkup(<LibraryHeader type="materials" count={3} />);
		expect(html).toContain("3 items");
		expect(html.indexOf("pg-actions")).toBeGreaterThan(-1);
	});

	/* The heading is the shared one, so the tabs cannot have been smuggled back in
	 * through a slot above the title. */
	test("no library surface renders chrome above the shared heading", () => {
		for (const type of types) {
			const html = renderToStaticMarkup(<LibraryHeader type={type} />);
			expect(html.slice(0, html.indexOf("pg-head-row"))).not.toContain("<nav");
		}
	});
});

/* Building a reusable Visual material with a logo or product shot used to require
 * opening an unrelated project, because this surface said "attach assets in the
 * project drawer" and offered no control of its own. A reusable record that can
 * only be finished from inside a project is not reusable. */
describe("authoring references on a reusable material", () => {
	const src = (): string => readFileSync(`${import.meta.dirname}/materials-library.tsx`, "utf8");

	test("the editor mounts the shared reference picker", () => {
		expect(src()).toContain("<MaterialAssets");
		expect(src()).toContain('from "./material-assets.tsx"');
	});

	test("it loads the workspace reference library rather than a project roster", () => {
		expect(src()).toContain("fetchContentCatalogue()");
	});

	test("edited references are what gets saved, not the original ones", () => {
		const source = src();
		expect(source).toMatch(/body:\s*body\.trim\(\s*,?\s*\),\s*assetIds,\s*referenceSettings/);
		// The old behaviour: assets frozen at whatever the record already had.
		expect(source).not.toMatch(/assetIds:\s*initial\?\.assetIds\s*\?\?\s*\[\s*,?\s*\]/);
	});

	test("visual material refs are selected from the workspace library", () => {
		const source = src();
		expect(source).toContain("fetchContentCatalogue()");
		expect(source).toContain("selectReference");
		expect(source).not.toContain("generateSceneImage(");
		expect(source).not.toContain("uploadReferenceImage(");
	});

	test("it no longer tells operators to go to the project drawer", () => {
		expect(src().toLowerCase()).not.toContain("happens in the project drawer");
	});

	test("an empty workspace library says so in workspace terms", () => {
		expect(src()).toContain("No references in the workspace library");
	});
});

/* The picker is one component on both surfaces, so a fix to either lands on both. */
describe("the shared reference picker", () => {
	test("renders selected references as edit cards", () => {
		const html = renderToStaticMarkup(
			<MaterialAssets
				group="visual"
				selected={["e1"]}
				pool={[{ id: "e1", label: "Logo", seed: 1, imageUrl: "/l.png" }]}
				onToggle={() => undefined}
			/>,
		);
		expect(html).toContain("Logo");
		expect(html).toContain('aria-label="Edit Logo reference"');
		expect(html).toContain("Always available");
	});

	test("offers an add affordance naming the group", () => {
		const html = renderToStaticMarkup(
			<MaterialAssets
				group="visual"
				selected={[]}
				pool={[{ id: "e1", label: "Anna", seed: 1 }]}
				onToggle={() => undefined}
			/>,
		);
		expect(html).toContain('aria-label="Add Visual reference"');
		expect(html).toContain("Add reference");
		expect(html).toContain("None attached.");
	});

	test("library editor shows references only for Visual materials", () => {
		const source = readFileSync(`${import.meta.dirname}/materials-library.tsx`, "utf8");
		expect(source).toContain('{group === "visual" && (');
		expect(source).toContain("<MaterialAssets");
	});

	test("group choice is a dropdown card, not inline chips", () => {
		const source = readFileSync(`${import.meta.dirname}/materials-library.tsx`, "utf8");
		expect(source).toContain("tl2-materials-group-card");
		expect(source).toContain("tl2-materials-group-menu");
	});

	test("a caller can name what an empty pool means for its surface", () => {
		const html = renderToStaticMarkup(
			<MaterialAssets
				group="visual"
				selected={[]}
				pool={[]}
				onToggle={() => undefined}
				emptyPoolLabel="Nothing here yet"
			/>,
		);
		expect(html).toContain("Nothing here yet");
	});

	test("visual refs expose selection hint summaries and panel controls", () => {
		const html = renderToStaticMarkup(
			<MaterialAssets
				group="visual"
				selected={["e1"]}
				pool={[{ id: "e1", label: "Anna", seed: 1, imageUrl: "/a.png", role: "character" }]}
				referenceSettings={[
					{
						entityId: "e1",
						role: "character",
						referenceUse: "exact",
						selectionHint: "Anna, woman",
						state: "user-set",
						locked: false,
					},
				]}
				onToggle={() => undefined}
				onReferenceUseChange={() => undefined}
				onSelectionHintChange={() => undefined}
			/>,
		);
		expect(html).toContain("Anna, woman");
		expect(html).toContain("user-set");
		expect(html).toContain('aria-label="Edit Anna reference"');
		const source = readFileSync(`${import.meta.dirname}/material-assets.tsx`, "utf8");
		expect(source).toContain("aria-label={`${panelRef.label} selection hint`}");
		expect(source).toContain("Input scenario");
		expect(source).toContain("Reference type");
		expect(source).toContain("Reference use");
		expect(source).toContain("const filteredPool = pool");
		expect(source).toContain(".filter((ref) => roleForRef(ref) === createRole)");
		expect(source).toContain("Search references");
		expect(source).toContain("pendingRefId");
		/* The panel's own Back button is gone with its hand-rolled head: it
		 * called the same `closePanel` as the Close beside it, and Modal
		 * supplies one close control. What replaced the head is the primitive. */
		expect(source).toContain("<Modal");
		expect(source).not.toContain('aria-label="Back"');
		expect(source).toMatch(/>\s*Cancel\s*<\/Button>\s*/);
		expect(source).toMatch(/>\s*Save\s*<\/Button>\s*/);
		expect(source).toMatch(/Delete\s*<\/Button>\s*/);
		expect(source).not.toContain("Reference source");
	});

	test("a blank material scenario defaults from the reference Input scenario", () => {
		const ref = { id: "e1", label: "Anna", seed: 1, description: "Use when Anna appears" };
		expect(defaultSelectionHint("", ref)).toBe("Use when Anna appears");
		expect(defaultSelectionHint("Use for closeups", ref)).toBe("Use for closeups");
	});

	test("saved material scenarios are not rebound to later reference edits", () => {
		const source = readFileSync(`${import.meta.dirname}/material-assets.tsx`, "utf8");
		expect(source).toContain("settingFor(ref.id)?.selectionHint");
		expect(source).not.toContain("ref.description ?? settingFor");
	});
});

/* "New Project Preset" with an empty material library used to be a dead end: it
 * named Library > Materials but offered nothing to click, so the only way forward
 * was knowing the URL. */
describe("the path out of an empty material library", () => {
	test("the preset editor offers a CTA rather than four dead sentences", () => {
		expect(readFileSync(`${import.meta.dirname}/presets-library.tsx`, "utf8")).toContain(
			"Create the first material",
		);
	});

	test("a preset stays Materials + Video Template — the CTA links out, it does not inline an editor", () => {
		const src = readFileSync(`${import.meta.dirname}/presets-library.tsx`, "utf8");
		expect(src).not.toContain("createContentMaterial(");
		expect(src).toContain('<h2 className="pl-h2">Materials</h2>');
		expect(src).toContain('<h2 className="pl-h2">Video Template</h2>');
	});

	/* Drive the href the component actually renders through the real router.
	 *
	 * Asserting the link and the route SEPARATELY is what let a wrong param ship:
	 * one test pinned `?group=`, another pinned that `?new=` parses, and both
	 * passed while the button went nowhere. The round trip is the only assertion
	 * that can fail when the two disagree. */
	test("each per-group empty state links somewhere that opens the create form", () => {
		const html = renderToStaticMarkup(
			<PresetMaterialPicker
				materials={[]}
				value={EMPTY_PRESET_MATERIAL_SELECTION}
				onChange={() => undefined}
			/>,
		);
		const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]!);
		expect(hrefs.length).toBe(MATERIAL_GROUPS.length);

		for (const [index, group] of MATERIAL_GROUPS.entries()) {
			const url = new URL(hrefs[index]!, "https://app.test");
			expect(pathToView(url.pathname, url.search)).toEqual({
				kind: "library",
				type: "materials",
				newGroup: group,
			});
		}
	});

	test("the whole-library CTA lands on the create form too", () => {
		const src = readFileSync(`${import.meta.dirname}/presets-library.tsx`, "utf8");
		const href = src.match(/href="(\/library\/materials[^"]*)"/)?.[1];
		expect(href).toBeDefined();
		const url = new URL(href!, "https://app.test");
		expect(pathToView(url.pathname, url.search)).toEqual({
			kind: "library",
			type: "materials",
			newGroup: "story",
		});
	});

	test("the library opens that form rather than the list", () => {
		const src = readFileSync(`${import.meta.dirname}/materials-library.tsx`, "utf8");
		expect(src).toContain("setEditing({ material: null, group });");
	});

	/* A bad link lands on the list, not on a form for a group that does not exist. */
	test("an unrecognised group is ignored", () => {
		const src = readFileSync(`${import.meta.dirname}/materials-library.tsx`, "utf8");
		/* `oneOf` returns the MEMBER or undefined, so the guard and the value the
		 * form opens with are the same expression — a link naming a group that does
		 * not exist cannot get past it. */
		expect(src).toContain("const group = oneOf(initialNewGroup, MATERIAL_GROUPS);");
		expect(src).toContain("if (!group) return;");
	});

	test("the round trip through the route survives", () => {
		expect(viewToPath({ kind: "library", type: "materials", newGroup: "rules" })).toBe(
			"/library/materials?new=rules",
		);
	});

	/* `edit` and `new` cannot both apply; edit wins, because it names a real row. */
	test("an edit link is not confused with a create link", () => {
		expect(pathToView("/library/materials", "?edit=m1&new=story")).toEqual({
			kind: "library",
			type: "materials",
			editId: "m1",
		});
	});
});
