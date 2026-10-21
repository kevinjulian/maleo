import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, describe, expect, test } from "vite-plus/test";
import { CANDIDATES, DISPOSITIONS } from "./ui-dispositions";

const REPO = resolve(import.meta.dirname, "..");
const SCRIPT = resolve(REPO, "scripts/publish-ui.ts");
/* Generation runs the census, which walks every stylesheet and module in the web
 * client. That is the point — publication must not hold its own copy of that
 * evidence — but it means these are not millisecond tests. */
const SLOW = 180_000;

const scratch = mkdtempSync(resolve(tmpdir(), "publish-ui-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function run(mode: string, out: string) {
	const r = spawnSync("bun", [SCRIPT, "--mode", mode, "--out", out], {
		cwd: REPO,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
	return { ...r, dir: resolve(REPO, out) };
}

function manifest(dir: string) {
	return JSON.parse(readFileSync(resolve(dir, "index.json"), "utf8"));
}

describe("inventory publication", () => {
	const out = resolve(scratch, "inv");
	const r = run("inventory", out);

	test("generates", () => {
		expect(r.status).toBe(0);
	});

	test("renders exactly the candidates the repository declares", () => {
		// The count equality is the assertion that publication drops nothing. A
		// candidate that exists in the data but never reaches a board is invisible
		// to the review this whole file exists to enable.
		const m = manifest(out);
		expect(m.entryCount).toBe(CANDIDATES.length);
		const rendered = m.groups.flatMap((g: { entries: Array<{ id: string }> }) =>
			g.entries.map((e) => e.id),
		);
		expect(rendered.sort()).toEqual(CANDIDATES.map((c) => c.id).sort());
	});

	test("keeps competing implementations on one board", () => {
		const m = manifest(out);
		const field = m.groups.find((g: { group: string }) => g.group === "Field");
		expect(field.entries).toHaveLength(4);
		expect(existsSync(resolve(out, field.board))).toBe(true);
	});

	test("gives every entry its provenance, usage and commit", () => {
		const m = manifest(out);
		expect(["clean", "modified"]).toContain(m.sourceTreeState);
		const seen = new Set<string>();
		for (const g of m.groups) {
			for (const e of g.entries) {
				/* This asserted `"candidate"` while the inventory was the only
				 * published artifact. Convergence has since decided every entry, so
				 * what the inventory has to show is a real disposition — the
				 * inventory's job is to carry all of them, including the ones the
				 * approved kit will not contain. */
				expect(DISPOSITIONS).toContain(e.status);
				seen.add(e.status);
				expect(e.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
				/* A class-backed entry names the stylesheet that defines it; the
				 * component-backed one names a component instead, which is the case
				 * for a surface built entirely from inline style objects.
				 *
				 * Except once a class has been retired. `merged` and `replaced` mean
				 * the class is gone, so no sheet defines it any more — the entry keeps
				 * the historical name so the inventory records what was withdrawn, and
				 * `becomes` is what carries the reader to the live one. */
				const retired = e.status === "merged" || e.status === "replaced";
				expect(e.cls === null || retired || e.sheets.length > 0).toBe(true);
				expect(e.cls === null ? e.component !== null : true).toBe(true);
				if (retired) expect(e.becomes ?? null).not.toBe(null);
			}
		}
		// The inventory is the place every disposition is visible. If it only ever
		// showed one, it would have stopped being a record of the decisions.
		expect(seen.size).toBeGreaterThan(1);
	});

	test("publishes the app's theming system as its own foundations board", () => {
		// One board per theming system. The app's is the only one since VUI's
		// opt-in theme retired with the package.
		expect(existsSync(resolve(out, "foundations-app.svg"))).toBe(true);
		expect(existsSync(resolve(out, "foundations-vui.svg"))).toBe(false);
	});

	test(
		"is reproducible at the same commit",
		() => {
			const again = resolve(scratch, "inv-again");
			expect(run("inventory", again).status).toBe(0);
			const names = readdirSync(out).sort();
			expect(readdirSync(again).sort()).toEqual(names);
			for (const n of names) {
				expect(readFileSync(resolve(again, n), "utf8")).toBe(readFileSync(resolve(out, n), "utf8"));
			}
		},
		SLOW,
	);
});

describe("approved kit publication", () => {
	/* This asserted an empty kit, because presence in the inventory is not
	 * approval and nothing had been through convergence yet. Section 2 of
	 * `converge-web-design-system` decided every entry, so the kit is no longer
	 * empty — and the property worth guarding flips from "contains nothing" to
	 * "contains the approved set and nothing else". */
	test(
		"contains the approved entries, and only those",
		() => {
			const out = resolve(scratch, "kit");
			expect(run("kit", out).status).toBe(0);
			const m = manifest(out);
			expect(m.file).toBe("Maleo UI Kit");

			const approved = CANDIDATES.filter((c) => c.status === "approved")
				.map((c) => c.id)
				.sort();
			expect(approved.length).toBeGreaterThan(0);

			const inKit = m.groups
				.flatMap((g: { entries: { id: string }[] }) => g.entries.map((e) => e.id))
				.sort();
			expect(inKit).toEqual(approved);
			expect(m.entryCount).toBe(approved.length);

			// The kit is the artifact a designer instantiates from, so a merged,
			// replaced, retained-local or deprecated entry reaching it would be an
			// endorsement the repository never gave.
			const notApproved = new Set(
				CANDIDATES.filter((c) => c.status !== "approved").map((c) => c.id),
			);
			for (const id of inKit) expect(notApproved.has(id)).toBe(false);
		},
		SLOW,
	);
});

describe("generation inputs", () => {
	test("reads tokens, census and dispositions, and no component source", () => {
		// The constraint that keeps this from becoming a second scanner. A second
		// scanner drifts from the census while both stay internally consistent,
		// which is how the palette came to be declared twice.
		const src = readFileSync(SCRIPT, "utf8");
		expect(src).toContain("census.ts");
		expect(src).toContain("ui-dispositions");
		expect(src).toContain("tokens.css");
		// No walk of components/, and no direct read of a component module.
		expect(src).not.toContain("readdirSync");
		expect(src).not.toMatch(/components\/[a-z-]+\/[a-z-]+\.(tsx|css)/);
	});

	test("fails when a disposition names a class no stylesheet defines", () => {
		// Proves the guard is reachable rather than merely written: the generator
		// refuses to publish an entry for something that no longer renders.
		const r = spawnSync(
			"bun",
			[
				"-e",
				`import{validate}from"${resolve(REPO, "scripts/ui-dispositions.ts")}";const p=validate([{id:"gone",group:"Field",status:"candidate",cls:"gone"}],new Set());if(p.length===0)process.exit(1);console.log(p[0]);`,
			],
			{ cwd: REPO, encoding: "utf8" },
		);
		expect(r.status).toBe(0);
		expect(r.stdout).toContain("not defined in any stylesheet");
	});
});
