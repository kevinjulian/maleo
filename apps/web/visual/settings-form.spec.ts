/* The Settings form, driven rather than photographed.
 *
 * This is task 4.2's proof, and it exists because the screenshots cannot see the
 * half of that task that matters. A capture shows a help line under a control;
 * it cannot show whether the control says the line describes it. It shows an
 * error in red; it cannot show whether anything announces it, or whether the
 * field the error belongs to is marked invalid. Those were the three defects the
 * settings form actually had — help and errors lived inside the `<label>`, so a
 * screen reader read the help as part of the field's name and never reported an
 * error as an error.
 *
 * Driven at 1440 and at 320, because the second is where a form pattern usually
 * turns out to have been a desktop pattern.
 */
import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { replayApi } from "./har.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");
test.use({ hasTouch: true });
const ROUTE = "/settings/capabilities/stock-visuals/pexels";
const WIDTHS = [1440, 320] as const;

/** One provider with one required secret, one optional choice, and a help line
 *  on each — the shapes the generated form can produce. */
function fieldsFor(state: "clean" | "error" | "shadowed"): unknown[] {
	return [
		{
			key: "PEXELS_API_KEY",
			label: "API key",
			kind: "secret",
			required: true,
			set: false,
			source: "unset",
			shadowed: state === "shadowed",
			value_masked: null,
			help: "Found on your Pexels account page.",
			...(state === "error" ? { error: "That key was rejected." } : {}),
		},
		{
			key: "PEXELS_LOCALE",
			label: "Locale",
			kind: "choice",
			required: false,
			set: false,
			source: "unset",
			shadowed: false,
			options: [
				{ id: "en-US", label: "English (US)" },
				{ id: "de-DE", label: "German" },
			],
		},
	];
}

async function open(
	page: import("@playwright/test").Page,
	state: "clean" | "error" | "shadowed",
): Promise<void> {
	await page.route("**/api/settings/global**", (route) => route.fulfill({ json: { items: [] } }));
	await page.route("**/api/capabilities**", (route) =>
		route.fulfill({
			json: {
				capabilities: [
					{
						id: "stock-visuals",
						label: "Stock visuals",
						description: "Find licensed stock images and video.",
						state: "not_configured",
						activeProviderId: "pexels",
						providers: [{ id: "pexels", label: "Pexels", state: "unconfigured", active: true }],
					},
				],
			},
		}),
	);
	await page.route("**/api/providers/pexels/config**", (route) =>
		route.fulfill({
			json: {
				provider: "pexels",
				label: "Pexels",
				fields: fieldsFor(state),
			},
		}),
	);
	await page.goto(ROUTE);
	await page.locator(".settings-setup").waitFor({ state: "visible" });
	await page.evaluate(() => document.fonts.ready);
}

test.beforeEach(async ({ context }) => {
	await replayApi(context, HAR);
});

for (const width of WIDTHS) {
	test.describe(`settings form @ ${width}`, () => {
		test.beforeEach(async ({ page }) => {
			await page.setViewportSize({ width, height: 900 });
		});

		test("every control is reachable by keyboard, in the order it is read", async ({ page }) => {
			await open(page, "clean");
			const order: string[] = [];
			/* Start on the section's own first control rather than at the top of the
			 * document: tabbing in from there walks the whole shell — sidebar,
			 * workspace switcher, every library link — and says nothing about this
			 * form. The assertion is the sequence within the form, not the count: a
			 * form whose Save comes before its fields is operable and still wrong. */
			/* The section's own Back control is phone-only — it is `display: none` at
			 * desktop, where the provider list beside the form is the way back — so
			 * the walk starts at the first field, which exists at both widths. */
			await page.getByLabel(/API key/).focus();
			order.push("API key");
			for (let i = 0; i < 12; i += 1) {
				await page.keyboard.press("Tab");
				const label = await page.evaluate(() => {
					const active = document.activeElement as HTMLElement | null;
					if (!active || !active.closest(".settings-setup")) return "";
					if (active instanceof HTMLInputElement || active.getAttribute("role") === "combobox") {
						const field = active.closest(".field");
						return field?.querySelector(".form-label")?.textContent?.trim() ?? active.tagName;
					}
					return active.textContent?.trim().split("\n")[0] ?? active.tagName;
				});
				if (!label) break;
				if (label && order.at(-1) !== label) order.push(label);
			}
			/* Save and "Set as Default Provider" are absent, and that is the right
			 * answer rather than a gap: both are disabled on an untouched form — one
			 * has nothing to save, the other nothing configured to activate — and a
			 * disabled control is not in the tab order. The next assertion is that
			 * Save joins the sequence the moment there is something to save. */
			expect(order).toEqual(["API key", "Localeoptional", "Test connection"]);

			await page.getByLabel(/API key/).fill("test-key");
			await page.getByRole("button", { name: "Test connection" }).focus();
			await page.keyboard.press("Tab");
			await expect(page.getByRole("button", { name: "Save" })).toBeFocused();
		});

		test("help describes its control instead of naming it", async ({ page }) => {
			await open(page, "clean");
			const input = page.getByLabel(/API key/);
			const describedBy = await input.getAttribute("aria-describedby");
			expect(describedBy).toBeTruthy();
			const help = page.locator(`#${describedBy}`);
			await expect(help).toHaveText("Found on your Pexels account page.");
			/* The label is the field's name and nothing else. Before this the help
			 * was inside it, so the control announced as "API key Found on your
			 * Pexels account page." */
			const name = await input.evaluate(
				(el) => (el as HTMLInputElement).labels?.[0]?.textContent?.trim() ?? "",
			);
			expect(name).not.toContain("Found on your Pexels");
		});

		test("a rejected value is marked invalid and announced", async ({ page }) => {
			await open(page, "error");
			const input = page.getByLabel(/API key/);
			await expect(input).toHaveAttribute("aria-invalid", "true");
			const alert = page
				.getByRole("alert", { name: /rejected/ })
				.or(page.locator('[role="alert"]', { hasText: "rejected" }));
			await expect(alert.first()).toBeVisible();
			/* The error is described-by too, so reaching the field carries the
			 * reason rather than only the colour. */
			expect(await input.getAttribute("aria-describedby")).toContain("PEXELS_API_KEY-problem");
		});

		test("a shadowed field is a warning, not an invalid value", async ({ page }) => {
			await open(page, "shadowed");
			const input = page.getByLabel(/API key/);
			/* The value is correct and ignored. Marking it invalid would tell an
			 * operator to fix what they typed, which is not the problem. */
			await expect(input).not.toHaveAttribute("aria-invalid", "true");
			await expect(
				page.locator('[role="alert"]', { hasText: "environment variable" }),
			).toBeVisible();
		});

		test("the commit row is the form's, and Save waits for an edit", async ({ page }) => {
			await open(page, "clean");
			const actions = page.locator(".form-actions");
			await expect(actions).toBeVisible();
			const save = actions.getByRole("button", { name: "Save" });
			await expect(save).toBeDisabled();
			await page.getByLabel(/API key/).fill("test-key");
			await expect(save).toBeEnabled();
			/* Reset appears only once there is something to reset — an always-on
			 * Reset is a control that does nothing most of the time it is offered. */
			await expect(actions.getByRole("button", { name: "Reset" })).toBeVisible();
		});

		/* Pointer, not only keyboard. The two are different proofs: a control can be
		 * reachable by Tab and still be covered, mis-sized or in a row that wraps
		 * under the one above it — which is what a click either finds or does not. */
		test("the form's controls take a pointer, and the surface navigates by one", async ({
			page,
		}) => {
			await open(page, "clean");
			await page.getByLabel(/API key/).tap();
			await expect(page.getByLabel(/API key/)).toBeFocused();
			await page.getByLabel(/API key/).fill("typed-by-pointer");
			await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();

			/* Reset is a pointer target that changes state the keyboard test only
			 * sees appear. Clicking it puts the form back to untouched. */
			await page.locator(".form-actions").getByRole("button", { name: "Reset" }).click();
			await expect(page.getByLabel(/API key/)).toHaveValue("");
			await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
		});

		test("the form keeps its measure and never scrolls the page sideways", async ({ page }) => {
			await open(page, "clean");
			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
			);
			expect(overflow).toBeLessThanOrEqual(0);
			const box = await page.locator(".form").first().boundingBox();
			expect(box?.width).toBeLessThanOrEqual(520);
		});

		test("standard fields and save show settled, busy and failure states", async ({
			page,
		}, testInfo) => {
			await open(page, "clean");
			const input = page.getByLabel(/API key/);
			const save = page.getByRole("button", { name: "Save", exact: true });
			await expect(input).toHaveAttribute("data-size", "md");
			await expect(page.getByRole("combobox", { name: /Locale/ })).toHaveAttribute(
				"data-size",
				"md",
			);
			await expect(save).toHaveAttribute("data-slot", "button");
			await expect(save).toBeDisabled();
			await page.screenshot({ path: testInfo.outputPath(`settings-form-${width}-normal.png`) });

			await input.fill("test-key");
			let finishSave!: () => void;
			const pendingSave = new Promise<void>((resolve) => {
				finishSave = resolve;
			});
			await page.route("**/api/providers/pexels/config", async (route) => {
				if (route.request().method() !== "PUT") return route.fallback();
				await pendingSave;
				await route.fulfill({ status: 500, json: { error: "Save failed" } });
			});
			await save.click();
			await expect(save).toBeDisabled();
			await expect(input).toBeDisabled();
			await page.screenshot({ path: testInfo.outputPath(`settings-form-${width}-saving.png`) });
			finishSave();
			await expect(page.locator('[role="alert"]', { hasText: "Save failed" })).toBeVisible();
			await expect(save).toBeEnabled();
			await page.screenshot({ path: testInfo.outputPath(`settings-form-${width}-failure.png`) });
		});
	});
}
