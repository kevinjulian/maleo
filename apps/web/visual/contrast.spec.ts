/* Text roles against the surfaces they sit on, in both themes.
 *
 * tokens.css states contrast ratios in comments. A comment is not a check: a
 * later palette edit keeps the sentence and loses the ratio. This resolves the
 * tokens in a real browser — so `hsl()`, `oklch()` and `color-mix()` all
 * compute the way they render — and holds each pair to WCAG AA for text. */
import { expect, test } from "@playwright/test";

const PAIRS: readonly (readonly [ink: string, ground: string])[] = [
	["--fg", "--bg"],
	["--fg", "--surface"],
	["--fg-dim", "--surface"],
	["--muted", "--surface"],
	["--muted", "--bg"],
	["--ai", "--surface"],
	["--ai", "--ai-bg"],
	["--on-ai", "--ai"],
	["--ok", "--surface"],
	["--warn", "--surface"],
	["--err", "--surface"],
	["--dark-fg", "--dark"],
];
const AA = 4.5;

for (const theme of ["light", "dark"] as const) {
	test(`text roles clear AA on their surfaces in ${theme}`, async ({ page }) => {
		await page.addInitScript((selected) => localStorage.setItem("theme", selected), theme);
		await page.goto("/login");
		const ratios = await page.evaluate((pairs) => {
			const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
			const rgb = (token: string): number[] => {
				const probe = document.createElement("span");
				probe.style.color = `var(${token})`;
				document.body.append(probe);
				ctx.clearRect(0, 0, 1, 1);
				ctx.fillStyle = "#fff";
				ctx.fillRect(0, 0, 1, 1); // translucent inks composite on white
				ctx.fillStyle = getComputedStyle(probe).color;
				ctx.fillRect(0, 0, 1, 1);
				probe.remove();
				return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
			};
			const lum = (c: number[]): number => {
				const [r, g, b] = c.map((v) => {
					const s = v / 255;
					return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
				});
				return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
			};
			return pairs.map(([ink, ground]) => {
				const [a, b] = [lum(rgb(ink)), lum(rgb(ground))];
				return {
					pair: `${ink} on ${ground}`,
					ratio: Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100,
				};
			});
		}, PAIRS);
		expect(
			ratios.filter((r) => r.ratio < AA),
			JSON.stringify(ratios),
		).toEqual([]);
	});
}
