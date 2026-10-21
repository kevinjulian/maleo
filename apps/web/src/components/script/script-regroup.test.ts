/* The repair action, and the two promises it has to keep.
 *
 * A project generated before its scenes recorded their section collapsed into
 * one chapter and froze there: seeding refuses to touch a document that already
 * carries chapters, deliberately, so an operator who deleted them all does not
 * have them grow back. Regrouping is the way out — and because it is a write
 * that discards authored titles, it owes the operator a confirmation first.
 *
 * The decision itself is covered behaviourally in
 * `packages/shared/src/timeline-chapters.test.ts`. What is asserted here is the
 * wiring, which this harness cannot drive: it has no DOM or event layer, so the
 * source is the evidence.
 */
import { describe, expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";

const view = readFileSync(new URL("./script-view.tsx", import.meta.url), "utf8");

describe("regrouping is offered, not imposed", () => {
	test("the action renders only when regrouping would change the grouping", () => {
		// A control that promises a change it cannot make is worse than no control.
		expect(view).toContain("const canRegroup = canRegroupChapters(scenes, chapters);");
		expect(view).toMatch(/\{canRegroup && \(?\s*</);
	});

	test("it confirms BEFORE it writes", () => {
		const confirmAt = view.search(/if \(\s*!window\.confirm\(\s*`Regroup into/);
		const writeAt = view.indexOf("store.setDoc((doc) => ({ ...doc, chapters:");
		// Both halves of the write land after the confirmation, not just the chapters.
		expect(view.indexOf("setScenes((ss) => {")).toBeGreaterThan(confirmAt);
		expect(confirmAt).toBeGreaterThan(-1);
		expect(writeAt).toBeGreaterThan(confirmAt);
		// The early return is what makes declining leave the document alone.
		expect(view).toMatch(/if \(\s*!window\.confirm\(\s*`Regroup into[^`]*`,?\s*\)\s*\)\s*return;/);
	});

	test("the confirmation names the authored titles it will destroy", () => {
		// "Are you sure?" is not consent when the operator cannot see the cost.
		expect(view).toContain(".filter((c) => c.title || c.brief)");
		expect(view).toMatch(/Titles and briefs written there are lost/);
	});

	test("it writes the membership down, not just the chapters", () => {
		// Chapters alone would leave the scenes still saying nothing, so the next
		// derivation collapses them again and the repair lasts one render.
		expect(view).toContain("sectionId: next.sectionId");
	});

	test("it reuses the one derivation rather than growing a second", () => {
		expect(view).toContain("const regrouped = regroupChapters(scenes);");
		// Two derivations that can disagree is how the surface and the document
		// come to show different chapters for the same scenes.
		expect(view).not.toMatch(/seedChapters\(/);
	});

	test("nothing regroups on load", () => {
		// The read path stays a read. Repair is something the operator asks for.
		expect(view).toMatch(/const onRegroup = useCallback\(/);
		expect(view).not.toMatch(/useEffect\([^)]*regroup/i);
	});
});

describe("a chapter field shows what the document holds", () => {
	/* Found by regrouping in a browser: the document was rewritten correctly — 22
	 * chapters, the frozen title gone — and the page still showed the old title.
	 * The chapter fields are UNCONTROLLED, committed on blur so the document is
	 * not rewritten per keystroke, and React never updates `defaultValue` on
	 * re-render. Keying them on the value makes a document-side change remount the
	 * field instead of leaving it disagreeing with what it renders. */
	const table = readFileSync(new URL("./script-table.tsx", import.meta.url), "utf8");

	test("the title field is keyed on the title it defaults to", () => {
		expect(table).toContain("key={`title:${group.chapter.title}`}");
	});

	test("the brief field is keyed on the brief it defaults to", () => {
		expect(table).toContain('key={`brief:${group.chapter.brief ?? ""}`}');
	});

	test("both are still committed on blur rather than per keystroke", () => {
		// The key is what makes uncontrolled safe here; it does not make the fields
		// controlled, and turning them controlled would reflow the timeline while
		// the operator is still typing.
		expect(table).toMatch(/aria-label=\{`Title of chapter \$\{index \+ 1\}`\}[\s\S]{0,200}onBlur=/);
		expect(table).not.toMatch(/aria-label=\{`Title of chapter[\s\S]{0,200}onChange=/);
	});
});
