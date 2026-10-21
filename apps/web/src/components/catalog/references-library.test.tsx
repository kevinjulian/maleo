import { describe, expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import type { RefImage } from "@maleo/shared";
import { filterReferenceImages, ReferencesLibrary } from "./references-library.tsx";
import { EntityEditor } from "@components/references/entity-editor.tsx";

const refs: RefImage[] = [
	{
		id: "anna",
		label: "Anna",
		role: "character",
		tags: ["character"],
		description: "red coat",
		seed: 1,
		imageUrl: "/anna.png",
	},
	{
		id: "mug",
		label: "Mug",
		role: "prop",
		tags: ["prop"],
		description: "ceramic cup",
		seed: 2,
		imageUrl: "/mug.png",
	},
	{
		id: "look",
		label: "Warm look",
		role: "style",
		tags: ["style"],
		description: "golden light",
		seed: 3,
		imageUrl: "/look.png",
	},
];

describe("ReferencesLibrary", () => {
	test("reference image filtering combines query and role", () => {
		expect(filterReferenceImages(refs, "", null).map((ref) => ref.id)).toEqual([
			"anna",
			"mug",
			"look",
		]);
		expect(filterReferenceImages(refs, "", "character").map((ref) => ref.id)).toEqual(["anna"]);
		expect(filterReferenceImages(refs, "cup", "prop").map((ref) => ref.id)).toEqual(["mug"]);
		expect(filterReferenceImages(refs, "cup", "character")).toEqual([]);
	});

	test("renders source and type filters through the shared toolbar", () => {
		const html = renderToStaticMarkup(<ReferencesLibrary />);
		expect(html).toContain('aria-label="Reference source"');
		expect(html).toContain('aria-label="Reference type"');
		expect(html).toContain(">Images<");
		expect(html).not.toContain(">Products<");
		expect(html).toContain(">Character<");
	});

	test("detail and edit reuse the existing entity editor and canonical save path", () => {
		const source = readFileSync(`${import.meta.dirname}/references-library.tsx`, "utf8");
		expect(source).toContain("<Detail");
		expect(source).toContain("<EntityEditor");
		expect(source).toContain('mode="identity"');
		expect(source).toContain("applyEntityDraft");
		expect(source).toContain("saveWorkspaceReferenceEntity");
		expect(source).toContain("deleteWorkspaceReferenceEntity");
		expect(source).toContain("<DeleteConfirm");
		expect(source).not.toContain("saveGlobalReferenceAsset");
	});

	/* The detail used to be a second overlay: its own fixed container, its own
	 * scrim, and a `html:has()` scroll-lock stand-in. It renders through Modal
	 * now, so the assertions are that the surface keeps its own content rules
	 * and owns none of the overlay ones. */
	test("reference detail renders through the Modal primitive and keeps no overlay of its own", () => {
		const css = readFileSync(`${import.meta.dirname}/library.css`, "utf8");
		const modalCss = readFileSync(
			`${import.meta.dirname}/../../design-system/components/modal.css`,
			"utf8",
		);
		const editorCss = [
			"create-content",
			"create-content-shell",
			"create-content-workspace",
			"create-content-studio",
			"create-content-views",
			"create-content-storyboard",
			"create-content-references",
		]
			.map((sheet) => readFileSync(`${import.meta.dirname}/../editor/${sheet}.css`, "utf8"))
			.join("\n");
		const source = readFileSync(`${import.meta.dirname}/references-library.tsx`, "utf8");
		expect(css).toContain("object-fit: contain");
		expect(css).toContain("@media (max-width: 640px)");
		expect(css).not.toContain(".catalog-ref-detail-scrim");
		expect(css).not.toContain(".catalog-ref-detail-sheet");
		expect(editorCss).not.toContain("html:has(.catalog-ref-detail)");
		expect(editorCss).not.toContain(".cv-modal");
		expect(modalCss).toContain(".cv-modal.cv-modal-dock");
		expect(source).toContain('bodyClassName="catalog-ref-detail"');
		expect(source).not.toContain('role="dialog"');
	});

	test("identity edit exposes only role label input scenario and delete", () => {
		const html = renderToStaticMarkup(
			<EntityEditor
				initial={refs[0]}
				mode="identity"
				onClose={() => {}}
				onSave={() => {}}
				onDelete={() => {}}
			/>,
		);
		expect(html).toContain(">Role<");
		expect(html).toContain(">Label<");
		expect(html).toContain(">Input scenario<");
		expect(html).toContain(" Delete</button>");
		expect(html).toContain("cv-entity-editor-readonly-media");
		expect(html).toContain('src="/anna.png"');
		expect(html).not.toContain("Image prompt");
		expect(html).not.toContain("Canonical image URL");
		expect(html).not.toContain("Generate image");
	});
});
