/* Every surface that shows, counts, or generates a scene's references has to
 * name the same set — the studio card, the scene drawer, and the payload the
 * agent receives. They used to each carry their own copy of the rule, disagreeing
 * about the opt-out (the agent path ignored it) and about the subject cap (only
 * the drawer applied it), so a card could promise references the render dropped. */
import { describe, expect, test } from "vite-plus/test";
import { effectiveRefIds, DEFAULT_CAST_SUBJECT_CAP } from "@maleo/shared";
import type { ProjectSelection, RefImage, Scene } from "@maleo/shared";
import { resolveSceneRefs } from "@hooks/timeline/use-scene-refs.ts";

const entity = (id: string, role: string, extra: Partial<RefImage> = {}): RefImage => ({
	id,
	label: id,
	seed: 1,
	role: role,
	tags: [role],
	imageUrl: `/uploads/${id}.png`,
	inRoster: true,
	...extra,
});

const scene = (over: Partial<Scene> = {}): Scene =>
	({
		id: 1,
		dur: 3,
		name: "S1",
		shot: "Medium Shot",
		move: "Static",
		vis: "v",
		vo: "",
		img: false,
		...over,
	}) as Scene;

const selection = (...entityIds: string[]): ProjectSelection => ({ prompt: "", entityIds });

/** What the agent wire sends per scene (CreateContent.buildStart) — scene
 *  assignment only, by the shared rule. */
const agentWireIds = (sel: ProjectSelection, s: Scene): string[] => effectiveRefIds(sel, s);

describe("every surface resolves a scene's references the same way", () => {
	const pool = [
		entity("anna", "character"),
		entity("bob", "character"),
		entity("cafe", "location"),
		// In the workspace library, not attached to this project.
		entity("stranger", "character", { inRoster: false }),
	];

	test("studio, drawer, and agent wire agree on an ordinary scene", () => {
		const sel = selection("anna", "bob");
		const s = scene({ refIds: ["cafe"] });

		const resolved = resolveSceneRefs(pool, sel, s);
		expect(resolved.ids).toEqual(["cafe"]);
		expect(agentWireIds(sel, s)).toEqual(resolved.ids);
	});

	test("an opted-out scene resolves to its own cast on every surface", () => {
		const sel = selection("anna", "bob");
		const s = scene({ refIds: ["cafe"], useGlobalReferences: false });

		expect(resolveSceneRefs(pool, sel, s).ids).toEqual(["cafe"]);
		expect(agentWireIds(sel, s)).toEqual(["cafe"]);
	});

	test("the subject cap is part of the answer, not a per-panel afterthought", () => {
		const subjects = Array.from({ length: DEFAULT_CAST_SUBJECT_CAP + 2 }, (_, i) =>
			entity(`s${i + 1}`, "character"),
		);
		const sel = selection(...subjects.map((e) => e.id));
		const resolved = resolveSceneRefs(subjects, sel, scene({ refIds: subjects.map((e) => e.id) }));

		// The card count and the drawer's list are both this number.
		expect(resolved.refs).toHaveLength(DEFAULT_CAST_SUBJECT_CAP);
		expect(resolved.dropped.map((r) => r.id)).toEqual(["s4", "s5"]);
		// Nothing is silently lost: resolved + dropped covers what was asked for.
		expect(resolved.refs.length + resolved.dropped.length).toBe(subjects.length);
	});

	test("an entity outside the project's roster contributes nothing", () => {
		// Generation resolves ids through the roster, so a workspace-only entity
		// renders nothing — the surfaces must not count it either.
		const resolved = resolveSceneRefs(pool, selection("anna"), scene({ refIds: ["stranger"] }));
		expect(resolved.ids).toEqual([]);
	});

	/* Contributing nothing is not the same as being reportable. "resolved + dropped
	 * covers what was asked for" holds for the cap, but an id absent from the roster
	 * never entered `dropped` — so the editor could show neither a chip nor a note for
	 * a reference the operator had selected. The agent path names these; the editor
	 * has to be able to as well, or the two surfaces disagree about a set the operator
	 * chose. */
	test("an entity outside the roster is reported, not just excluded", () => {
		const resolved = resolveSceneRefs(pool, selection("anna"), scene({ refIds: ["stranger"] }));
		expect(resolved.missing).toEqual(["stranger"]);
	});

	test("resolved plus dropped plus missing covers everything asked for", () => {
		const sel = selection("anna", "stranger");
		const s = scene({ refIds: ["cafe"] });
		const resolved = resolveSceneRefs(pool, sel, s);

		const accounted = [
			...resolved.refs.map((r) => r.id),
			...resolved.dropped.map((r) => r.id),
			...resolved.missing,
		];
		expect([...accounted].sort()).toEqual([...agentWireIds(sel, s)].sort());
	});

	test("nothing is reported missing when every declared id is on the roster", () => {
		expect(
			resolveSceneRefs(pool, selection("anna", "bob"), scene({ refIds: ["cafe"] })).missing,
		).toEqual([]);
	});

	test("a one-entity roster auto-casts, as the server does", () => {
		const oneEntityPool = [
			entity("anna", "character"),
			entity("stranger", "character", { inRoster: false }),
		];
		expect(resolveSceneRefs(oneEntityPool, selection(), scene()).ids).toEqual(["anna"]);
	});

	test("an empty roster attaches nothing", () => {
		const workspaceOnly = [entity("stranger", "character", { inRoster: false })];
		expect(resolveSceneRefs(workspaceOnly, selection("stranger"), scene()).ids).toEqual([]);
	});
});
