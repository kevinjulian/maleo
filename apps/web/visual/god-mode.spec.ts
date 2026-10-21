import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { replayApi } from "./har.ts";
import { mockAdmin } from "./admin-fixture.ts";

test.beforeEach(async ({ context, page }) => {
	await replayApi(context, resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har"));
	await mockAdmin(page);
});

test("owner enters God Mode, searches users, opens detail, and follows old Settings link", async ({
	page,
}) => {
	await page.goto("/content");
	await page.getByRole("button", { name: "God Mode" }).click();
	await expect(page).toHaveURL(/\/god\/general/);
	await expect(page.getByRole("button", { name: "Users 2", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Users", exact: true }).click();
	await page.getByRole("textbox", { name: "Search users" }).fill("member");
	await page.getByRole("button", { name: "Search", exact: true }).click();
	await expect(page.locator(".god-row")).toHaveCount(1);
	await page.locator(".god-row").click();
	await expect(page).toHaveURL(/\/god\/users\/user-2/);
	await expect(page.locator(".god-detail h2")).toHaveText("member@example.com");
	await page.goBack();
	await expect(page).toHaveURL(/\/god\/users/);
	await page.goto("/settings/capabilities/tts/kokoro");
	await expect(page).toHaveURL(/\/god\/providers\/tts\/kokoro/);
	await expect(page.locator(".god-sidebar")).toBeVisible();
});

test("workspace deletion shows lost access and requires impact confirmation", async ({ page }) => {
	await page.goto("/god/workspaces/alpha");
	await expect(page.getByText("These accounts will lose their only workspace:")).toBeVisible();
	await expect(page.locator(".god-impact-list")).toContainText("member@example.com");
	await page.getByLabel("Type alpha to confirm").fill("alpha");
	const remove = page.getByRole("button", { name: "Delete workspace" });
	await expect(remove).toBeDisabled();
	await page.getByLabel("I understand this impact").check();
	await expect(remove).toBeEnabled();
});

test("account action updates detail and explains last-owner refusal", async ({ page }) => {
	let role = "member";
	await page.route("**/api/admin/users/user-2/role", (route) => {
		role = "instance_owner";
		return route.fulfill({ json: { item: { id: "user-2", role } } });
	});
	await page.route("**/api/admin/users/user-2", (route) =>
		route.fulfill({
			json: {
				item: {
					id: "user-2",
					email: "member@example.com",
					name: "Member",
					role,
					suspended: false,
					workspaces: [{ name: "alpha", role: "member", sole_owner: false }],
				},
			},
		}),
	);
	await page.goto("/god/users/user-2");
	await page.getByRole("button", { name: "Make instance owner" }).click();
	// Promotion hands over the deployment, so it needs the email typed back like demotion.
	const promote = page.getByRole("button", { name: "Confirm promote" });
	await expect(promote).toBeDisabled();
	expect(role).toBe("member");
	await page.getByRole("textbox", { name: "Confirm account email" }).fill("member@example.com");
	await promote.click();
	await expect(page.getByRole("button", { name: "Remove instance owner" })).toBeVisible();
	await page.route("**/api/admin/users/user-2/role", (route) =>
		route.fulfill({ status: 409, json: { error: "last_instance_owner" } }),
	);
	await page.getByRole("button", { name: "Remove instance owner" }).click();
	await page.getByRole("textbox", { name: "Confirm account email" }).fill("member@example.com");
	await page.getByRole("button", { name: "Confirm demote" }).click();
	await expect(page.getByRole("alert")).toHaveText(
		"Promote or restore another instance owner first.",
	);
});

test("a sole workspace owner offers transfer instead of an ineffective delete", async ({
	page,
}) => {
	await page.goto("/god/users/fixture-user");
	await expect(page.getByText("This account is the only owner of alpha.")).toBeVisible();
	await expect(page.getByRole("button", { name: "Delete account" })).toHaveCount(0);
	await page.getByRole("button", { name: "Transfer ownership of alpha" }).click();
	await expect(page).toHaveURL(/\/god\/workspaces\/alpha/);
	await expect(page.locator(".god-detail h2")).toHaveText("Alpha Studio");
});

test("revoking sessions and removing a member need a second press", async ({ page }) => {
	let revoked = 0;
	await page.route("**/api/admin/users/user-2/revoke-sessions", (route) => {
		revoked += 1;
		return route.fulfill({ json: { item: { revoked: 1 } } });
	});
	await page.goto("/god/users/user-2");
	const revoke = page.getByRole("button", { name: "Revoke sessions" });
	await revoke.click();
	expect(revoked).toBe(0);
	await page.keyboard.press("Escape");
	await expect(revoke).toBeFocused();
	await revoke.click();
	await page.getByRole("button", { name: "Sign out everywhere" }).click();
	await expect.poll(() => revoked).toBe(1);
	await page.goto("/god/workspaces/alpha");
	await page.getByRole("button", { name: "Remove" }).first().click();
	await expect(page.getByRole("button", { name: "Remove Fixture" })).toBeVisible();
});

test("workspace creation names its owner", async ({ page }) => {
	let body: { name: string; owner_email: string; display_name: string } | null = null;
	await page.route("**/api/admin/workspaces", (route) => {
		if (route.request().method() !== "POST") return route.fallback();
		body = route.request().postDataJSON();
		return route.fulfill({ json: { item: { name: "gamma" } } });
	});
	await page.goto("/god/workspaces");
	await page.getByText("Create workspace").click();
	await page.getByLabel("New workspace key").fill("gamma");
	const create = page.getByRole("button", { name: "Create", exact: true });
	await expect(create).toBeDisabled();
	await page.getByLabel("Owner email").fill("member@example.com");
	await create.click();
	await expect
		.poll(() => body)
		.toEqual({ name: "gamma", owner_email: "member@example.com", display_name: "gamma" });
});

test("member sees no God Mode entry or admin detail", async ({ page }) => {
	await page.route("**/api/auth/get-session", (route) =>
		route.fulfill({
			json: { user: { id: "user-2", email: "member@example.com", name: "Member", role: "member" } },
		}),
	);
	await page.goto("/content");
	await expect(page.getByRole("button", { name: "God Mode" })).toHaveCount(0);
	await page.goto("/god/users");
	await expect(page.getByRole("heading", { name: "Instance owner access required" })).toBeVisible();
});

test("phone menu and detail navigation restore focus; reduced motion removes drawer transition", async ({
	page,
}) => {
	await page.setViewportSize({ width: 320, height: 740 });
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/god/users");
	await page.locator("header.ui-topbar").getByRole("button", { name: "toggle menu" }).click();
	await expect(
		page.getByRole("dialog", { name: "God Mode navigation", exact: true }),
	).toBeVisible();
	await expect(page.getByRole("dialog", { name: "God Mode navigation", exact: true })).toHaveCSS(
		"transition-duration",
		"0s",
	);
	await page.getByRole("button", { name: "Workspaces" }).click();
	await expect(page).toHaveURL(/\/god\/workspaces/);
	await page.locator(".god-row").click();
	await expect(page.locator(".god-detail h2")).toHaveText("Alpha Studio");
	await page.getByRole("button", { name: /Back to Workspaces/ }).click();
	await expect(page.locator("[data-admin-row=alpha]")).toBeFocused();
});

for (const theme of ["light", "dark"] as const) {
	for (const width of [320, 1440] as const) {
		test(`account deletion confirmation ${theme} ${width}`, async ({ page }) => {
			await page.setViewportSize({ width, height: 900 });
			await page.addInitScript((selected) => localStorage.setItem("theme", selected), theme);
			await page.goto("/god/users/user-2");
			await expect(page.locator("html")).toHaveClass(
				new RegExp(theme === "dark" ? "\\bdark\\b" : "^(?!.*\\bdark\\b)"),
			);
			await page.getByRole("button", { name: "Delete account" }).click();
			const confirm = page.getByRole("button", { name: "Confirm delete" });
			await expect(confirm).toBeDisabled();
			await page.getByRole("textbox", { name: "Confirm account email" }).fill("member@example.com");
			await expect(confirm).toBeEnabled();
			await expect(page).toHaveScreenshot(`god-confirm-${theme}-${width}.png`, { fullPage: true });
		});
	}
}
