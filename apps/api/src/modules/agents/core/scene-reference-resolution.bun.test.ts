/* End-to-end: the entity model reaches scene reference resolution.
 *
 * Covers the wiring, not the pure helpers — a project whose references live in
 * reference_entity must produce a roster, auto-cast a single entity into an
 * untagged scene, and carry the entity's DESCRIPTION into the reference map (the
 * previous path put the bare label there). Reaching that wiring genuinely needs a
 * database, which is why these tests keep one.
 *
 * The decode rules underneath — which entities are castable, which enter
 * resolution, what a null tags column falls back to — moved to
 * `lib/wire/reference-decode.bun.test.ts` and run against rows in memory. The file was
 * called `entity-roster.test.ts`, after a module that no longer exists. */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { closeMaleoDb, openDb } from "@maleo/db/connection";
import { createContentProject } from "@maleo/db/project-detail";
import {
	addProjectReference,
	setProjectPrimaryReference,
	upsertReferenceEntity,
} from "@maleo/db/references";
import { projectRoster, resolveSceneRefImages } from "./visual-gen.ts";
import { EMPTY_PROJECT_MATERIALS, orderRefsForBinding, referenceMapForRefs } from "@maleo/shared";
import type { AgentJob } from "./model.ts";
import type { AgentScene } from "./model.ts";

const testDbDir = join(tmpdir(), `maleo-roster-${randomUUID().slice(0, 8)}`);
const testDbPath = join(testDbDir, "maleo.db");

async function resetDbFile(): Promise<void> {
	await closeMaleoDb();
	for (const suffix of ["", "-shm", "-wal"]) rmSync(`${testDbPath}${suffix}`, { force: true });
}

async function makeProject() {
	const created = await createContentProject({ title: "Cast", type: "video" });
	if (!created) throw new Error("project not created");
	return { id: created.project.id, workspace: created.project.workspace };
}

async function addEntity(
	workspace: string,
	projectId: string,
	id: string,
	role: string,
	description: string,
): Promise<void> {
	await upsertReferenceEntity({
		id,
		workspace,
		role,
		label: id,
		description,
		canonical_image_url: `/api/image-gen/files/${id}.png`,
		tags: [role],
	});
	await addProjectReference({ project_id: projectId, entity_id: id });
}

async function addEntityWithImage(
	workspace: string,
	projectId: string,
	id: string,
	role: string,
	imageUrl: string | null,
): Promise<void> {
	await upsertReferenceEntity({
		id,
		workspace,
		role,
		label: id,
		description: "",
		canonical_image_url: imageUrl,
		tags: [role],
	});
	await addProjectReference({ project_id: projectId, entity_id: id });
}

function scene(refIds?: string[]): AgentScene {
	return {
		name: "S1",
		durationSec: 3,
		shot: "Medium Shot",
		move: "Static",
		transition: "cut",
		visual: "v",
		voiceover: "",
		refIds,
	} as AgentScene;
}

function job(projectId: string): AgentJob {
	// `events` is not optional on AgentJob — a fabricated job that omits it hides
	// anything the resolver reports.
	return { projectId, projectRefIds: [], events: [] } as unknown as AgentJob;
}

function hintedJob(projectId: string): AgentJob {
	return {
		...job(projectId),
		materials: {
			...EMPTY_PROJECT_MATERIALS,
			visual: {
				...EMPTY_PROJECT_MATERIALS.visual,
				assetIds: ["anna", "bob", "cafe"],
				referenceSettings: [
					{
						entityId: "anna",
						role: "character",
						referenceUse: "exact",
						selectionHint: "Anna, woman, mother",
						state: "user-set",
						locked: false,
					},
					{
						entityId: "bob",
						role: "character",
						referenceUse: "exact",
						selectionHint: "Bob, man, father",
						state: "user-set",
						locked: false,
					},
					{
						entityId: "cafe",
						role: "location",
						referenceUse: "exact",
						selectionHint: "cafe, coffee shop",
						state: "user-set",
						locked: false,
					},
				],
			},
		},
	} as AgentJob;
}

describe("entity-backed roster and cast resolution", () => {
	beforeEach(async () => {
		process.env.MALEO_DB_PATH = testDbPath;
		mkdirSync(dirname(testDbPath), { recursive: true });
		await resetDbFile();
		openDb();
	});

	afterEach(async () => {
		await resetDbFile();
		delete process.env.MALEO_DB_PATH;
		if (existsSync(testDbDir)) rmSync(testDbDir, { recursive: true, force: true });
	});

	it("builds a roster from selected entities and excludes style", async () => {
		const p = await makeProject();
		await addEntity(p.workspace, p.id, "anna", "character", "a woman in a red coat");
		await addEntity(p.workspace, p.id, "look", "style", "muted film grain");
		expect(await projectRoster(p.id)).toEqual([{ id: "anna", label: "anna", role: "character" }]);
	});

	it("auto-casts a single-entity roster into an untagged scene", async () => {
		const p = await makeProject();
		await addEntity(p.workspace, p.id, "anna", "character", "a woman in a red coat");
		const refs = await resolveSceneRefImages(job(p.id), scene());
		expect(refs.map((r) => r.entityId)).toEqual(["anna"]);
	});

	it("attaches nothing when the project has no entities and no legacy references", async () => {
		const p = await makeProject();
		expect(await resolveSceneRefImages(job(p.id), scene())).toEqual([]);
	});

	it("backfills the primary entity into an untagged scene when the roster has two", async () => {
		const p = await makeProject();
		await addEntity(p.workspace, p.id, "anna", "character", "a woman in a red coat");
		await addEntity(p.workspace, p.id, "bob", "character", "a man in a grey suit");
		await setProjectPrimaryReference(p.id, "bob");
		const refs = await resolveSceneRefImages(job(p.id), scene());
		expect(refs.map((r) => r.entityId)).toEqual(["bob"]);
	});

	it("honours a declared cast over the primary", async () => {
		const p = await makeProject();
		await addEntity(p.workspace, p.id, "anna", "character", "a woman in a red coat");
		await addEntity(p.workspace, p.id, "bob", "character", "a man in a grey suit");
		await setProjectPrimaryReference(p.id, "bob");
		const refs = await resolveSceneRefImages(job(p.id), scene(["anna"]));
		expect(refs.map((r) => r.entityId)).toEqual(["anna"]);
	});

	it("uses selection hints to choose the woman character when a scene has no cast", async () => {
		const p = await makeProject();
		await addEntity(p.workspace, p.id, "anna", "character", "a woman in a red coat");
		await addEntity(p.workspace, p.id, "bob", "character", "a man in a grey suit");
		const refs = await resolveSceneRefImages(hintedJob(p.id), {
			...scene(),
			visual: "Anna closes the door.",
		} as AgentScene);
		expect(refs.map((r) => r.entityId)).toEqual(["anna"]);
	});

	it("uses selection hints to choose the man character when a scene has no cast", async () => {
		const p = await makeProject();
		await addEntity(p.workspace, p.id, "anna", "character", "a woman in a red coat");
		await addEntity(p.workspace, p.id, "bob", "character", "a man in a grey suit");
		const refs = await resolveSceneRefImages(hintedJob(p.id), {
			...scene(),
			visual: "The father waits outside.",
		} as AgentScene);
		expect(refs.map((r) => r.entityId)).toEqual(["bob"]);
	});

	it("lets manual scene ids carry a couple scene instead of guessing from hints", async () => {
		const p = await makeProject();
		await addEntity(p.workspace, p.id, "anna", "character", "a woman in a red coat");
		await addEntity(p.workspace, p.id, "bob", "character", "a man in a grey suit");
		const refs = await resolveSceneRefImages(hintedJob(p.id), {
			...scene(["anna", "bob"]),
			visual: "Anna and Bob share the frame.",
		} as AgentScene);
		expect(refs.map((r) => r.entityId)).toEqual(["anna", "bob"]);
	});

	it("blocks an ambiguous two-character hint match before image generation", async () => {
		const p = await makeProject();
		await addEntity(p.workspace, p.id, "anna", "character", "a woman in a red coat");
		await addEntity(p.workspace, p.id, "bob", "character", "a man in a grey suit");
		expect(() =>
			resolveSceneRefImages(hintedJob(p.id), {
				...scene(),
				visual: "Anna and Bob share the frame.",
			} as AgentScene),
		).toThrow(/Ambiguous reference selection/);
	});

	it("does not attach all references when no selection hint matches", async () => {
		const p = await makeProject();
		await addEntity(p.workspace, p.id, "anna", "character", "a woman in a red coat");
		await addEntity(p.workspace, p.id, "bob", "character", "a man in a grey suit");
		const refs = await resolveSceneRefImages(hintedJob(p.id), {
			...scene(),
			visual: "Empty hallway at dawn.",
		} as AgentScene);
		expect(refs).toEqual([]);
	});

	/* Scene refs are explicit. Project-level selection remains the roster/legacy
	 * lock, but it is not implicitly attached to every scene. */
	it("keeps a scene's own references rather than unioning every project selection", async () => {
		const p = await makeProject();
		await addEntity(p.workspace, p.id, "anna", "character", "a woman in a red coat");
		await addEntity(p.workspace, p.id, "bob", "character", "a man in a grey suit");
		await addEntity(p.workspace, p.id, "cafe", "location", "a small corner cafe");
		const locked = { ...job(p.id), projectRefIds: ["anna", "bob"] } as AgentJob;

		const optedOut = { ...scene(["cafe"]), useGlobalReferences: false } as AgentScene;
		expect((await resolveSceneRefImages(locked, optedOut)).map((r) => r.entityId)).toEqual([
			"cafe",
		]);

		// A scene that did not opt out still uses only what it declares.
		expect((await resolveSceneRefImages(locked, scene(["cafe"]))).map((r) => r.entityId)).toEqual([
			"cafe",
		]);
	});

	it("attaches nothing to an opted-out scene that casts nothing", async () => {
		const p = await makeProject();
		await addEntity(p.workspace, p.id, "anna", "character", "a woman in a red coat");
		await addEntity(p.workspace, p.id, "bob", "character", "a man in a grey suit");
		const locked = { ...job(p.id), projectRefIds: ["anna"] } as AgentJob;
		const optedOut = { ...scene(), useGlobalReferences: false } as AgentScene;
		expect(await resolveSceneRefImages(locked, optedOut)).toEqual([]);
	});

	it("carries the entity description into the reference map, not just the label", async () => {
		const p = await makeProject();
		await addEntity(p.workspace, p.id, "anna", "character", "a woman in a red coat");
		await addEntity(p.workspace, p.id, "bob", "character", "a man in a grey suit");
		const refs = await resolveSceneRefImages(job(p.id), scene(["anna", "bob"]));
		const map = referenceMapForRefs(orderRefsForBinding(refs));
		expect(map).toContain("a woman in a red coat");
		expect(map).toContain("a man in a grey suit");
		// Two subjects attached → anti-blend guidance must be present.
		expect(map).toContain("Do not blend or swap identities");
	});

	it("keeps map indices aligned with the provider array", async () => {
		const p = await makeProject();
		await addEntity(p.workspace, p.id, "anna", "character", "a woman in a red coat");
		await addEntity(p.workspace, p.id, "cafe", "location", "a small corner cafe");
		const ordered = orderRefsForBinding(
			await resolveSceneRefImages(job(p.id), scene(["anna", "cafe"])),
		);
		const map = referenceMapForRefs(ordered);
		ordered.forEach((ref, i) => {
			if (ref.role === "style") return;
			expect(map).toContain(`Image ${i + 1} = ${ref.entityId}`);
		});
	});

	/* This used to drop the hallucinated id and generate from the rest. It blocks
	 * now, and the change is deliberate: from here an id that is not on the roster
	 * is indistinguishable from a reference the operator selected and the project
	 * failed to attach — which is the bug this whole change exists to stop. The
	 * planner's own closed-list validation is what should keep a hallucinated id
	 * from reaching this point; catching it here as a block makes that gap
	 * visible instead of quietly generating around it. */
	it("blocks on a planner-hallucinated id when the roster has two or more", async () => {
		const p = await makeProject();
		await addEntity(p.workspace, p.id, "anna", "character", "a woman in a red coat");
		await addEntity(p.workspace, p.id, "bob", "character", "a man in a grey suit");
		expect(() => resolveSceneRefImages(job(p.id), scene(["anna", "ghost"]))).toThrow(/ghost/);
	});

	/* These three properties used to be covered only against `resolveRefImages`,
	 * the content_references reader. They are the SSRF boundary, the subject cap and
	 * the style-first ordering, so they have to hold on the entity path too — the
	 * legacy tests went with the legacy function. */
	it("names a subject by its label when it carries no description", async () => {
		// The map used to fall back to the raw entity id, because resolveEntityRefImages
		// set `label` to `description || id` and never read the entity's own label.
		// 18 of 69 image-carrying entities in the live workspace hit that path.
		const p = await makeProject();
		await upsertReferenceEntity({
			id: "e1",
			workspace: p.workspace,
			role: "character",
			label: "Stickman",
			description: "",
			canonical_image_url: "/api/image-gen/files/e1.png",
			tags: ["character"],
		});
		await addProjectReference({ project_id: p.id, entity_id: "e1" });
		await addEntity(p.workspace, p.id, "e2", "character", "a woman in a red coat");

		const refs = await resolveSceneRefImages(job(p.id), scene(["e1", "e2"]));
		const map = referenceMapForRefs(orderRefsForBinding(refs));
		expect(map).toContain("Stickman");
		expect(map).not.toContain("= e1: e1.");
		// A written description still wins over the label.
		expect(map).toContain("a woman in a red coat");
	});

	it("caps subjects at 3 but leaves location uncapped", async () => {
		const p = await makeProject();
		for (const id of ["a", "b", "c", "d"]) await addEntity(p.workspace, p.id, id, "character", "");
		await addEntity(p.workspace, p.id, "env", "location", "");
		const refs = await resolveSceneRefImages(job(p.id), scene(["a", "b", "c", "d", "env"]));
		expect(refs.filter((r) => r.role === "character")).toHaveLength(3);
		expect(refs.some((r) => r.entityId === "env")).toBe(true);
	});

	it("puts the style url first and drops an unsafe one", async () => {
		const p = await makeProject();
		await addEntity(p.workspace, p.id, "hero", "character", "");
		const styled = { ...job(p.id), styleImageUrl: "/api/image-gen/files/style.png" } as AgentJob;
		expect((await resolveSceneRefImages(styled, scene(["hero"])))[0]).toEqual({
			url: "/api/image-gen/files/style.png",
			role: "style",
		});

		const unsafe = { ...job(p.id), styleImageUrl: "http://169.254.169.254/evil.png" } as AgentJob;
		expect(
			(await resolveSceneRefImages(unsafe, scene(["hero"]))).some((r) => r.role === "style"),
		).toBe(false);
	});

	/* Attached, and refused by the SSRF check. Not a roster miss, and deliberately
	 * not a block: the project has this reference, one url is unreachable, and
	 * turning the security boundary into a run-stopper would let a single bad url
	 * make a project ungenerable. Dropped and reported, as before. */
	it("drops and reports an entity whose canonical image is not a safe local url", async () => {
		const p = await makeProject();
		await addEntityWithImage(
			p.workspace,
			p.id,
			"evil",
			"character",
			"http://169.254.169.254/meta.png",
		);
		await addEntity(p.workspace, p.id, "hero", "character", "");
		const j = job(p.id);
		const refs = await resolveSceneRefImages(j, scene(["evil", "hero"]));
		expect(refs.map((r) => r.entityId)).toEqual(["hero"]);
		const said = j.events.find((ev) => ev.kind === "assistant_text");
		expect((said as { text: string } | undefined)?.text).toContain("evil");
	});

	it("excludes an entity with no image from the roster", async () => {
		const p = await makeProject();
		await upsertReferenceEntity({
			id: "described-only",
			workspace: p.workspace,
			role: "character",
			label: "Described only",
			description: "a character whose portrait failed to generate",
			canonical_image_url: null,
		});
		await addProjectReference({ project_id: p.id, entity_id: "described-only" });
		expect(await projectRoster(p.id)).toEqual([]);
	});
});

describe("the subject cap is reported, not silently applied", () => {
	/* CONTEXT.md: a surface that counts references counts the CAPPED set, or it
	 * describes a different set than the render. The editor marks a dropped entity
	 * "won't render"; the agent path discarded the resolver's report entirely, so a
	 * run generated with fewer subjects than the user selected and said nothing. */
	it("names the subjects the cap skipped", async () => {
		const p = await createContentProject({ title: "capped", type: "video" });
		const ids: string[] = [];
		for (const name of ["one", "two", "three", "four", "five"]) {
			const e = await upsertReferenceEntity({
				id: `ent-${name}`,
				workspace: "default",
				role: "character",
				label: name,
				canonical_image_url: `/uploads/${name}.png`,
				origin: "linked",
			});
			await addProjectReference({ project_id: p.project.id, entity_id: e!.id });
			ids.push(e!.id);
		}

		const job = { projectId: p.project.id, projectRefIds: ids, events: [] } as unknown as AgentJob;
		const refs = await resolveSceneRefImages(job, { name: "Wide", refIds: ids } as never);

		// Five subjects selected, DEFAULT_CAST_SUBJECT_CAP kept.
		expect(refs.length).toBeLessThan(ids.length);
		const said = job.events.find((e) => e.kind === "assistant_text");
		expect(said).toBeDefined();
		expect((said as { text: string }).text).toContain("over the 3-subject limit");
	});

	it("says nothing when nothing was capped", async () => {
		const p = await createContentProject({ title: "uncapped", type: "video" });
		const e = await upsertReferenceEntity({
			id: "solo",
			workspace: "default",
			role: "character",
			label: "Solo",
			canonical_image_url: "/uploads/solo.png",
			origin: "linked",
		});
		await addProjectReference({ project_id: p.project.id, entity_id: e!.id });

		const job = {
			projectId: p.project.id,
			projectRefIds: [e!.id],
			events: [],
		} as unknown as AgentJob;
		await resolveSceneRefImages(job, { name: "Wide", refIds: [e!.id] } as never);

		expect(job.events.filter((ev) => ev.kind === "assistant_text")).toEqual([]);
	});

	/* An id the project has NOT attached used to vanish without a word, and the cap
	 * report could not cover it: `dropped` is built from entities found in the roster,
	 * so an id that never resolved never reached it. It then became an
	 * `assistant_text` event, which said the right thing at the wrong time — after
	 * the image had already been generated without the reference.
	 *
	 * It throws now. These assert the refusal at the agent seam, not just the
	 * resolver — the pure rule is covered in `shared/src/reference-roster.test.ts`,
	 * and a run can still generate the wrong pictures while that rule is perfectly
	 * correct. */
	it("refuses to resolve a declared reference the project has not attached", async () => {
		const p = await createContentProject({ title: "unattached", type: "video" });
		const e = await upsertReferenceEntity({
			id: "attached",
			workspace: "default",
			role: "character",
			label: "Attached",
			canonical_image_url: "/uploads/attached.png",
			origin: "linked",
		});
		await addProjectReference({ project_id: p.project.id, entity_id: e!.id });
		// Exists in the workspace, deliberately NOT attached to this project.
		await upsertReferenceEntity({
			id: "stranger",
			workspace: "default",
			role: "character",
			label: "Stranger",
			canonical_image_url: "/uploads/stranger.png",
			origin: "linked",
		});

		const job = {
			projectId: p.project.id,
			projectRefIds: [e!.id, "stranger"],
			events: [],
		} as unknown as AgentJob;

		// Not "resolves the attached one and mentions the other" — the operator
		// asked for both, and a picture with one of them is the wrong picture.
		expect(() =>
			resolveSceneRefImages(job, { name: "Wide", refIds: [e!.id, "stranger"] } as never),
		).toThrow(/stranger/);
	});

	/* The roster-1 case is the dangerous one: `selectCast` auto-casts the single
	 * entity without reading the declared list at all, so the miss is invisible AND a
	 * different entity renders than the one asked for. */
	it("refuses even when a one-entity roster would auto-cast over the miss", async () => {
		const p = await createContentProject({ title: "solo-roster", type: "video" });
		const e = await upsertReferenceEntity({
			id: "only",
			workspace: "default",
			role: "character",
			label: "Only",
			canonical_image_url: "/uploads/only.png",
			origin: "linked",
		});
		await addProjectReference({ project_id: p.project.id, entity_id: e!.id });

		const job = {
			projectId: p.project.id,
			projectRefIds: ["ghost"],
			events: [],
		} as unknown as AgentJob;

		// This was the dangerous case: `selectCast` auto-casts the single entity
		// without reading the declared list, so the run rendered `only` while the
		// operator had asked for `ghost`. Substituting an unrelated roster entry
		// for a missing selection is exactly what must not happen.
		expect(() => resolveSceneRefImages(job, { name: "Wide", refIds: ["ghost"] } as never)).toThrow(
			/ghost/,
		);
	});

	/* A cap drop and a roster miss are not the same failure and must not get the
	 * same treatment. The cap is a declared limit doing its job — the run
	 * continues and says what it skipped. A roster miss is a selection that
	 * cannot render — the run stops. */
	it("blocks on an unattached id rather than reporting it beside a cap drop", async () => {
		const p = await createContentProject({ title: "both", type: "video" });
		const ids: string[] = [];
		for (const name of ["a", "b", "c", "d"]) {
			const e = await upsertReferenceEntity({
				id: `both-${name}`,
				workspace: "default",
				role: "character",
				label: name,
				canonical_image_url: `/uploads/${name}.png`,
				origin: "linked",
			});
			await addProjectReference({ project_id: p.project.id, entity_id: e!.id });
			ids.push(e!.id);
		}

		const declared = [...ids, "nowhere"];
		const job = {
			projectId: p.project.id,
			projectRefIds: declared,
			events: [],
		} as unknown as AgentJob;
		expect(() => resolveSceneRefImages(job, { name: "Wide", refIds: declared } as never)).toThrow(
			/nowhere/,
		);

		// The cap drop is still reported, on the same pass, before the refusal.
		const texts = job.events
			.filter((ev) => ev.kind === "assistant_text")
			.map((ev) => (ev as { text: string }).text);
		expect(texts.some((t) => t.includes("over the 3-subject limit"))).toBe(true);
	});

	it("lets a cap drop through — a declared limit is not a broken selection", async () => {
		const p = await createContentProject({ title: "cap only", type: "video" });
		const ids: string[] = [];
		for (const name of ["a", "b", "c", "d"]) {
			const e = await upsertReferenceEntity({
				id: `cap-${name}`,
				workspace: "default",
				role: "character",
				label: name,
				canonical_image_url: `/uploads/${name}.png`,
				origin: "linked",
			});
			await addProjectReference({ project_id: p.project.id, entity_id: e!.id });
			ids.push(e!.id);
		}

		const job = { projectId: p.project.id, projectRefIds: ids, events: [] } as unknown as AgentJob;
		const refs = await resolveSceneRefImages(job, { name: "Wide", refIds: ids } as never);

		expect(refs).toHaveLength(3);
		expect(job.events.some((ev) => ev.kind === "assistant_text")).toBe(true);
	});
});
