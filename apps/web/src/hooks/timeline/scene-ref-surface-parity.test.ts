/* Every surface that consumes a resolved scene cast has to account for all THREE
 * sets it returns, not just the one that renders.
 *
 * This exists because the same bug shipped twice, one level apart. First
 * `resolveSceneRoster` reported only cap drops, so an id absent from the project's
 * roster resolved to nothing and no surface could say so. Then, with the resolver
 * fixed, `edit-item-modal.tsx` still read `.refs` alone — so the surface a
 * double-click actually opens showed neither the cap warning nor the unattached
 * warning, while the rarely-opened drawer showed both.
 *
 * `roster-parity.test.ts` cannot catch that: it asserts the resolver returns the
 * right sets, which it did. What went wrong was downstream of the assertion, in
 * which sets a component chose to render. A type cannot catch it either — reading
 * three fields off an object is legal whether or not you read the other two.
 *
 * Reading the source can, so this test does. A new consumer of `resolveSceneRefs`
 * fails here until it either renders the shared body or is listed below with a
 * reason, which forces the choice to be deliberate rather than accidental.
 */
import { describe, expect, test } from "vite-plus/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dirname, "..", "..");

/** The shared body every visible surface renders. */
const SHARED_BODY = "SceneReferenceChips";

/** Files that legitimately consume the resolver WITHOUT rendering the shared body.
 *  Each needs a reason, because the default is that a surface reports everything. */
const EXEMPT = new Map<string, string>([
	[
		"hooks/timeline/use-scene-refs.ts",
		"Defines the resolver and exposes the three sets to callers; it renders nothing.",
	],
	[
		"components/editor/studio.tsx",
		"Card surface: shows a resolved COUNT, not a reference list. The count is " +
			"deliberately the capped set so it matches the render. Whether a card should " +
			"also flag unattached ids is an open design question, not an oversight.",
	],
]);

function sourceFiles(dir: string, found: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			sourceFiles(full, found);
			continue;
		}
		if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(full);
	}
	return found;
}

const consumers = sourceFiles(SRC)
	.map((full) => ({ rel: full.slice(SRC.length + 1), source: readFileSync(full, "utf8") }))
	.filter(({ source }) => source.includes("resolveSceneRefs("));

describe("every scene-reference surface accounts for all three resolved sets", () => {
	test("the scan finds the consumers it is meant to guard", () => {
		// A silent zero would make every assertion below vacuous.
		expect(consumers.length).toBeGreaterThan(2);
		const rels = consumers.map((c) => c.rel);
		expect(rels).toContain("components/timeline/edit-item-modal.tsx");
		expect(rels).toContain("components/timeline/scene-editor-drawer.tsx");
	});

	test("each consumer renders the shared body or is exempt with a reason", () => {
		const unaccounted = consumers
			.filter(({ rel, source }) => !source.includes(SHARED_BODY) && !EXEMPT.has(rel))
			.map(({ rel }) => rel);

		expect(unaccounted).toEqual([]);
	});

	test("no exemption is stale", () => {
		const scanned = new Set(consumers.map((c) => c.rel));
		const gone = [...EXEMPT.keys()].filter((rel) => !scanned.has(rel));

		expect(gone).toEqual([]);
	});

	test("every exemption states why", () => {
		for (const [rel, reason] of EXEMPT) {
			expect(reason.trim().length, `${rel} needs a reason`).toBeGreaterThan(20);
		}
	});

	/* The two visible surfaces differ in header markup on purpose — class, icon size,
	 * and whether they carry a hint. What must not differ again is which sets they
	 * render, which is why neither may hand-roll the chip list. */
	test("neither visible surface hand-rolls the chip list", () => {
		for (const rel of [
			"components/timeline/edit-item-modal.tsx",
			"components/timeline/scene-editor-drawer.tsx",
		]) {
			const source = consumers.find((c) => c.rel === rel)!.source;
			expect(source).toContain(SHARED_BODY);
			expect(source).not.toContain("tl2-ref-chip");
		}
	});
});
