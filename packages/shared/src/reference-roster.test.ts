import { describe, expect, test } from "vite-plus/test";
import type { CastEntity } from "./generation-cast.ts";
import { orderRefsForBinding, referenceMapForRefs } from "./generation-cast.ts";
import { effectiveRefIds, resolveSceneRoster } from "./reference-roster.ts";
import type { ProjectSelection } from "./project-selection.ts";

const sel = (...entityIds: string[]): ProjectSelection => ({ prompt: "", entityIds });

const entity = (
	id: string,
	role: CastEntity["role"],
	extra: Partial<CastEntity> = {},
): CastEntity => ({
	id,
	role,
	imageUrl: `https://cdn.test/${id}.png`,
	label: id,
	description: `${id} description`,
	...extra,
});

describe("effectiveRefIds", () => {
	test("uses the scene assignment, not every project selection", () => {
		expect(effectiveRefIds(sel("anna", "coat"), { refIds: ["kitchen"] })).toEqual(["kitchen"]);
	});

	test("legacy global opt-out does not remove scene assignments", () => {
		expect(
			effectiveRefIds(sel("anna", "coat"), { refIds: ["kitchen"], useGlobalReferences: false }),
		).toEqual(["kitchen"]);
	});

	test("duplicate scene assignments appear once", () => {
		expect(effectiveRefIds(sel("anna"), { refIds: ["anna", "kitchen", "anna"] })).toEqual([
			"anna",
			"kitchen",
		]);
	});

	test("a scene with no assignment leaves defaulting to the roster", () => {
		expect(effectiveRefIds(sel("anna"), {})).toEqual([]);
	});

	test("an opted-out scene with no cast resolves to nothing", () => {
		expect(effectiveRefIds(sel("anna"), { useGlobalReferences: false })).toEqual([]);
	});
});

/* The reference map is built from the FINAL ordered ref list — after style refs
 * are moved to the back, urls deduped and the provider cap applied — because
 * "Image N" in the prompt has to be refs[N-1] at the provider. `resolveSceneRoster`
 * does not see that list, so it does not build the map; `referenceMapForRefs`
 * does. The resolver used to return a `referenceMapText` as well, which nothing
 * consumed and which gave a style entity its own indexed subject line. */
function mapFor<
	E extends { id: string; role: string; imageUrl: string; label?: string; description?: string },
>(refs: E[]): string {
	return referenceMapForRefs(
		orderRefsForBinding(
			refs.map((e) => ({
				url: e.imageUrl,
				role: e.role,
				entityId: e.id,
				label: e.label,
				description: e.description,
			})),
		),
	);
}

describe("resolveSceneRoster — roster-size defaulting", () => {
	test("an empty roster resolves to nothing", () => {
		const out = resolveSceneRoster({
			roster: [],
			selection: sel("anna"),
			scene: { refIds: ["anna"] },
		});
		expect(out.ids).toEqual([]);
		expect(out.refs).toEqual([]);
		expect(mapFor(out.refs)).toBe("");
	});

	test("a one-entity roster auto-casts into an untagged scene", () => {
		const roster = [entity("anna", "character")];
		const out = resolveSceneRoster({ roster, selection: sel(), scene: {} });
		expect(out.ids).toEqual(["anna"]);
	});

	test("the lead subject backfills an empty cast on a 2+ roster", () => {
		const roster = [entity("anna", "character"), entity("ben", "character", { primary: true })];
		const out = resolveSceneRoster({ roster, selection: sel(), scene: {} });
		expect(out.ids).toEqual(["ben"]);
	});

	test("a 2+ roster with no lead subject and an empty cast resolves to nothing", () => {
		const roster = [entity("anna", "character"), entity("ben", "character")];
		const out = resolveSceneRoster({ roster, selection: sel(), scene: {} });
		expect(out.ids).toEqual([]);
	});

	test("an opted-out scene keeps only its own cast", () => {
		const roster = [
			entity("anna", "character"),
			entity("ben", "character"),
			entity("kitchen", "location"),
		];
		const out = resolveSceneRoster({
			roster,
			selection: sel("anna", "ben"),
			scene: { refIds: ["kitchen"], useGlobalReferences: false },
		});
		expect(out.ids).toEqual(["kitchen"]);
	});

	test("ids outside the roster are skipped", () => {
		const roster = [entity("anna", "character"), entity("ben", "character")];
		const out = resolveSceneRoster({
			roster,
			selection: sel("anna"),
			scene: { refIds: ["ghost"] },
		});
		expect(out.ids).toEqual([]);
	});
});

describe("resolveSceneRoster — subject cap", () => {
	const subjects = (count: number): CastEntity[] =>
		Array.from({ length: count }, (_, i) => entity(`s${i + 1}`, "character"));

	test("drops subjects beyond the cap and reports them", () => {
		const roster = subjects(5);
		const out = resolveSceneRoster({
			roster,
			selection: sel(),
			scene: { refIds: roster.map((e) => e.id) },
			subjectCap: 3,
		});
		expect(out.ids).toEqual(["s1", "s2", "s3"]);
		expect(out.dropped.map((e) => e.id)).toEqual(["s4", "s5"]);
	});

	test("keeps the lead subject even when it sits past the cap", () => {
		const roster = [...subjects(3), entity("lead", "character", { primary: true })];
		const out = resolveSceneRoster({
			roster,
			selection: sel(),
			scene: { refIds: roster.map((e) => e.id) },
			subjectCap: 3,
		});
		expect(out.ids).toContain("lead");
		expect(out.dropped).toEqual([]);
	});

	test("non-subject references survive a full subject quota", () => {
		const roster = [...subjects(4), entity("kitchen", "location")];
		const out = resolveSceneRoster({
			roster,
			selection: sel(),
			scene: { refIds: roster.map((e) => e.id) },
			subjectCap: 3,
		});
		expect(out.ids).toEqual(["s1", "s2", "s3", "kitchen"]);
		expect(out.dropped.map((e) => e.id)).toEqual(["s4"]);
	});

	test("resolved refs and dropped refs never overlap", () => {
		const roster = subjects(5);
		const out = resolveSceneRoster({
			roster,
			selection: sel(),
			scene: { refIds: roster.map((e) => e.id) },
			subjectCap: 2,
		});
		const resolved = new Set(out.ids);
		expect(out.dropped.every((e) => !resolved.has(e.id))).toBe(true);
	});
});

describe("the reference map, built from the resolved refs", () => {
	test("map indices align with the resolved order", () => {
		const roster = [entity("man", "character"), entity("woman", "character")];
		const out = resolveSceneRoster({
			roster,
			selection: sel(),
			scene: { refIds: ["man", "woman"] },
		});
		expect(out.ids).toEqual(["man", "woman"]);
		expect(mapFor(out.refs)).toContain("Image 1 = man");
		expect(mapFor(out.refs)).toContain("Image 2 = woman");
	});

	test("two or more subjects carry anti-blend guidance", () => {
		const roster = [entity("man", "character"), entity("woman", "character")];
		const out = resolveSceneRoster({
			roster,
			selection: sel(),
			scene: { refIds: ["man", "woman"] },
		});
		expect(mapFor(out.refs)).toContain("Do not blend");
	});

	test("a single subject carries no anti-blend guidance", () => {
		const roster = [entity("man", "character"), entity("cafe", "location")];
		const out = resolveSceneRoster({
			roster,
			selection: sel(),
			scene: { refIds: ["man", "cafe"] },
		});
		expect(mapFor(out.refs)).not.toContain("Do not blend");
	});

	test("no resolved references yields an empty map", () => {
		const out = resolveSceneRoster({ roster: [], selection: sel(), scene: {} });
		expect(mapFor(out.refs)).toBe("");
	});
});

describe("resolveSceneRoster — foreign entity shapes", () => {
	interface WebRef {
		id: string;
		label: string;
		tags?: string[];
		note?: string;
		default?: boolean;
	}

	const pool: WebRef[] = [
		{ id: "anna", label: "Anna", tags: ["character"], note: "a tall woman in a grey coat" },
		{ id: "ben", label: "Ben", tags: ["character"], default: true },
		{ id: "kitchen", label: "Kitchen", tags: ["location"] },
	];

	const accessors = {
		roleOf: (r: WebRef): string => r.tags?.[0] ?? "",
		primaryOf: (r: WebRef): boolean => Boolean(r.default),
		describe: (r: WebRef): string => r.note ?? r.label,
	};

	test("resolves entities that carry their role somewhere else", () => {
		const out = resolveSceneRoster({
			roster: pool,
			selection: sel("anna"),
			scene: { refIds: ["kitchen"] },
			accessors,
		});
		expect(out.ids).toEqual(["kitchen"]);
		expect(out.refs.map((r) => r.label)).toEqual(["Kitchen"]);
	});

	test("applies the cap using the caller's role accessor", () => {
		const out = resolveSceneRoster({
			roster: pool,
			selection: sel("anna", "ben", "kitchen"),
			scene: { refIds: ["anna", "ben", "kitchen"] },
			subjectCap: 1,
			accessors,
		});
		expect(out.ids).toEqual(["anna", "ben", "kitchen"]);
		expect(out.dropped).toEqual([]);
	});
});

/* An id that is not on the roster used to vanish without a word. It is filtered by
 * `selectCast` (roster >= 2) or ignored outright (roster 1 auto-casts its single
 * entity), and `dropped` is built from entities that WERE found and then lost to
 * the cap — so a roster miss could never reach it. That silence is what let a
 * timeline template's reference list look functional for as long as it existed. */
describe("an id absent from the roster is reported", () => {
	test("a declared id not on the roster is reported as missing", () => {
		const roster = [entity("anna", "character"), entity("ben", "character")];
		const out = resolveSceneRoster({
			roster,
			selection: sel(),
			scene: { refIds: ["anna", "ghost"] },
		});

		expect(out.ids).toEqual(["anna"]);
		expect(out.missing).toEqual(["ghost"]);
	});

	test("a roster miss is distinguishable from a cap drop", () => {
		const roster = [entity("anna", "character"), entity("ben", "character")];
		const out = resolveSceneRoster({
			roster,
			selection: sel(),
			scene: { refIds: ["anna", "ben", "ghost"] },
			subjectCap: 1,
		});

		expect(out.missing).toEqual(["ghost"]);
		expect(out.dropped.map((e) => e.id)).toEqual(["ben"]);
	});

	/* Roster 1 is the dangerous case: `selectCast` auto-casts its single entity and
	 * never looks at what was declared, so the miss is invisible AND a different
	 * entity renders than the one asked for. */
	test("a miss is reported even when a one-entity roster auto-casts", () => {
		const roster = [entity("anna", "character")];
		const out = resolveSceneRoster({ roster, selection: sel(), scene: { refIds: ["ghost"] } });

		expect(out.ids).toEqual(["anna"]);
		expect(out.missing).toEqual(["ghost"]);
	});

	test("nothing is reported missing when every declared id resolves", () => {
		const roster = [entity("anna", "character"), entity("ben", "character")];
		const out = resolveSceneRoster({
			roster,
			selection: sel(),
			scene: { refIds: ["anna", "ben"] },
		});

		expect(out.missing).toEqual([]);
	});

	test("an opted-out scene does not report the project selection as missing", () => {
		const roster = [entity("anna", "character"), entity("ben", "character")];
		const out = resolveSceneRoster({
			roster,
			selection: sel("ghost"),
			scene: { refIds: ["anna"], useGlobalReferences: false },
		});

		expect(out.missing).toEqual([]);
	});
});

describe("the map binds subjects, not style plates", () => {
	/* `resolutionSet` deliberately keeps style entities in the roster — the cap
	 * never applies to a non-subject role — so a style entity DOES resolve. It must
	 * not then get an indexed subject line: a style image binds a global look, and
	 * "Image 2 = look. Use ONLY for look." instructs the model to treat it as a
	 * subject. The resolver's own map made exactly that mistake, which is why it is
	 * gone rather than consumed. */
	test("a style entity resolves but takes no indexed line", () => {
		const roster = [entity("anna", "character"), entity("look", "style")];
		const out = resolveSceneRoster({
			roster,
			selection: sel(),
			scene: { refIds: ["anna", "look"] },
		});

		expect(out.ids).toEqual(["anna", "look"]);
		expect(mapFor(out.refs)).toContain("Image 1 = anna");
		expect(mapFor(out.refs)).not.toContain("look");
	});
});
