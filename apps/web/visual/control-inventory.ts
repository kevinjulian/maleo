/* What a surface's controls ARE, by name — the assertion a screenshot cannot make.
 *
 * A pixel comparison forgives a sparse change. A studio's bottom bar lost a
 * control, gained a caption and gained six more controls, and both phone
 * captures passed against their old baselines: measured at zero tolerance the
 * redesign moved 189 pixels on one and 184 on the other, against a budget of
 * 518. The arithmetic and why the budget is not the thing to change are in
 * `playwright.config.ts` beside the number.
 *
 * So the surfaces whose requirements name their controls assert them here
 * instead. A control added, removed or renamed fails, whatever the pixels do.
 *
 * By accessible name, not by class or test id, for two reasons. It is the thing
 * a screen reader announces, so a silent change to the wording is worth a
 * failure. And it does not encode the markup: the region can be rebuilt from
 * different elements and the assertion still holds, which is the brittleness
 * that makes people delete a rendered-HTML snapshot instead of fixing it.
 */
import { expect, type Locator } from "@playwright/test";

/* Interactive elements as the platform defines them, plus the ARIA roles that
 * stand in for one. Deliberately not "everything focusable": a scroll container
 * with `tabindex` is not a control, and a bar full of them would report a list
 * nobody wrote. */
const CONTROL_SELECTOR = [
	"button",
	"a[href]",
	"input:not([type='hidden'])",
	"select",
	"textarea",
	"[role='button']",
	"[role='link']",
	"[role='tab']",
	"[role='menuitem']",
	"[role='checkbox']",
	"[role='switch']",
	"[role='slider']",
].join(", ");

/** The placeholder a nameless control reports as, so it shows up in the diff
 *  rather than collapsing to an empty string beside its neighbours. */
export const UNNAMED = "(unnamed)";

/**
 * The accessible names of the controls inside `scope`, in DOM order.
 *
 * Hidden controls are omitted — a bar whose sheet is closed does not carry that
 * sheet's actions — and the visibility test is `getClientRects()` plus
 * `visibility`, because a control positioned off screen still has a box.
 *
 * The naming rule is the useful subset of accname: `aria-labelledby`, then
 * `aria-label`, then the control's own text, then an associated `<label>`, then
 * `title`. That is the order the browser uses and the order these surfaces
 * rely on — icon controls carry `aria-label`, the commit carries text.
 */
export async function controlNames(scope: Locator): Promise<string[]> {
	return scope.evaluate(
		(root, { selector, unnamed }) => {
			const named = (el: Element): string => {
				const labelledby = el.getAttribute("aria-labelledby");
				if (labelledby) {
					const text = labelledby
						.split(/\s+/)
						.map(
							(id) => document.getElementById(id)?.textContent?.replace(/\s+/g, " ").trim() ?? "",
						)
						.filter(Boolean)
						.join(" ");
					if (text) return text;
				}
				const label = el.getAttribute("aria-label")?.trim();
				if (label) return label;
				if (el instanceof HTMLInputElement) {
					if (["button", "submit", "reset"].includes(el.type)) {
						const value = el.value.trim();
						if (value) return value;
					}
				} else {
					const text = el.textContent?.replace(/\s+/g, " ").trim();
					if (text) return text;
				}
				const associated = (el as HTMLInputElement).labels?.[0]?.textContent
					?.replace(/\s+/g, " ")
					.trim();
				if (associated) return associated;
				return el.getAttribute("title")?.trim() ?? "";
			};

			const shown = (el: Element): boolean => {
				if (el.closest("[aria-hidden='true']")) return false;
				if (el.getClientRects().length === 0) return false;
				return getComputedStyle(el).visibility !== "hidden";
			};

			return [...root.querySelectorAll(selector)].filter(shown).map((el) => named(el) || unnamed);
		},
		{ selector: CONTROL_SELECTOR, unnamed: UNNAMED },
	);
}

/**
 * The surface carries exactly these controls, in this order.
 *
 * Ordered and exact on purpose. A set comparison would pass a bar whose exit
 * moved to the far end, and a subset comparison would pass the six buttons that
 * arrived unannounced — which is the case this exists for.
 *
 * The failure names what moved before the array diff, because "expected 7 got
 * 13" is the report that made the original change invisible in the first place.
 */
export async function expectControls(
	scope: Locator,
	expected: readonly string[],
	label: string,
): Promise<void> {
	const actual = await controlNames(scope);
	const missing = expected.filter((name) => !actual.includes(name));
	const unexpected = actual.filter((name) => !expected.includes(name));
	const notes = [
		missing.length ? `missing ${JSON.stringify(missing)}` : "",
		unexpected.length ? `unexpected ${JSON.stringify(unexpected)}` : "",
		!missing.length && !unexpected.length ? "same controls, different order" : "",
	].filter(Boolean);
	expect(actual, `${label}: ${notes.join("; ")}`).toEqual([...expected]);
}
