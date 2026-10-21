/* The pattern catalogue in docs/design-system/patterns.md is what an agent
 * reads to decide whether to import a pattern or compose one by hand. A row
 * that claims an export which is gone, or omits one that exists, sends it the
 * wrong way — so the table is checked against the code. */
import { describe, expect, test } from "vite-plus/test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dirname, "../../../../..");
const DOCS = join(REPO, "docs/design-system");
const ROW =
	// Cells are column-aligned by the formatter, so padding before `|` varies.
	/^\| \[(\w+)\]\((patterns\/[\w-]+\.md)\) +\| (Approved|Candidate|Feature-owned) +\| (?:`@design-system\/patterns\/([\w-]+\.tsx)`|—) +\| (?:`(stories\/[\w/.-]+)`|—) +\|/gm;
const rows = [...readFileSync(join(DOCS, "patterns.md"), "utf8").matchAll(ROW)].map(
	([, name, spec, status, module, story]) => ({ name, spec, status, module, story }),
);
const SECTIONS = [
	"Purpose",
	"Use when",
	"Structure",
	"Allowed controls and composition",
	"Variants, density and responsive behavior",
	"Accessibility and states",
	"Current usages and ownership",
	"Acceptance evidence",
];

const exported = new Map<string, string>();
for (const file of readdirSync(import.meta.dirname).filter(
	(f) => f.endsWith(".tsx") && !f.includes(".test."),
)) {
	for (const [, name] of readFileSync(join(import.meta.dirname, file), "utf8").matchAll(
		/export function ([A-Z]\w+)/g,
	))
		exported.set(name, file);
}

describe("pattern catalogue", () => {
	test("lists the 24 named patterns, each with a complete spec", () => {
		expect(rows).toHaveLength(24);
		for (const row of rows) {
			const spec = readFileSync(join(DOCS, row.spec), "utf8");
			for (const section of SECTIONS)
				expect(spec, `${row.name}: ${section}`).toContain(`## ${section}`);
		}
	});

	test("an approved pattern is exported from its module, has a story and records its implementation", () => {
		for (const row of rows.filter((r) => r.status === "Approved")) {
			expect(exported.get(row.name), row.name).toBe(row.module);
			expect(existsSync(join(REPO, "apps/web", row.story ?? "")), `${row.name} story`).toBe(true);
			expect(readFileSync(join(DOCS, row.spec), "utf8"), row.name).toContain("## Implementation");
		}
	});

	test("a candidate or feature-owned pattern has no export, so nothing imports what was never built", () => {
		for (const row of rows.filter((r) => r.status !== "Approved"))
			expect(exported.has(row.name), row.name).toBe(false);
	});

	test("every pattern component in the code is in the catalogue", () => {
		const listed = new Set(rows.map((r) => r.name));
		// FieldRow and AmountField are PropertyRow's multi-value variant, documented in its spec.
		const variants = new Set([
			"FieldRow",
			"AmountField",
			"TopbarLeading",
			"TopbarStatus",
			"TopbarActions",
		]);
		const unlisted = [...exported.keys()].filter(
			(name) => !listed.has(name) && !variants.has(name),
		);
		expect(unlisted).toEqual([]);
	});
});
