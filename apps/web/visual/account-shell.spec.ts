/* The shell and the account pages, driven in a real browser.
 *
 * Popups live here rather than in unit tests: Base UI fixes its layout-effect
 * hook at first import, and bun shares modules across test files, so a popup
 * opened under happy-dom passes or fails on file order. */
import { expect, test, type Page } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { replayApi } from "./har.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");
const EMAIL = "fixture@example.com";

test.beforeEach(async ({ context }) => replayApi(context, HAR));

const avatar = (page: Page) => page.getByRole("button", { name: EMAIL });

async function openUserMenu(page: Page): Promise<void> {
	await avatar(page).click();
	await expect(page.getByRole("menu")).toBeVisible();
}

test("the user menu names the account and leads to its pages", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/content");
	await openUserMenu(page);
	const menu = page.getByRole("menu");
	await expect(menu).toContainText(EMAIL);
	await expect(menu).toContainText("Instance owner");
	for (const label of ["Profile", "Security", "Preferences", "Sign out"]) {
		await expect(menu.getByRole("menuitem", { name: label })).toBeVisible();
	}
	await page.keyboard.press("Escape");
	await expect(page.getByRole("menu")).toHaveCount(0);
	await expect(avatar(page)).toBeFocused();

	await openUserMenu(page);
	await page.getByRole("menuitem", { name: "Security" }).click();
	await expect(page).toHaveURL(/\/account\/security/);
	await expect(page.locator(".sidebar")).toHaveCount(0);
	await expect(page.locator("header.ui-topbar")).toContainText("Account");
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Security");
	await page.getByRole("button", { name: "Back" }).click();
	// The content list's canonical path is the root.
	await expect(page).toHaveURL(/:3031\/(\?|$)/);
});

test("an account page opened directly goes back to content", async ({ page }) => {
	await page.goto("/account/preferences");
	await page.getByRole("button", { name: "Back" }).click();
	await expect(page).toHaveURL(/:3031\/(\?|$)/);
	await expect(page.locator(".sidebar")).toHaveCount(1);
});

test("signing out revokes and lands on sign-in; a failure stays", async ({ page }) => {
	let status = 500;
	await page.route("**/api/auth/sign-out", (route) =>
		route.fulfill({
			status,
			json: status === 200 ? { success: true } : { message: "Sign-out failed upstream" },
		}),
	);
	// A non-default workspace, so "forgotten" is distinguishable from the
	// fallback the sign-in page writes when it loads.
	await page.goto("/content?workspace=previous-account-ws");
	await openUserMenu(page);
	await page.getByRole("menuitem", { name: "Sign out" }).click();
	await expect(page.getByRole("alert")).toContainText("Sign-out failed upstream");
	await expect(page).not.toHaveURL(/\/login/);

	status = 200;
	await page.getByRole("menuitem", { name: "Sign out" }).click();
	await expect(page).toHaveURL(/\/login/);
	expect(await page.evaluate(() => window.localStorage.getItem("maleo.activeWorkspace"))).not.toBe(
		"previous-account-ws",
	);
});

test("the workspace switcher leads to settings and members", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/content");
	const rail = page.locator(".sidebar");
	await rail.locator(".ws-current").click();
	await page.getByRole("button", { name: "Members" }).click();
	await expect(page).toHaveURL(/\/workspace\/members/);
	await expect(rail.locator(".ws-current")).toHaveAttribute("aria-current", "page");
	await rail.locator(".ws-current").click();
	await page.getByRole("button", { name: "Workspace settings" }).click();
	await expect(page).toHaveURL(/\/workspace(\?|$)/);
});

test("the top bar carries search and the collapse survives a reload", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/content");
	await page.getByRole("button", { name: /^Search/ }).click();
	await expect(page.getByRole("dialog", { name: "command palette" })).toBeVisible();
	await page.keyboard.press("Escape");
	await page.getByRole("button", { name: "collapse sidebar" }).click();
	await expect(page.locator(".sidebar")).toHaveClass(/collapsed/);
	await page.reload();
	await expect(page.locator(".sidebar")).toHaveClass(/collapsed/);
	await page.getByRole("button", { name: "expand sidebar" }).click();
	await expect(page.locator(".sidebar")).not.toHaveClass(/collapsed/);
});

test("profile rename shows in the user menu at once", async ({ page }) => {
	await page.route("**/api/auth/update-user", (route) => route.fulfill({ json: { status: true } }));
	await page.goto("/account");
	await expect(page.getByText(EMAIL).first()).toBeVisible();
	const name = page.getByLabel("Display name");
	await name.fill("   ");
	await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
	await expect(page.getByText("A name cannot be empty.")).toBeVisible();
	await name.fill("Ada Lovelace");
	await page.getByRole("button", { name: "Save" }).click();
	await expect(page.getByRole("status")).toHaveText("Saved.");
	await page.getByRole("button", { name: "Back" }).click();
	await expect(avatar(page)).toHaveText("AL");
});

test("security changes the password and signs out other sessions", async ({ page }) => {
	let sessions = [
		{
			id: "s-current",
			userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/129.0 Safari/537.36",
			updatedAt: "2026-09-29T00:00:00.000Z",
		},
		{
			id: "s-phone",
			userAgent:
				"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile/15E148 Safari/604.1",
			updatedAt: "2026-09-28T00:00:00.000Z",
		},
	];
	await page.route("**/api/auth/get-session", (route) =>
		route.fulfill({
			json: {
				session: { id: "s-current" },
				user: { id: "fixture-user", email: EMAIL, name: "Fixture", role: "instance_owner" },
			},
		}),
	);
	await page.route("**/api/auth/list-sessions", (route) => route.fulfill({ json: sessions }));
	await page.route("**/api/auth/revoke-other-sessions", (route) => {
		sessions = sessions.filter((s) => s.id === "s-current");
		return route.fulfill({ json: { status: true } });
	});
	let passwordOk = false;
	await page.route("**/api/auth/change-password", (route) =>
		route.fulfill(
			passwordOk
				? { json: { token: null } }
				: { status: 400, json: { message: "Invalid password", code: "INVALID_PASSWORD" } },
		),
	);

	await page.goto("/account/security");
	await expect(page.getByText("At least 12 characters.")).toBeVisible();
	await expect(page.getByText("Chrome on macOS")).toBeVisible();
	await expect(page.getByText("This browser")).toBeVisible();
	await expect(page.getByText("Safari on iOS")).toBeVisible();

	const change = page.getByRole("button", { name: "Change password" });
	await page.getByLabel("Current password").fill("wrong-password");
	await page.getByLabel("New password", { exact: true }).fill("short");
	await expect(change).toBeDisabled();
	await page.getByLabel("New password", { exact: true }).fill("a-long-new-password");
	await page.getByLabel("Confirm new password").fill("a-different-password");
	await expect(page.getByText("The passwords do not match.")).toBeVisible();
	await expect(change).toBeDisabled();
	await page.getByLabel("Confirm new password").fill("a-long-new-password");
	await change.click();
	await expect(page.getByRole("alert")).toHaveText("Current password is incorrect.");
	await expect(page.getByLabel("New password", { exact: true })).toHaveValue("a-long-new-password");

	passwordOk = true;
	await change.click();
	await expect(page.getByRole("status")).toContainText("Password changed");

	await page.getByRole("button", { name: "Sign out other sessions" }).click();
	await expect(page.getByText("Safari on iOS")).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Sign out other sessions" })).toBeDisabled();
});

test("preferences choose the theme and the top bar agrees", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/account/preferences");
	await page.getByLabel("Dark").check();
	await expect(page.locator("html")).toHaveClass(/dark/);
	await page.getByRole("button", { name: "Back" }).click();
	await expect(page.getByRole("button", { name: "toggle theme" })).toHaveAttribute(
		"title",
		"switch to light theme",
	);
	await page.getByRole("button", { name: "toggle theme" }).click();
	await expect(page.locator("html")).not.toHaveClass(/dark/);
	await openUserMenu(page);
	await page.getByRole("menuitem", { name: "Preferences" }).click();
	await expect(page.getByLabel("Light")).toBeChecked();
});

test("God Mode shares the top bar and the user menu, without credits", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/god/general");
	await expect(page.locator(".god-sidebar")).toBeVisible();
	await openUserMenu(page);
	await expect(page.getByRole("menuitem", { name: "Security" })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.locator("header.ui-topbar")).not.toContainText("Credits");
});

test("at phone width the user menu is in the top bar", async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 800 });
	await page.goto("/content");
	await expect(page.locator(".sidebar")).toBeHidden();
	await openUserMenu(page);
	await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
	await page.keyboard.press("Escape");
	await page.getByRole("button", { name: /^Search/ }).click();
	await expect(page.getByRole("dialog", { name: "command palette" })).toBeVisible();
});

/* Baselines for the account pages and the open user menu, in both themes, at
 * the phone and desktop widths. Sessions are fixed so the capture is stable. */
const FIXED_SESSIONS = [
	{
		id: "s-current",
		userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/129.0 Safari/537.36",
		updatedAt: "2026-09-29T00:00:00.000Z",
	},
	{
		id: "s-phone",
		userAgent:
			"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile/15E148 Safari/604.1",
		updatedAt: "2026-09-28T00:00:00.000Z",
	},
];

const FIXED_KEYS = [
	{
		id: "k-codex",
		name: "Codex on my laptop",
		start: "maleo_Ab",
		createdAt: "2026-09-28T00:00:00.000Z",
		expiresAt: "2026-12-27T00:00:00.000Z",
	},
	{
		id: "k-ci",
		name: "CI",
		start: "maleo_Cd",
		createdAt: "2026-09-20T00:00:00.000Z",
		expiresAt: null,
	},
];

for (const theme of ["light", "dark"] as const) {
	for (const width of [320, 1440] as const) {
		test(`account pages ${theme} ${width}`, async ({ page }) => {
			await page.setViewportSize({ width, height: 900 });
			await page.addInitScript((selected) => localStorage.setItem("theme", selected), theme);
			await page.route("**/api/auth/get-session", (route) =>
				route.fulfill({
					json: {
						session: { id: "s-current" },
						user: { id: "fixture-user", email: EMAIL, name: "Fixture", role: "instance_owner" },
					},
				}),
			);
			await page.route("**/api/auth/list-sessions", (route) =>
				route.fulfill({ json: FIXED_SESSIONS }),
			);
			await page.route("**/api/auth/api-key/list", (route) =>
				route.fulfill({ json: { apiKeys: FIXED_KEYS, total: FIXED_KEYS.length } }),
			);
			for (const section of ["profile", "security", "preferences", "mcp"] as const) {
				await page.goto(`/account/${section}`);
				await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
				if (section === "security") await expect(page.getByText("Safari on iOS")).toBeVisible();
				await page.evaluate(() => document.fonts.ready);
				await expect(page).toHaveScreenshot(`account-${section}-${theme}-${width}.png`, {
					fullPage: true,
				});
			}
			await page.goto("/content");
			await openUserMenu(page);
			await expect(page).toHaveScreenshot(`user-menu-${theme}-${width}.png`);
		});
	}
}
