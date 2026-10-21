/* The settings breakpoint is written in two places and they must agree.
 *
 * CSS collapses the columns; the hook decides whether to select an item. If they
 * diverge, a narrow viewport that thinks it is wide selects an item, the
 * selection hides the list behind it, and the control that would return to that
 * list belongs to a column the layout has hidden — an operator with no way back.
 *
 * That failure is invisible to typecheck, to every unit test, and to a desktop
 * browser. It shows up only on a phone, which is why it is asserted here.
 */
import { describe, expect, it } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SETTINGS_COLUMNS_MIN_WIDTH } from "./use-settings-columns.ts";

const CSS = readFileSync(
	join(import.meta.dirname, "..", "..", "components", "settings", "settings.css"),
	"utf8",
);

describe("settings breakpoint", () => {
	it("is the min-width the columns lay out at", () => {
		expect(CSS).toContain(`@media (min-width: ${SETTINGS_COLUMNS_MIN_WIDTH}px)`);
	});

	// The narrow rules must stop exactly where the wide rules start: a gap leaves
	// a width with no layout, an overlap leaves one with two.
	it("is one less than the max-width the narrow rules use", () => {
		expect(CSS).toContain(`@media (max-width: ${SETTINGS_COLUMNS_MIN_WIDTH - 1}px)`);
	});

	/* Scoped to blocks that lay the COLUMNS out. The sheet carries an unrelated
	   760px rule for the credits card, and a check that flagged it would be a
	   check people learn to ignore. */
	it("lays the columns out at no other width", () => {
		// A block ends at the brace indented like its own `@media` line.
		const blocks = [
			...CSS.matchAll(/^([ \t]*)@media \((?:min|max)-width: (\d+)px\)\s*\{([\s\S]*?)\n\1\}/gm),
		];
		const columnWidths = blocks
			.filter(([, , , body]) => /\.settings-cols?[\s[.{-]/.test(body ?? ""))
			.map(([, , width]) => Number(width));
		const allowed = new Set([SETTINGS_COLUMNS_MIN_WIDTH, SETTINGS_COLUMNS_MIN_WIDTH - 1]);
		expect(columnWidths.filter((w) => !allowed.has(w))).toEqual([]);
		// And it really did find them, rather than matching nothing.
		expect(columnWidths.length).toBeGreaterThan(0);
	});
});
