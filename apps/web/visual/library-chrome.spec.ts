/* What the shared library chrome must do, driven rather than photographed.
 *
 * A screenshot says two renders differ; it cannot say that a scope is
 * unreachable, that a surface grew a second search box, or that the page scrolls
 * sideways. Those are the three things this chrome exists to fix, and none of
 * them had an assertion — which is how a scope strip that clipped half its
 * scopes at 320px, and a materials page 180px wider than the viewport, stayed
 * green for weeks.
 */
import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { replayApi } from "./har.ts";
import { FIXTURE_PROJECT_ID } from "./screens.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");

/** Every library menu, by the route an operator lands on. */
const LIBRARY_ROUTES = [
	"/library/presets",
	"/library/materials",
	"/library/templates",
	"/library/elements",
	"/library/references",
	"/library/voices",
] as const;

/** Every library menu offers search. */
const SEARCHABLE = LIBRARY_ROUTES;

const PHONE = { width: 320, height: 900 };
const DESKTOP = { width: 1440, height: 900 };

test.beforeEach(async ({ context }) => {
	await replayApi(context, HAR);
});

async function open(page: import("@playwright/test").Page, route: string): Promise<void> {
	await page.goto(route);
	await page.locator("main").first().waitFor({ state: "visible" });
	await page.evaluate(() => document.fonts.ready);
}

/** Wait out whatever is animating on an element before measuring it. Geometry
 *  read mid-transition is geometry from part-way through, which is how an
 *  assertion against a viewport edge misses by two pixels. */
async function settled(locator: import("@playwright/test").Locator): Promise<void> {
	await locator.waitFor({ state: "visible" });
	await locator.evaluate((element) =>
		Promise.all(element.getAnimations().map((animation) => animation.finished)),
	);
}

test.describe("one search box per surface", () => {
	for (const route of SEARCHABLE) {
		test(`library chrome: ${route} has exactly one search field`, async ({ page }) => {
			await page.setViewportSize(DESKTOP);
			await open(page, route);
			// Every text-entry control on the page, not just the toolbar's — a second
			// one arriving from an embedded browser is the case this catches.
			const inputs = page.locator(
				'input[type="search"], input[type="text"]:not([role="spinbutton"])',
			);
			await expect(inputs).toHaveCount(1);
		});
	}
});

test.describe("page identity without duplicated navigation", () => {
	for (const route of LIBRARY_ROUTES) {
		test(`library chrome: ${route} renders no page-local scope strip`, async ({ page }) => {
			await page.setViewportSize(DESKTOP);
			await open(page, route);
			await expect(page.locator(".pg-title")).toBeVisible();
			await expect(page.locator(".catalog-scope-tabs")).toHaveCount(0);
		});
	}
});

test.describe("phone widths", () => {
	for (const route of LIBRARY_ROUTES) {
		test(`library chrome: ${route} does not scroll sideways at 320`, async ({ page }) => {
			await page.setViewportSize(PHONE);
			await open(page, route);
			const probe = await page.evaluate(() => ({
				scrollWidth: document.documentElement.scrollWidth,
				innerWidth: window.innerWidth,
			}));
			expect(probe.scrollWidth).toBeLessThanOrEqual(probe.innerWidth);
		});

		test(`library chrome: ${route} keeps page-local route nav removed at 320`, async ({ page }) => {
			await page.setViewportSize(PHONE);
			await open(page, route);
			await expect(page.locator(".catalog-scope-tabs")).toHaveCount(0);
		});
	}

	for (const route of SEARCHABLE) {
		test(`library chrome: ${route} keeps search and every group chip operable at 320`, async ({
			page,
		}) => {
			await page.setViewportSize(PHONE);
			await open(page, route);
			const search = page.locator(".catalog-search input");
			await expect(search).toBeVisible();

			const chips = page.locator(".catalog-groups button");
			for (let i = 0; i < (await chips.count()); i += 1) {
				await expect(chips.nth(i)).toBeVisible();
			}
			const groupsOverflow = await page.evaluate(() => {
				const row = document.querySelector(".catalog-groups");
				return row ? row.scrollWidth > row.clientWidth + 1 : false;
			});
			expect(groupsOverflow).toBe(false);
		});
	}
});

test("failed reference upload shows error and retry saves only returned media URL", async ({
	page,
}) => {
	await page.setViewportSize(DESKTOP);
	await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
	await page.locator(".tl2-timeline").waitFor({ state: "visible" });
	await page.keyboard.press("Alt+Digit1");
	await page.getByRole("tab", { name: "References", exact: true }).click();
	await page.getByRole("button", { name: "New reference" }).click();
	const editor = page.locator(".cv-entity-editor-modal");
	await editor.getByRole("button", { name: "Upload", exact: true }).click();
	let attempts = 0;
	await page.route("**/api/image-gen/upload*", (route) => {
		attempts++;
		return route.fulfill({
			status: attempts === 1 ? 503 : 200,
			contentType: "application/json",
			body: JSON.stringify(
				attempts === 1
					? { error: "storage_unavailable" }
					: { url: "/api/media/11111111-1111-4111-8111-111111111111" },
			),
		});
	});
	const file = { name: "retry.png", mimeType: "image/png", buffer: Buffer.from("image bytes") };
	await editor.locator('input[type="file"]').setInputFiles(file);
	await expect(editor.getByRole("alert")).toContainText("storage_unavailable");
	await editor.getByRole("button", { name: "URL", exact: true }).click();
	await expect(editor.getByLabel("Canonical image URL")).toHaveValue("");
	await editor.getByRole("button", { name: "Upload", exact: true }).click();
	await editor.locator('input[type="file"]').setInputFiles(file);
	await expect(editor.getByRole("alert")).toHaveCount(0);
	await editor.getByRole("button", { name: "URL", exact: true }).click();
	await expect(editor.getByLabel("Canonical image URL")).toHaveValue(
		"/api/media/11111111-1111-4111-8111-111111111111",
	);
});

/* The four material groups are the model an operator has to learn, so they are
 * filters AND sections, and a section that happens to be empty still says it
 * exists and offers a way to fill it. */
test.describe("materials grouping", () => {
	const GROUPS = ["Story", "Visual", "Voice", "Rules"] as const;

	test("library chrome: every material group is a chip and a section", async ({ page }) => {
		await page.setViewportSize(DESKTOP);
		await open(page, "/library/materials");
		for (const label of GROUPS) {
			await expect(
				page.locator(".catalog-groups button", { hasText: new RegExp(`^${label}$`) }),
			).toHaveCount(1);
			await expect(page.locator("main section h2", { hasText: label })).toHaveCount(1);
		}
	});

	test("library chrome: selecting a group renders only that section", async ({ page }) => {
		await page.setViewportSize(DESKTOP);
		await open(page, "/library/materials");
		await expect(page.locator("main section")).toHaveCount(GROUPS.length);

		await page.locator(".catalog-groups button", { hasText: /^Visual$/ }).click();
		await expect(page.locator("main section")).toHaveCount(1);
		await expect(page.locator("main section h2")).toHaveText(/Visual/);

		// Pressing the active chip again returns the unfiltered view.
		await page.locator(".catalog-groups button", { hasText: /^Visual$/ }).click();
		await expect(page.locator("main section")).toHaveCount(GROUPS.length);
	});

	test("library chrome: search combines with the active group", async ({ page }) => {
		await page.setViewportSize(DESKTOP);
		await open(page, "/library/materials");
		await page.locator(".catalog-groups button", { hasText: /^Visual$/ }).click();
		await page.locator(".catalog-search input").fill("Cinematic");

		await expect(page.locator("main section")).toHaveCount(1);
		const rows = page.locator("main section").first();
		await expect(rows).toContainText("Cinematic");
		await expect(rows).not.toContainText("— Story");
	});

	test("library chrome: a rendered group with no matches keeps its create path", async ({
		page,
	}) => {
		await page.setViewportSize(DESKTOP);
		await open(page, "/library/materials");
		await page.locator(".catalog-search input").fill("zzzznomatch");

		// All four sections stay, and each offers the way to add to itself.
		await expect(page.locator("main section")).toHaveCount(GROUPS.length);
		await expect(page.locator(".cv-preset-empty")).toHaveCount(GROUPS.length);
	});
});

/* Voices ships search-only in this pass. Language is on the row because it is
 * useful to see, not because it has been shown to be how operators browse — a
 * chip row per language would be inventing a taxonomy to fill the toolbar. */
test.describe("voices", () => {
	test("library chrome: voices has the shared search and no group chips", async ({ page }) => {
		await page.setViewportSize(DESKTOP);
		await open(page, "/library/voices");
		await expect(page.locator(".catalog-search input")).toBeVisible();
		await expect(page.locator(".catalog-groups")).toHaveCount(0);
	});

	test("library chrome: a voice still shows its language", async ({ page }) => {
		await page.setViewportSize(DESKTOP);
		await open(page, "/library/voices");
		await expect(page.locator('main [data-slot="chip"]').first()).toBeVisible();
	});
});

/* Library > Elements shares retained primitive groups with the editor.
 * Saved variants stay with their primitive; user compositions belong to Motion. */
test.describe("elements catalogue", () => {
	const FAMILIES = ["Text", "Shapes", "Motion"] as const;

	test("library chrome: elements lists every placeable family", async ({ page }) => {
		await page.setViewportSize(DESKTOP);
		await open(page, "/library/elements");
		// Exact text: "Motion" must not also match "Motion presets".
		for (const family of FAMILIES) {
			await expect(
				page
					.locator(".catalog-el-group > h2")
					.filter({ hasText: new RegExp(`^${family}\\s*\\d+$`) }),
			).toHaveCount(1);
		}
		// Retained variants share their primitive group; compositions belong to Motion.
		await expect(page.locator(".catalog-el-group")).toHaveCount(FAMILIES.length);
	});

	test("library chrome: built-in elements are listed, not just saved ones", async ({ page }) => {
		await page.setViewportSize(DESKTOP);
		await open(page, "/library/elements");
		// Built-ins that ship with the product, from the rail's own source module.
		for (const label of ["Text", "Rectangle", "Circle", "Triangle", "Star", "Cross"]) {
			await expect(
				page
					.locator(".catalog-el-tile figcaption b", { hasText: new RegExp(`^${label}$`) })
					.first(),
			).toBeVisible();
		}
	});

	/* Placing needs a timeline and a playhead. The library has neither, so the
	 * catalogue must not offer the action — a disabled or no-op place control is
	 * still a control, and the operator learns it does nothing by pressing it. */
	test("library chrome: nothing on the elements page places anything", async ({ page }) => {
		await page.setViewportSize(DESKTOP);
		await open(page, "/library/elements");
		for (const name of [/^place$/i, /^add to timeline$/i, /drag to the timeline/i]) {
			await expect(page.getByRole("button", { name })).toHaveCount(0);
		}
		// The built-in tiles are figures, not buttons: no click target at all.
		await expect(page.locator(".catalog-el-tile[role]")).toHaveCount(0);
		await expect(page.locator(".catalog-el-tile button")).toHaveCount(0);
	});

	test("library chrome: custom elements keep their management controls", async ({ page }) => {
		await page.setViewportSize(DESKTOP);
		await open(page, "/library/elements");
		const custom = page
			.locator(".catalog-el-group")
			.filter({ has: page.locator("h2", { hasText: /^Motion/ }) });
		await expect(page.getByRole("button", { name: /New (text|shape) variant/ })).toHaveCount(0);
		await expect(custom.getByRole("button", { name: "New motion", exact: true })).toBeVisible();
	});

	test("library chrome: search spans element families", async ({ page }) => {
		await page.setViewportSize(DESKTOP);
		await open(page, "/library/elements");
		await page.locator(".catalog-search input").fill("Fixture Element");

		// User motion matches its label; built-in Text and Shapes do not.
		const countOf = (family: string) =>
			page
				.locator(".catalog-el-group")
				.filter({ has: page.locator("h2", { hasText: new RegExp(`^${family}\\s*\\d+$`) }) })
				.locator('h2 [data-slot="chip"]');
		await expect(countOf("Motion")).not.toHaveText("0");
		await expect(countOf("Text")).toHaveText("0");
		await expect(countOf("Shapes")).toHaveText("0");
	});

	test("library chrome: a family filter narrows to that family", async ({ page }) => {
		await page.setViewportSize(DESKTOP);
		await open(page, "/library/elements");
		await page.locator(".catalog-groups button", { hasText: /^Motion$/ }).click();
		await expect(page.locator(".catalog-el-group")).toHaveCount(1);
		await expect(page.locator(".catalog-el-group > h2")).toHaveText(/^Motion/);
	});
});

/* Custom Elements → Elements, everywhere it is named. The label described a
 * fifth of what the page holds once built-ins arrived; the URL did not change,
 * because a bookmark is not a label. */
test.describe("the elements rename", () => {
	test("library chrome: no surface still says Custom Elements as a page or nav name", async ({
		page,
	}) => {
		await page.setViewportSize(DESKTOP);
		await open(page, "/library/elements");

		await expect(page.locator(".pg-title")).toHaveText("Elements");
		// The sidebar entry, and the breadcrumb above the heading.
		await expect(page.locator(".ui-sidebar-item", { hasText: "Custom Elements" })).toHaveCount(0);
		const crumbs = page.locator("header.ui-topbar .crumbs");
		await expect(crumbs).toContainText(/elements/i);
		await expect(crumbs).not.toContainText(/custom elements/i);
		// Saved items belong to Text, Shapes or Motion; they have no fourth group.
		await expect(
			page.locator(".catalog-el-group > h2", { hasText: "Custom Elements" }),
		).toHaveCount(0);
	});

	test("library chrome: the route is unchanged", async ({ page }) => {
		await page.setViewportSize(DESKTOP);
		await open(page, "/library/elements");
		expect(new URL(page.url()).pathname).toBe("/library/elements");
	});
});

/* Video Templates rendered the editor's Templates rail verbatim, so the page
 * carried a panel header, a close button that closed nothing, an Active marker
 * for a project that was not open, and a preview sized for a 288px rail. */
test.describe("video templates catalogue", () => {
	test("library chrome: templates render as catalogue rows", async ({ page }) => {
		await page.setViewportSize(DESKTOP);
		await open(page, "/library/templates");
		await expect(page.locator(".collection-rows .collection-card").first()).toBeVisible();
		await expect(page.locator('[data-slot="panel-header"]')).toHaveCount(0);
		await expect(page.locator(".tl2-template-library")).toHaveCount(0);
	});

	test("library chrome: no project-only control is offered", async ({ page }) => {
		await page.setViewportSize(DESKTOP);
		await open(page, "/library/templates");
		// The rail's select control, its Active marker and its hide-panel button.
		await expect(page.locator(".tl2-template-select")).toHaveCount(0);
		await expect(page.locator(".tl2-template-active")).toHaveCount(0);
		await expect(page.getByRole("button", { name: /hide panel/i })).toHaveCount(0);
		await expect(page.locator("[aria-pressed]")).toHaveCount(0);
	});

	test("library chrome: a row opens the shared editor, and closing it returns the list", async ({
		page,
	}) => {
		await page.setViewportSize(DESKTOP);
		await open(page, "/library/templates");
		const rows = page.locator(".collection-rows .collection-card");
		const before = await rows.count();

		await rows.first().getByRole("button").click();
		await expect(page.locator(".tl2-template-editor-modal")).toBeVisible();

		await page.keyboard.press("Escape");
		await expect(page.locator(".tl2-template-editor-modal")).toHaveCount(0);
		await expect(rows).toHaveCount(before);
	});

	/* Fixture-copy semantics are asserted at the source in
	 * `templates-library.test.tsx`: the recorded API fixture holds no shipped
	 * template, so there is no built-in row on this page to drive. */
});

test.describe("search behaviour", () => {
	test("library chrome: the clear control appears with a query and empties it", async ({
		page,
	}) => {
		await page.setViewportSize(DESKTOP);
		await open(page, "/library/materials");
		const search = page.locator(".catalog-search input");
		const clear = page.locator('.catalog-search [data-slot="search-clear"]');

		await expect(clear).toHaveCount(0);
		await search.fill("animated");
		await expect(clear).toBeVisible();
		await clear.click();
		await expect(search).toHaveValue("");
		// Focus returns to the field, so the next keystroke lands where it was typed.
		await expect(search).toBeFocused();
	});

	test("library chrome: switching reference group keeps one search in one place", async ({
		page,
	}) => {
		await page.setViewportSize(DESKTOP);
		await open(page, "/library/references");
		const search = page.locator(".catalog-search input");
		const boxBefore = await search.boundingBox();

		await page.locator(".catalog-groups button", { hasText: "Notes" }).click();
		await expect(page.locator('input[type="search"], input[type="text"]')).toHaveCount(1);
		const boxAfter = await search.boundingBox();
		expect(boxAfter?.y).toBe(boxBefore?.y);

		await page.locator(".catalog-groups button", { hasText: "Images" }).click();
		await expect(page.locator('input[type="search"], input[type="text"]')).toHaveCount(1);
	});
});

test.describe("references detail and filtering", () => {
	test("library chrome: references has source and type filters", async ({ page }) => {
		await page.setViewportSize(DESKTOP);
		await open(page, "/library/references");
		await expect(page.locator(".catalog-groups", { hasText: "Images" })).toBeVisible();
		await expect(page.locator(".catalog-groups", { hasText: "Character" })).toBeVisible();
	});

	test("library chrome: every reference kind filters to its fixture card", async ({ page }) => {
		await open(page, "/library/references");
		for (const kind of ["Style", "Character", "Location", "Product", "Prop"]) {
			await page.locator(".catalog-groups button", { hasText: new RegExp(`^${kind}$`) }).click();
			const cards = page.locator("[data-slot='media-card']");
			await expect(cards).toHaveCount(1);
			await expect(cards.first()).toContainText(`Fixture ${kind}`);
			await page.locator(".catalog-groups button", { hasText: new RegExp(`^${kind}$`) }).click();
		}
	});

	/* The detail is a Modal now, not an overlay this surface built itself, so
	 * these drive the primitive's controls: one Close in the dialog header, and
	 * Escape, which the hand-rolled version never had. */
	test("library chrome: reference cards open detail", async ({ page }) => {
		await page.setViewportSize(DESKTOP);
		await open(page, "/library/references");
		const cards = page.locator("[data-slot='media-card']");
		await cards.first().click();
		await expect(page.locator(".cv-modal .catalog-ref-detail")).toBeVisible();
		await expect(page.getByText("Input scenario")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.locator(".catalog-ref-detail")).toHaveCount(0);
	});

	test("library chrome: reference detail docks to the bottom edge on phones", async ({ page }) => {
		await page.setViewportSize(PHONE);
		await open(page, "/library/references");
		await page.locator("[data-slot='media-card']").first().click();
		const dialog = page.locator(".cv-modal.cv-modal-dock");
		/* Measure the settled dialog. Modal's open animation is real now — the
		 * two keyframe sets it named had never existed — and a box read while
		 * `scale(0.98)` is still running is a couple of pixels short of the
		 * edge it is being asserted against. */
		await settled(dialog);
		const box = await dialog.boundingBox();
		expect(box?.x).toBe(0);
		expect(box?.width).toBe(PHONE.width);
		expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(PHONE.height);
		await expect(page.locator(".catalog-ref-detail img").first()).toHaveCSS(
			"object-fit",
			"contain",
		);
		/* The scroll lock arrives with the overlay mechanism — it was a
		 * `html:has(.catalog-ref-detail)` rule in an editor stylesheet before,
		 * and it now comes from the same place every other overlay's does. */
		await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
	});

	test("library chrome: reference edit is constrained and docked on phones", async ({ page }) => {
		await page.setViewportSize(PHONE);
		await open(page, "/library/references");
		await page.locator("[data-slot='media-card']").first().click();
		await page.getByRole("button", { name: "Edit" }).click();
		const editor = page.locator(".cv-entity-editor-modal.cv-modal-dock");
		await settled(editor);
		const box = await editor.boundingBox();
		expect(box?.x).toBe(0);
		expect(box?.width).toBe(PHONE.width);
		expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(PHONE.height);
		await expect(page.getByRole("combobox", { name: "Role", exact: true })).toBeVisible();
		await expect(page.getByLabel("Label")).toBeVisible();
		await expect(page.getByLabel("Input scenario")).toBeVisible();
		await expect(page.getByRole("button", { name: "Delete" })).toBeVisible();
		await expect(page.locator(".cv-entity-editor-readonly-media")).toBeVisible();
		await expect(page.locator(".cv-entity-editor-readonly-media img").first()).toHaveCSS(
			"object-fit",
			"contain",
		);
		await expect(page.getByLabel("Image prompt")).toHaveCount(0);
		await expect(page.getByLabel("Canonical image URL")).toHaveCount(0);
	});
});

/* Keyboard, on the controls this change converged.
 *
 * The rest of this file drives the chrome with a pointer, which is what its
 * original defects needed. The collection pattern brought new ones — a search
 * field, a row of filter chips, and a card row that is itself a button — and a
 * filter a keyboard cannot reach is a filter half the operators do not have. */
test.describe("the collection by keyboard", () => {
	test("library chrome: search, every filter chip and the first row are reachable and operable", async ({
		page,
	}) => {
		await page.setViewportSize(DESKTOP);
		await open(page, "/library/references");

		const search = page.locator(".catalog-search input");
		await search.focus();
		await expect(search).toBeFocused();
		await page.keyboard.type("Fixture");
		await expect(search).toHaveValue("Fixture");

		/* Tab out of the field and walk the chips. Each one has to take focus and
		 * act on Enter — a chip row built from `div`s passes a screenshot and
		 * fails here. */
		const chips = page.locator(".catalog-groups button");
		const count = await chips.count();
		expect(count).toBeGreaterThan(1);
		await chips.first().focus();
		for (let i = 0; i < count; i += 1) {
			await expect(chips.nth(i)).toBeFocused();
			if (i < count - 1) await page.keyboard.press("Tab");
		}

		/* Enter acts. Whether pressing it again turns the chip back off is the
		 * chip's own business — this row holds a scope switch (Images / Notes) as
		 * well as the role filters, and a tab that deselects itself would leave the
		 * surface showing nothing. What a keyboard has to be able to do is act. */
		await chips.nth(1).focus();
		await page.keyboard.press("Enter");
		await expect(chips.nth(1)).toHaveClass(/on/);
	});

	test("library chrome: a focused control shows the one focus ring", async ({ page }) => {
		await page.setViewportSize(DESKTOP);
		await open(page, "/library/templates");
		const row = page.locator(".collection-rows .collection-card button").first();
		await row.focus();
		/* The foundation's ring, not whatever the reset left. `outline-style` is
		 * the assertion that matters: `none` is the defect task 3.2 audited out of
		 * eight controls. */
		const ring = await row.evaluate((el) => {
			const s = getComputedStyle(el);
			return { style: s.outlineStyle, width: s.outlineWidth };
		});
		expect(ring.style).not.toBe("none");
		expect(Number.parseFloat(ring.width)).toBeGreaterThanOrEqual(2);
	});
});
