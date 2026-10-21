/* The helper's own coverage.
 *
 * An inventory that cannot fail is worse than none: it reports green over the
 * exact change it was added for. The three cases below are the three ways a
 * bar drifts — a control appears, a control goes, a control is reworded — and
 * each is driven against a fixture built to be wrong in that one way, so a
 * future loosening of the helper fails here rather than passing everywhere.
 *
 * The added case is the one that matters most: it is what happened, and it is
 * the one a count-based or subset-based assertion forgives.
 */
import { expect, test, type Page } from "@playwright/test";
import { controlNames, expectControls, UNNAMED } from "./control-inventory.ts";

const BAR = "#bar";

async function bar(page: Page, body: string): Promise<void> {
	await page.setContent(`<!doctype html><html><body><nav id="bar">${body}</nav></body></html>`);
}

/** The shape the studios' bar has: a lead, some categories, a commit. */
const SHIPPED = `
	<button aria-label="Close without saving">x</button>
	<span>Subject</span>
	<button aria-label="Template identity">i</button>
	<button aria-label="Background music">m</button>
	<button>Save</button>
`;
const EXPECTED = ["Close without saving", "Template identity", "Background music", "Save"] as const;

test("accepts the inventory it was given", async ({ page }) => {
	await bar(page, SHIPPED);
	await expectControls(page.locator(BAR), EXPECTED, "bar");
});

test("fails when a control is added", async ({ page }) => {
	await bar(
		page,
		SHIPPED.replace(
			"<button>Save</button>",
			`<button aria-label="Visual framework">v</button><button>Save</button>`,
		),
	);
	await expect(expectControls(page.locator(BAR), EXPECTED, "bar")).rejects.toThrow(
		/unexpected \["Visual framework"\]/,
	);
});

test("fails when a control is removed", async ({ page }) => {
	await bar(page, SHIPPED.replace(`<button aria-label="Background music">m</button>`, ""));
	await expect(expectControls(page.locator(BAR), EXPECTED, "bar")).rejects.toThrow(
		/missing \["Background music"\]/,
	);
});

test("fails when a control is renamed", async ({ page }) => {
	await bar(page, SHIPPED.replace("Background music", "Music"));
	const failure = expectControls(page.locator(BAR), EXPECTED, "bar");
	await expect(failure).rejects.toThrow(/missing \["Background music"\]/);
	await expect(failure).rejects.toThrow(/unexpected \["Music"\]/);
});

/* The change this was written for, kept as a case rather than a memory.
 *
 * The markup is Template Studio's bar as it stood at 850fb2a9^ — a leading
 * control, one gear that opened the inspector, a flexible spacer, the commit.
 * Driven against that revision's running app, the assertion reported:
 *
 *   Template Studio action bar: missing ["Template identity", "Opening · section 1",
 *   "Section entries", "Scene behavior", "Background music", "Visual framework"];
 *   unexpected ["Template inspector"]
 *
 * which is the change, named. The screenshots of the same two surfaces passed.
 */
test("would have caught the redesign that passed its screenshots", async ({ page }) => {
	await bar(
		page,
		`
		<button class="cv-iconbtn" title="Close without saving" aria-label="Close without saving">x</button>
		<button class="cv-iconbtn" title="Template inspector" aria-label="Template inspector" aria-pressed="false">g</button>
		<span style="flex:1"></span>
		<button>Create template</button>
	`,
	);
	const failure = expectControls(
		page.locator(BAR),
		[
			"Close without saving",
			"Template identity",
			"Opening · section 1",
			"Section entries",
			"Scene behavior",
			"Background music",
			"Visual framework",
			"Create template",
		],
		"Template Studio action bar",
	);
	await expect(failure).rejects.toThrow(
		/missing \["Template identity","Opening · section 1","Section entries","Scene behavior","Background music","Visual framework"\]/,
	);
	await expect(failure).rejects.toThrow(/unexpected \["Template inspector"\]/);
});

/* Order is part of the contract: an exit that migrated to the far end is a
   different bar, and every count- or set-based assertion passes it. */
test("fails when the same controls are reordered", async ({ page }) => {
	await bar(
		page,
		`<button>Save</button><button aria-label="Close without saving">x</button><button aria-label="Template identity">i</button><button aria-label="Background music">m</button>`,
	);
	await expect(expectControls(page.locator(BAR), EXPECTED, "bar")).rejects.toThrow(
		/same controls, different order/,
	);
});

/* `aria-label` over content over `title`, which is the browser's order and the
   one these bars rely on — the icon controls carry a label AND a title, and the
   two are allowed to differ. */
test("names a control the way the accessibility tree does", async ({ page }) => {
	await bar(
		page,
		`
		<button aria-label="Close — deselect clip" title="Close">x</button>
		<button title="Zoom out (-)">-</button>
		<button>Save</button>
		<span id="zoomlabel">Timeline zoom</span><input type="range" aria-labelledby="zoomlabel" />
	`,
	);
	expect(await controlNames(page.locator(BAR))).toEqual([
		"Close — deselect clip",
		"-",
		"Save",
		"Timeline zoom",
	]);
});

/* A control with no name at all is reported rather than skipped: it is a real
   accessibility defect, and an inventory that dropped it would go green while
   the bar announced nothing. */
test("reports a control that has no accessible name", async ({ page }) => {
	await bar(page, `<button><svg></svg></button>`);
	expect(await controlNames(page.locator(BAR))).toEqual([UNNAMED]);
});

/* A closed sheet's actions live in the bar's own subtree. They are not on the
   bar, and an inventory that counted them would change with the sheet. */
test("omits hidden controls and aria-hidden ones", async ({ page }) => {
	await bar(
		page,
		`
		<button aria-label="Clip actions">…</button>
		<div style="display:none"><button>Split at playhead</button></div>
		<div style="visibility:hidden"><button>Duplicate</button></div>
		<div aria-hidden="true"><button>Delete</button></div>
	`,
	);
	expect(await controlNames(page.locator(BAR))).toEqual(["Clip actions"]);
});
