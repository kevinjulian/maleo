import { describe, expect, test } from "vite-plus/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CANDIDATES, DISPOSITIONS, type Candidate, relatedTo, validate } from "./ui-dispositions";

/** A class set that accepts anything, for the cases not about census membership. */
const anyClass = { has: () => true } as unknown as ReadonlySet<string>;

const fixture = (over: Partial<Candidate> & Pick<Candidate, "id">): Candidate => ({
	group: "Field",
	status: "candidate",
	cls: over.id,
	...over,
});

describe("disposition schema", () => {
	test("has exactly the six states, and starts at candidate", () => {
		expect([...DISPOSITIONS]).toEqual([
			"candidate",
			"approved",
			"retained-local",
			"merged",
			"replaced",
			"deprecated",
		]);
		expect(DISPOSITIONS[0]).toBe("candidate");
	});
});

describe("validate", () => {
	test("accepts a plain candidate", () => {
		expect(validate([fixture({ id: "cv-field" })], anyClass)).toEqual([]);
	});

	test("rejects a class no stylesheet defines", () => {
		// The candidate was renamed or deleted and the entry outlived it. Publishing
		// it would put something in the inventory that no longer renders.
		const problems = validate([fixture({ id: "cv-field" })], new Set(["tl2-field"]));
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain("not defined in any stylesheet");
	});

	test("rejects the same candidate listed twice", () => {
		const problems = validate([fixture({ id: "pill" }), fixture({ id: "pill" })], anyClass);
		expect(problems.some((p) => p.includes("listed twice"))).toBe(true);
	});

	test("rejects an entry naming neither a class nor a component", () => {
		const problems = validate([{ id: "ghost", group: "Chip", status: "candidate" }], anyClass);
		expect(problems.some((p) => p.includes("neither a class nor a component"))).toBe(true);
	});

	test("accepts a component-only entry, for a surface with no class", () => {
		// Lightbox is built entirely from inline style objects and has no class at
		// all, which is exactly why it needs to appear in the inventory.
		const entry: Candidate = {
			id: "design-system/components/lightbox.tsx",
			group: "Overlay",
			status: "candidate",
			component: "apps/web/src/design-system/components/lightbox.tsx",
		};
		expect(validate([entry], new Set())).toEqual([]);
	});

	test("requires merged and replaced to say what they become", () => {
		for (const status of ["merged", "replaced"] as const) {
			const problems = validate([fixture({ id: "tl2-field", status })], anyClass);
			expect(problems.some((p) => p.includes("does not say what it becomes"))).toBe(true);
		}
	});

	test("requires retained-local and deprecated to say why", () => {
		for (const status of ["retained-local", "deprecated"] as const) {
			const problems = validate([fixture({ id: "sc-flag", status })], anyClass);
			expect(problems.some((p) => p.includes("does not say why"))).toBe(true);
		}
	});

	test("rejects a destination on a status that is not going anywhere", () => {
		const problems = validate([fixture({ id: "cv-field", becomes: "tl2-field" })], anyClass);
		expect(problems.some((p) => p.includes("cannot become"))).toBe(true);
	});

	test("rejects a destination that is not a candidate", () => {
		const problems = validate(
			[fixture({ id: "cv-field", status: "merged", becomes: "Field" })],
			anyClass,
		);
		expect(problems.some((p) => p.includes("not a candidate"))).toBe(true);
	});

	test("rejects a chain, because the recorded destination renders nothing", () => {
		// A merges into B, but B was itself replaced by C. A's destination is a
		// dead end and the reader has to walk the graph to discover it.
		const problems = validate(
			[
				fixture({ id: "a", status: "merged", becomes: "b" }),
				fixture({ id: "b", status: "replaced", becomes: "c" }),
				fixture({ id: "c" }),
			],
			anyClass,
		);
		expect(problems.some((p) => p.includes("point it at the surviving entry"))).toBe(true);
	});

	test("accepts a resolved redirect", () => {
		const problems = validate(
			[fixture({ id: "a", status: "merged", becomes: "b" }), fixture({ id: "b" })],
			anyClass,
		);
		expect(problems).toEqual([]);
	});

	test("rejects an entry that becomes itself", () => {
		const problems = validate([fixture({ id: "a", status: "merged", becomes: "a" })], anyClass);
		expect(problems.some((p) => p.includes("becomes itself"))).toBe(true);
	});
});

describe("the committed candidate data", () => {
	test("is structurally coherent", () => {
		// Census membership is checked by the generator against a real scan; here
		// the concern is that the data is internally consistent.
		expect(validate(CANDIDATES, anyClass)).toEqual([]);
	});

	test("carries the groups the inventory is inspected through", () => {
		const groups = new Set(CANDIDATES.map((c) => c.group));
		for (const g of ["Button", "Field", "Note", "Chip", "Overlay"]) expect(groups).toContain(g);
	});

	test("approves new Base UI treatment with surface proof", () => {
		expect(
			CANDIDATES.find((c) => c.id === "design-system/components/button.tsx#primary")?.status,
		).toBe("approved");
	});

	/* Approval is the one status that claims quality rather than location, so it
	 * is the one that has to cite what was driven. `provenBy` names spec files;
	 * this checks they EXIST, because a proof reference that has been renamed
	 * away is worse than none — it reads as evidence and tests nothing. */
	test("every approved entry cites surfaces that exist", () => {
		const repo = join(import.meta.dirname, "..");
		const missing: string[] = [];
		for (const c of CANDIDATES) {
			if (c.status !== "approved") continue;
			expect(c.provenBy?.length, `${c.id} is approved with no surface proof`).toBeGreaterThan(0);
			for (const file of c.provenBy ?? []) {
				if (!existsSync(join(repo, file))) missing.push(`${c.id} → ${file}`);
			}
		}
		expect(missing).toEqual([]);
	});

	/* A merge or a replacement that points at something not approved would move
	 * its call sites onto another dead end. `validate` already refuses a chain;
	 * this refuses a destination that survived but was never approved. */
	test("sends every merged and replaced entry somewhere approved", () => {
		const byId = new Map(CANDIDATES.map((c) => [c.id, c]));
		for (const c of CANDIDATES) {
			if (!c.becomes) continue;
			expect(byId.get(c.becomes)?.status, `${c.id} becomes ${c.becomes}`).toBe("approved");
		}
	});

	test("relates the spellings of one concept to each other", () => {
		const field = CANDIDATES.find((c) => c.id === "cv-field")!;
		expect(
			relatedTo(field, CANDIDATES)
				.map((c) => c.id)
				.sort(),
		).toEqual(["fc-cap-field", "settings-field", "tl2-field"]);
	});
});
