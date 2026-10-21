/* The published surface budget (docs/editor-surface-budget.md) is real,
 * classified, and consistent with what runs.
 *
 * A published budget that nothing checks is a number that was true once. This
 * does not re-measure — measurement belongs to the machine it names — but it
 * holds the document to three things a document can be wrong about: that every
 * entry is classified, that the hardware and item count are stated, and that
 * the ceilings it publishes are the ceilings the benchmark actually enforces.
 *
 * The last one is the point. A ceiling documented as 2 ms and enforced at 20 ms
 * is worse than no ceiling, because a reader believes it.
 */
import { expect, test } from "vite-plus/test";
import { readFile } from "node:fs/promises";

const budget = await readFile(
	new URL("../../../../../docs/editor-surface-budget.md", import.meta.url),
	"utf8",
);
const bench = await readFile(new URL("./surface-budget.bench.ts", import.meta.url), "utf8");

test("the budget names its hardware, its item count, and its method", () => {
	expect(budget).toContain("Apple M1 Pro");
	expect(budget).toContain("macOS 26.5.2");
	expect(budget).toContain("Bun 1.3.1");
	expect(budget).toMatch(/\*\*2000 items\*\*/);
	expect(budget).toMatch(/viewport \*\*1440 px\*\*/);
	/* The median, stated, because "the median of 200 runs" and "one run" are
	 * different claims and only one of them is reproducible. */
	expect(budget).toMatch(/median\*\* of 200 runs/);
});

test("every published entry carries a classification", () => {
	const rows = [...budget.matchAll(/^\| (?!Entry|---)([^|]+)\|([^|]+)\|/gm)];
	expect(rows.length).toBeGreaterThanOrEqual(6);
	for (const row of rows) {
		expect(row[2]!.trim(), `"${row[1]!.trim()}" has no classification`).toMatch(
			/^\*\*(?:invariant|bound|reported)\*\*$/,
		);
	}
});

test("published ceilings are the ceilings the benchmark enforces", () => {
	const documented = [...budget.matchAll(/ceiling `(\d+) ms`/g)].map((match) => Number(match[1]));
	/* Scoped to the TIMING ceilings — a name ending in `Ms` — because the
	 * benchmark also compares counts, and an invariant on a visible-item count is
	 * not a ceiling anybody publishes. */
	const enforced = [...bench.matchAll(/\b\w+Ms > (\d+)\) fail\(/g)].map((match) =>
		Number(match[1]),
	);
	expect(documented.length).toBeGreaterThan(0);
	expect(documented.sort((a, b) => a - b)).toEqual(enforced.sort((a, b) => a - b));
});

test("no reported entry is asserted anywhere", () => {
	/* `reported` is recorded and never enforced. If the benchmark grows a
	 * threshold on the index build, this fails — which is the guard, because the
	 * failure mode is silent: a reported number quietly becomes a flaky gate. */
	const reported = [...budget.matchAll(/^\| ([^|]+)\| \*\*reported\*\*/gm)].map((match) =>
		match[1]!.trim(),
	);
	expect(reported).toEqual(["Building the geometry index from scratch"]);
	expect(bench).toMatch(/const indexMs = medianMs/);
	expect(bench).not.toMatch(/if \(indexMs [<>]/);
});
