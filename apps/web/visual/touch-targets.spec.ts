/* Every control a finger can reach is at least 44px, on the three surfaces this
 * change converged.
 *
 * Task 1.3 recorded the gap and refused to paper over it: `touch.css` raised
 * input `font-size` to 16px against iOS focus-zoom and did nothing about size,
 * so the app had **no hit-target floor at all** and the editor's small icon
 * buttons were 26px squares under a thumb. Task 4.4 wrote the rule. This is what
 * says the rule reaches the controls, rather than the token existing again.
 *
 * It runs in the `mobile` project and can only run there: the floor keys off
 * `pointer: coarse`, which `hasTouch` + `isMobile` produce. Asserted in the
 * desktop project it would measure controls the rule never applied to and pass
 * for the wrong reason — which is exactly how the missing floor survived being
 * "already enforced" in a comment.
 */
import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { replayApi } from "./har.ts";
import { EDITOR_CHAT_FIXTURE_PROJECT_ID } from "./screens.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FLOOR = 44;

/** Every visible control inside `scope`, with its rendered box. */
async function controls(
	page: import("@playwright/test").Page,
	scope: string,
): Promise<Array<{ label: string; w: number; h: number }>> {
	return page.evaluate((selector) => {
		const root = document.querySelector(selector);
		if (!root) return [];
		const found: Array<{ label: string; w: number; h: number }> = [];
		for (const el of root.querySelectorAll<HTMLElement>(
			"button, a[href], summary, [role='button']",
		)) {
			const box = el.getBoundingClientRect();
			/* Hidden controls are not hit targets. A zero box is a closed sheet's
			 * contents or a control behind a `display: none`, and holding those to
			 * the floor would assert about geometry nobody can touch. */
			if (box.width === 0 || box.height === 0) continue;
			if (getComputedStyle(el).visibility === "hidden") continue;
			/* The HIT area, not the drawn box. Two editor controls cannot grow —
			 * a transition marker sits between two clips, a delete affordance sits
			 * on one — so they expand with a centred pseudo-element instead, which
			 * `getBoundingClientRect` does not see. Measuring the drawn box alone
			 * would report them as too small while a finger lands fine. */
			const after = getComputedStyle(el, "::after");
			const reach = (value: string): number =>
				after.content === "none" ? 0 : Number.parseFloat(value) || 0;
			const label =
				el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 32) ?? el.className;
			found.push({
				label: label || el.className,
				w: Math.max(box.width, reach(after.width)),
				h: Math.max(box.height, reach(after.height)),
			});
		}
		return found;
	}, scope);
}

/* The three representative surfaces the change is proved on, each at the place
 * its own converged controls are: the generated settings form, a library
 * collection, and the editor with its rail and transport. */
/* Controls that stay under the floor on purpose go here, each with its reason.
 * Empty: the one entry was the clip's corner delete, which is no longer a
 * control — it is a pointer shortcut inside the clip, and Delete or the clip
 * menu is the reachable way to remove one. */
const EXEMPT: readonly { match: string; why: string }[] = [];

const SURFACES = [
	{
		name: "Settings",
		har: "fixtures/api.har",
		path: "/settings/capabilities/tts/kokoro",
		ready: ".settings-setup",
		scope: ".settings-setup",
	},
	{
		name: "Library",
		har: "fixtures/api.har",
		path: "/library/references",
		ready: "main",
		scope: "main",
	},
	{
		name: "the editor",
		har: "fixtures/api-editor-chat.har",
		path: `/content/${EDITOR_CHAT_FIXTURE_PROJECT_ID}`,
		ready: ".tl2",
		scope: ".tl2",
	},
] as const;

for (const surface of SURFACES) {
	test(`${surface.name}: every reachable control clears the touch floor`, async ({
		page,
		context,
	}) => {
		await replayApi(context, resolve(HERE, surface.har));
		await page.goto(surface.path);
		await page.locator(surface.ready).first().waitFor({ state: "visible" });
		await page.evaluate(() => document.fonts.ready);

		const short = (await controls(page, surface.scope))
			.filter((c) => c.h < FLOOR - 0.5 && c.w < FLOOR - 0.5)
			.filter((c) => !EXEMPT.some((e) => c.label.includes(e.match)));
		expect(short.map((c) => `${c.label} ${Math.round(c.w)}x${Math.round(c.h)}`)).toEqual([]);
	});
}

test("the floor is the coarse pointer's, not a resize", async ({ page, context }) => {
	await replayApi(context, resolve(HERE, "fixtures/api.har"));
	/* The distinction this whole spec rests on. If the rule had been written
	 * against a width breakpoint, a touch laptop at 1400px would get 26px
	 * controls and a desktop window dragged to 390px would get 44px ones — both
	 * backwards. */
	await page.goto("/settings");
	expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
});
