import { expect, type Locator } from "@playwright/test";

/** Drive custom selection through its public trigger and visible option list. */
export async function chooseOption(
	trigger: Locator,
	selection: string | { label: string },
): Promise<void> {
	await trigger.click();
	const page = trigger.page();
	const list = page.locator('[data-slot="select-list"]:visible');
	const option =
		typeof selection === "string"
			? list.locator(`[role="option"][data-value=${JSON.stringify(selection)}]`)
			: list.getByRole("option", { name: selection.label, exact: true });
	await expect(option).toBeVisible();
	await option.click();
	await expect(page.locator('[data-slot="select-popup"]:visible')).toHaveCount(0);
}
