/* No retired spelling still renders, and none still has a rule.
 *
 * Task 3.4 says "migrate deprecated primitive uses; keep no compatibility class
 * aliases", and a migration that is only checked once is a migration that comes
 * back: the next caller to copy a nearby line reintroduces `cv-field`, and
 * nothing fails.
 *
 * The retired list is not written here. It is derived from the disposition data
 * — every `merged` or `replaced` candidate's class — so a future merge is
 * covered by this test the moment it is recorded, with nothing to remember.
 *
 * COMMENTS ARE EXEMPT, deliberately. Half the value of this convergence is in
 * the stylesheet comments explaining what a class used to be and why it went;
 * stripping that history to satisfy a grep would trade the explanation for the
 * check. So comments are removed before the scan and only live code is read.
 */
import { describe, expect, test } from "vite-plus/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { CANDIDATES } from "../../../../../scripts/ui-dispositions.ts";

const SRC = join(import.meta.dirname, "../..");

const retired = CANDIDATES.filter(
	(candidate) => candidate.status === "merged" || candidate.status === "replaced",
).map((candidate) => candidate.cls);

function sourceFiles(root: string): string[] {
	return readdirSync(root).flatMap((name) => {
		const path = join(root, name);
		if (statSync(path).isDirectory()) return sourceFiles(path);
		return /\.(tsx?|css)$/.test(path) && !path.endsWith(".test.ts") && !path.endsWith(".test.tsx")
			? [path]
			: [];
	});
}

/** Block and line comments out, string and rule bodies in. */
function code(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("retired class spellings", () => {
	test("the disposition data still names some", () => {
		/* If this ever empties, the test below is asserting nothing and should be
		 * deleted rather than left passing vacuously. */
		expect(retired.length).toBeGreaterThan(0);
	});

	for (const cls of retired) {
		test(`\`${cls}\` is gone from every caller and stylesheet`, () => {
			/* A word boundary on both sides, so `cv-field` does not match
			 * `cv-field-head` — the head is a live part of the editor's field
			 * anatomy and was never the retired class. */
			const pattern = new RegExp(`(^|[^\\w-])${cls}([^\\w-]|$)`);
			const offenders = sourceFiles(SRC)
				.filter((path) => pattern.test(code(readFileSync(path, "utf8"))))
				.map((path) => relative(SRC, path));
			expect(offenders).toEqual([]);
		});
	}
});
