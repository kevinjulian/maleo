import { readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	DeleteConfirm,
	NoteRow,
	ReferenceLibrary,
	type ReferenceLibraryMode,
} from "./reference-library.tsx";
import { SceneCastPicker } from "./scene-cast.tsx";
import { EntityEditor } from "./entity-editor.tsx";
import type { RefImage, RefsState } from "@maleo/shared";

// Static render + source assertions (harness has no DOM/event layer).

const anna: RefImage = {
	id: "anna",
	label: "Anna",
	seed: 1,
	role: "character",
	tags: ["character"],
	imageUrl: "/u/anna.png",
	description: "a woman in a red coat",
};
const cafe: RefImage = {
	id: "cafe",
	label: "Cafe",
	seed: 2,
	role: "location",
	tags: ["location"],
	imageUrl: "/u/cafe.png",
};
const stranger: RefImage = {
	id: "stranger",
	label: "Stranger",
	seed: 3,
	role: "character",
	tags: ["character"],
	imageUrl: "/u/x.png",
};

const refs: RefsState = {
	images: [anna, cafe, stranger],
	speakers: [],
	notes: [],
	style: { tone: "", palette: "", music: "" },
};
const selection = { prompt: "", entityIds: ["anna", "cafe"] };

function renderLibrary(
	mode: ReferenceLibraryMode,
	over: Partial<Parameters<typeof ReferenceLibrary>[0]> = {},
): string {
	return renderToStaticMarkup(
		<ReferenceLibrary
			mode={mode}
			type="video"
			refs={refs}
			setRefs={() => {}}
			pool={[anna, cafe, stranger]}
			projectSelection={selection}
			onToggleProjectSelection={() => {}}
			sceneCasts={[["anna"], ["anna", "cafe"]]}
			onDeleteRef={async () => true}
			onClose={() => {}}
			{...over}
		/>,
	);
}

describe("ReferenceLibrary — one surface, mode changes layout only", () => {
	test("every mode exposes the same operations", () => {
		// The defect being fixed: search and usage counts existed in one panel and
		// were simply absent in the others.
		for (const mode of ["rail", "panel", "picker"] as ReferenceLibraryMode[]) {
			const html = renderLibrary(mode);
			expect(html).toContain("Search references");
			expect(html).toContain("New reference");
			expect(html).toContain("New note");
			expect(html).toContain("Anna");
		}
	});

	test("groups by role in every mode", () => {
		for (const mode of ["rail", "panel", "picker"] as ReferenceLibraryMode[]) {
			const html = renderLibrary(mode);
			expect(html).toContain("Character");
			expect(html).toContain("Location");
		}
	});

	test("filters reference images by role", () => {
		const html = renderLibrary("panel");
		expect(html).toContain("Reference type filter");
		for (const label of ["Style", "Character", "Location", "Product", "Prop"]) {
			expect(html).toContain(label);
		}
	});

	test("shows each entity's tier", () => {
		const html = renderLibrary("panel");
		expect(html).toContain("Selected by project");
		expect(html).toContain("In workspace library");
	});

	test("usage count spans the project selection and scene casts", () => {
		// anna: project + 2 scenes = 3; cafe: project + 1 scene = 2.
		const html = renderLibrary("panel");
		expect(html).toContain("Used in 3 places");
		expect(html).toContain("Used in 2 places");
	});

	test("a scene context marks what is cast and offers casting", () => {
		const html = renderLibrary("picker", { sceneRefIds: ["anna"], onToggleSceneRef: () => {} });
		expect(html).toContain("Cast in this scene");
		expect(html).toContain("Cast");
	});
});

describe("SceneCastPicker — casts from the project's selection", () => {
	function render(over: Partial<Parameters<typeof SceneCastPicker>[0]> = {}): string {
		return renderToStaticMarkup(
			<SceneCastPicker
				library={[anna, cafe, stranger]}
				projectSelection={selection}
				sceneRefIds={["anna"]}
				onToggleSceneRef={() => {}}
				onSelectIntoProject={() => {}}
				sceneName="Opening"
				{...over}
			/>,
		);
	}

	test("offers only entities the project has selected", () => {
		const html = render();
		expect(html).toContain("Anna");
		expect(html).toContain("Cafe");
		// `stranger` is in the workspace library but not selected by the project.
		// Casting it would generate nothing, so it is not offered as castable.
		const castArea = html.slice(
			0,
			html.indexOf("Workspace library") === -1 ? html.length : html.indexOf("Workspace library"),
		);
		expect(castArea).not.toContain("Stranger");
	});

	test("reaches the workspace library through an explicit add step", () => {
		expect(render()).toContain("Add from workspace library");
	});

	test("names the scene it generates for", () => {
		expect(render()).toContain("Opening");
	});

	test("empty project selection points at the add step rather than the library", () => {
		const html = render({ projectSelection: { prompt: "", entityIds: [] } });
		expect(html).toContain("no references selected yet");
	});

	test("shows material selection hint matches without editing them on the scene", () => {
		const html = render({
			sceneRefIds: [],
			sceneText: "Anna walks into the cafe",
			visualReferenceSettings: [
				{
					entityId: "anna",
					role: "character",
					referenceUse: "exact",
					selectionHint: "Anna, woman",
					state: "user-set",
					locked: false,
				},
			],
		});
		expect(html).toContain("Hint: anna");
		expect(html).not.toContain("selection hint");
	});
});

describe("EntityEditor — one form for the entity", () => {
	function render(over: Partial<Parameters<typeof EntityEditor>[0]> = {}): string {
		return renderToStaticMarkup(
			<EntityEditor initial={anna} tier="project" onClose={() => {}} onSave={() => {}} {...over} />,
		);
	}

	test("edits role, label, input scenario, and canonical image in one place", () => {
		const html = render();
		expect(html).toContain("Role");
		expect(html).toContain("Label");
		expect(html).toContain("Input scenario");
		expect(html).toContain("Canonical image URL");
		expect(html).toContain("a woman in a red coat");
	});

	test("presents the scenario as material default input, not a note", () => {
		const html = render();
		expect(html).toContain("Default use-when text");
		expect(html).not.toContain(">Note<");
	});

	test("offers the lead subject toggle only for an entity the project selected", () => {
		expect(render({ onSetPrimary: () => {} })).toContain("Lead subject");
		expect(render({ tier: "workspace", onSetPrimary: () => {} })).not.toContain("Lead subject");
	});

	test("the save path goes through the extracted, tested write rules", async () => {
		// The rules themselves are covered directly in entity-write.test.ts; this
		// only asserts the component still routes through them.
		const text = readFileSync(`${import.meta.dirname}/reference-library.tsx`, "utf8");
		expect(text).toContain("applyEntityDraft(draft, editor?.initial");
		expect(text).toContain("upsertPool(entries, next)");
	});
});

describe("lead subject reaches the relation", () => {
	test("the editor's toggle persists through the project-reference route", async () => {
		// `is_primary` drives roster-size backfill at generation, so setting it has
		// to reach `project_reference` — not just local state.
		const helpers = readFileSync(`${import.meta.dirname}/../../api/reference-writes.ts`, "utf8");
		expect(helpers).toContain(
			"setProjectPrimaryReferenceEntity(projectId, next ? entityId : null)",
		);

		const api = readFileSync(`${import.meta.dirname}/../../api/references.ts`, "utf8");
		expect(api).toContain("/reference-entities/primary");

		// Every mount that can edit an entity wires it.
		for (const file of ["../editor/editor-views.tsx", "../timeline/timeline-panel-host.tsx"]) {
			const source = readFileSync(`${import.meta.dirname}/${file}`, "utf8");
			expect(source).toContain("persistPrimaryEntity(projectId, id, next)");
		}
	});

	test("marking one lead subject clears the previous one locally", async () => {
		const source = readFileSync(`${import.meta.dirname}/../editor/editor-views.tsx`, "utf8");
		// The mark function sets `default` true only for the named id, so the flag
		// cannot end up on two entities the way a plain toggle would allow.
		expect(source).toContain("({ ...r, default: next && r.id === id })");
	});
});

describe("the editor can acquire a canonical image", () => {
	// Regression: the consolidation first shipped with only a URL field, which
	// silently dropped the operator's generate and upload paths. An entity with
	// no image cannot be cast, so acquiring one belongs in the entity form.
	function render(over: Partial<Parameters<typeof EntityEditor>[0]> = {}): string {
		return renderToStaticMarkup(<EntityEditor onClose={() => {}} onSave={() => {}} {...over} />);
	}

	test("offers generate, upload, and URL", () => {
		const html = render();
		expect(html).toContain("Generate");
		expect(html).toContain("Upload");
		expect(html).toContain("URL");
	});

	test("a new entity opens on generate with the prompt presets", () => {
		const html = render();
		expect(html).toContain("Generate image");
		expect(html).toContain("Character");
		expect(html).toContain("Sends the prompt exactly as written");
	});

	test("an entity that already has an image offers regenerate", () => {
		const html = render({ initial: { ...anna, prompt: "character sheet" } });
		expect(html).toContain("Regenerate");
	});

	test("generate and upload call the real endpoints", async () => {
		const source = readFileSync(`${import.meta.dirname}/entity-editor.tsx`, "utf8");
		expect(source).toContain(
			'generateSceneImage({ visual: prompt, aspect: "1:1", refs: [], source: "reference" })',
		);
		expect(source).toContain("uploadReferenceImage(file, projectId)");
	});

	test("a generated reference image is attributed as one, and to no project", async () => {
		const source = readFileSync(`${import.meta.dirname}/entity-editor.tsx`, "utf8");
		// A reference entity is workspace-scoped, so it names no project — the server
		// resolves the tenant. This generation was previously recorded nowhere at all.
		expect(source).toContain('source: "reference"');
		const generation = source.match(/generateSceneImage\(\{[^}]+\}\)/)?.[0] ?? "";
		expect(generation).not.toContain("projectId");
		expect(generation).not.toContain("workspace:");
	});

	test("the generating prompt is persisted with the entity", async () => {
		// The rule moved to entity-write.ts, where it is covered by behaviour
		// rather than by matching source text.
		const source = readFileSync(
			`${import.meta.dirname}/../../models/references/entity-write.ts`,
			"utf8",
		);
		expect(source).toContain("prompt: draft.prompt ?? existing?.prompt");
	});
});

describe("generation reads the project selection, not a pinned flag", () => {
	// The studio used to resolve an item's references as `default || item.refIds`,
	// ignoring the project selection entirely — the reverse of the timeline, which
	// reads the selection and lets `default` stay out of generation. That made
	// selecting a reference do nothing in the studio, and made the lead-subject
	// toggle (which rides on `default`) silently apply an entity to every scene.
	test("studio and timeline resolve an item's references the same way", async () => {
		const studio = readFileSync(`${import.meta.dirname}/../editor/studio.tsx`, "utf8");
		const timeline = readFileSync(
			`${import.meta.dirname}/../../hooks/timeline/use-scene-refs.ts`,
			"utf8",
		);

		// Both now route through the one resolver instead of each carrying the rule.
		for (const source of [studio, timeline]) {
			expect(source).toContain("resolveSceneRefs");
		}
		expect(timeline).toContain("resolveSceneRoster");
		for (const source of [studio, timeline]) {
			expect(source).not.toContain("useGlobalReferences === false ? [] :");
		}
		// No generation path filters on the legacy pin flag any more — not the
		// studio, not the board/list ref counts, not text-post images.
		expect(studio).not.toContain("r.default ||");
		const workspaces = readFileSync(`${import.meta.dirname}/../editor/workspaces.tsx`, "utf8");
		// Text projects are retired: a post generates no image, so it has no reference rule at all.
		expect(workspaces).not.toContain("generateSceneImage");
		expect(workspaces).not.toContain("refs.images.filter((r) => r.default)");
	});

	test("the reference count shown matches what generation receives", async () => {
		const studio = readFileSync(`${import.meta.dirname}/../editor/studio.tsx`, "utf8");
		expect(studio).toContain("{refsFor(scene).length} references used");
	});
});

describe("every per-scene selection stays reachable", () => {
	// Scene state that no UI can set is invisible to a suite that tests helpers:
	// `refIds`, `voiceIds` and `noteIds` all load, persist and round-trip whether
	// or not anything can write them. The consolidation orphaned two of the three.
	test("studio wires all three scene selection kinds", async () => {
		const studio = readFileSync(`${import.meta.dirname}/../editor/studio.tsx`, "utf8");
		expect(studio).toContain('onToggle("image", id)');
		expect(studio).toContain('onToggle("note", id)');
		expect(studio).toContain('onToggle("voice", c.id)');
	});

	test("a note offers a per-scene toggle when a scene is in context", () => {
		const html = renderToStaticMarkup(
			<NoteRow
				note={{ id: "n1", label: "Tone", body: "warm", tags: [] }}
				inScene={false}
				onOpen={() => {}}
				onToggleScene={() => {}}
				onToggleDefault={() => {}}
			/>,
		);
		expect(html).toContain("Add to scene");
		expect(html).toContain("Make default");
	});

	test("a note already in the scene reads as attached", () => {
		const html = renderToStaticMarkup(
			<NoteRow
				note={{ id: "n1", label: "Tone", body: "warm", tags: [] }}
				inScene
				onOpen={() => {}}
				onToggleScene={() => {}}
				onToggleDefault={() => {}}
			/>,
		);
		expect(html).toContain("In scene");
	});

	test("a default note shows no per-scene toggle — it is already on every scene", () => {
		const html = renderToStaticMarkup(
			<NoteRow
				note={{ id: "n1", label: "Tone", body: "warm", tags: [], default: true }}
				inScene={false}
				onOpen={() => {}}
				onToggleScene={() => {}}
				onToggleDefault={() => {}}
			/>,
		);
		expect(html).not.toContain("Add to scene");
		expect(html).toContain("applied by default");
	});
});

describe("locking a reference also attaches it", () => {
	// Generation resolves a declared id through the project roster
	// (resolveEntityRefImages -> projectCast), so a lock on an entity that is not
	// attached renders nothing. The workspace library lists every entity in the
	// workspace while a project's roster is a handful, so selecting from the
	// library is precisely how an inert lock gets created.
	test("persistProjectSelection attaches on select and leaves the roster alone on unselect", async () => {
		const helpers = readFileSync(`${import.meta.dirname}/../../api/reference-writes.ts`, "utf8");
		expect(helpers).toContain("attachProjectReferenceEntity(projectId, entityId)");
		// Unselecting must not detach: the agent attaches entities it creates
		// without locking them, and a roster row without a lock is harmless.
		expect(helpers).toContain("if (!selected) return;");
		expect(helpers).not.toContain("detachProjectReferenceEntity");
	});

	test("every mount that can select wires the attach", async () => {
		for (const file of ["../editor/editor-views.tsx", "../timeline/timeline-panel-host.tsx"]) {
			const source = readFileSync(`${import.meta.dirname}/${file}`, "utf8");
			expect(source).toContain("persistProjectSelection(projectId, id, willSelect)");
		}
	});
});

describe("deleting a note goes to the note store", () => {
	// Notes were routed through onDeleteRef -> deleteGlobalReference -> DELETE
	// /assets/:id, which is the asset registry and knows nothing about a note id.
	// The note vanished from local state and returned on the next reload.
	test("the note path calls deleteProjectNote, not the asset endpoint", async () => {
		const source = readFileSync(`${import.meta.dirname}/reference-library.tsx`, "utf8");
		expect(source).toContain("await deleteProjectNote(projectId, id)");
		expect(source).toContain(
			'confirm.kind === "note" ? await removeNote(confirm.id) : await onDeleteRef(confirm.id)',
		);
		// The note modal must ask for the note kind, or it falls back to reference.
		expect(source).toContain('askDelete(noteModal.id!, noteModal.label ?? "note", "note")');
	});

	test("a reference still deletes through onDeleteRef", async () => {
		const source = readFileSync(`${import.meta.dirname}/reference-library.tsx`, "utf8");
		expect(source).toMatch(
			/onDelete=\{\s*editor\.initial\s*\?\s*\(\s*,?\s*\)\s*=>\s*askDelete\(\s*editor\.initial!\.id,\s*editor\.initial!\.label,?\s*\)\s*:\s*undefined,?\s*\}/,
		);
	});

	test("the confirm dialog names the store the row actually leaves", () => {
		const render = (kind: "note" | "reference"): string =>
			renderToStaticMarkup(
				<DeleteConfirm
					label="Tone"
					kind={kind}
					count={2}
					scenes={1}
					deleting={false}
					error={null}
					onCancel={() => {}}
					onConfirm={() => {}}
				/>,
			);
		expect(render("note")).toContain("Delete note?");
		expect(render("note")).toContain("removed from this project");
		// A note is not cast into scenes, so it must not claim scenes will lose it.
		expect(render("note")).not.toContain("workspace library");
		expect(render("reference")).toContain("Delete reference?");
		expect(render("reference")).toContain("workspace library");
	});
});
