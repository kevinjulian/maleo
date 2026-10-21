/* Actual caption component in a Remotion Player: phrase layout must survive word changes. */
import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CaptionCue } from "@maleo/shared";
import type { RenderCaptionCue } from "../../../packages/video/src/components/Captions.tsx";
import { REPO_ROOT } from "../../../scripts/editor-engine.mts";

declare global {
	interface Window {
		mountCaption(cues: RenderCaptionCue[], style: string, font: string, motion?: string): void;
		seekCaption(frame: number): void;
		captionPlayerReady: boolean;
	}
}
function bundle(): string {
	const dir = mkdtempSync(join(tmpdir(), "caption-layout-"));
	const entry = join(dir, "entry.ts");
	writeFileSync(
		entry,
		[
			`import { createElement } from ${JSON.stringify(join(REPO_ROOT, "apps/web/node_modules/react"))};`,
			`import { createRoot } from ${JSON.stringify(join(REPO_ROOT, "apps/web/node_modules/react-dom/client"))};`,
			`import { Player } from ${JSON.stringify(join(REPO_ROOT, "apps/web/node_modules/@remotion/player"))};`,
			`import { Captions } from ${JSON.stringify(join(REPO_ROOT, "packages/video/src/components/Captions.tsx"))};`,
			'const root = createRoot(document.getElementById("app"));',
			'window.mountCaption = (cues, style, font, motion = "None") => root.render(createElement(Player, {component:Captions, compositionWidth:1080, compositionHeight:1920, durationInFrames:180, fps:30, style:{width:1080,height:1920}, inputProps:{cues, accentColor:"#ff0000",fgColor:"#ffffff",config:{fontFamily:font,fontSize:64,verticalPosition:70,maxWidth:80,motion,style}}, ref:(player)=>{if(player){window.seekCaption=(frame)=>player.seekTo(frame);window.captionPlayerReady=true;}}}));',
		].join("\n"),
	);
	const out = join(dir, "bundle.js");
	execFileSync("bun", ["build", entry, "--target=browser", "--outfile", out], {
		stdio: ["ignore", "ignore", "inherit"],
	});
	return readFileSync(out, "utf8");
}
const caption: CaptionCue = {
	text: "First words\nremain stable",
	words: [
		{ text: "First", startSec: 0, endSec: 0.4 },
		{ text: "words", startSec: 0.5, endSec: 0.9 },
		{ text: "remain", startSec: 1.2, endSec: 1.6 },
		{ text: "stable", startSec: 1.7, endSec: 2 },
	],
	provenance: { origin: "manual", wordTimingOrigin: "estimated" },
	sources: [],
	protection: { text: false, timing: false, segmentation: false, style: false },
	revision: 0,
	groupId: "g",
	status: "current",
};
const cues: RenderCaptionCue[] = [
	{ id: "caption:1", startSec: 0, durationSec: 2.1, caption },
	{
		id: "caption:2",
		startSec: 2.1,
		durationSec: 0.9,
		caption: { ...caption, text: "Next", words: [] },
	},
	{
		id: "caption:3",
		startSec: 4,
		durationSec: 1,
		caption: { ...caption, text: "After silence", words: [] },
	},
];
const script = bundle();
for (const style of ["Standard", "Karaoke", "Word pop", "Typewriter"]) {
	test(`caption ${style} retains phrase and reserved word boxes`, async ({ page }) => {
		await page.setViewportSize({ width: 1100, height: 1940 });
		await page.setContent('<body style="margin:0;background:black"><div id="app"></div></body>');
		await page.addScriptTag({ content: script });
		await page.evaluate(({ cues, style }) => window.mountCaption(cues, style, "Arial"), {
			cues,
			style,
		});
		await expect.poll(() => page.evaluate(() => window.captionPlayerReady)).toBe(true);
		const state = () =>
			page.locator('[data-caption-cue="caption:1"]').evaluate((element) => ({
				text: element.textContent,
				words: Array.from(element.querySelectorAll<HTMLElement>("[data-caption-word]"), (word) => {
					const box = word.getBoundingClientRect();
					return { x: box.x, y: box.y, width: box.width, height: box.height };
				}),
				opacity: Array.from(
					element.querySelectorAll<HTMLElement>("[data-caption-word] > span"),
					(word) => getComputedStyle(word).opacity,
				),
			}));
		await page.evaluate(() => window.seekCaption(6));
		await expect(page.locator('[data-caption-cue="caption:1"]')).toBeVisible();
		await page.evaluate(() => document.fonts.ready);
		const before = await state();
		for (const frame of [20, 32, 45, 58]) {
			await page.evaluate((frame) => window.seekCaption(frame), frame);
			await expect.poll(async () => (await state()).words).toEqual(before.words);
			expect((await state()).text).toBe(before.text);
			if (style === "Standard") expect((await state()).opacity).toEqual(["1", "1", "1", "1"]);
		}
		if (style === "Typewriter") expect(before.opacity).toEqual(["1", "0", "0", "0"]);
		await page.evaluate(() => window.seekCaption(63));
		await expect(page.locator("[data-caption-cue]")).toHaveAttribute(
			"data-caption-cue",
			"caption:2",
		);
		await page.evaluate(() => window.seekCaption(100));
		await expect(page.locator("[data-caption-cue]")).toHaveCount(0);
	});
}

for (const motion of ["None", "Fade", "Pop", "Slide Up"]) {
	test(`cue entry ${motion} never restarts at a word boundary`, async ({ page }) => {
		await page.setContent('<body><div id="app"></div></body>');
		await page.addScriptTag({ content: script });
		await page.evaluate(
			({ cues, motion }) => window.mountCaption(cues, "Karaoke", "serif", motion),
			{ cues, motion },
		);
		await expect.poll(() => page.evaluate(() => window.captionPlayerReady)).toBe(true);
		const presentation = () =>
			page.locator('[data-caption-cue="caption:1"]').evaluate((el) => ({
				opacity: getComputedStyle(el).opacity,
				scale: getComputedStyle(el).scale,
				translate: getComputedStyle(el).translate,
			}));
		await page.evaluate(() => window.seekCaption(10));
		await expect(page.locator('[data-caption-cue="caption:1"]')).toBeVisible();
		const settled = await presentation();
		expect(settled.opacity).toBe("1");
		for (const frame of [25, 40, 55]) {
			await page.evaluate((frame) => window.seekCaption(frame), frame);
			await expect.poll(presentation).toEqual(settled);
		}
	});
}

test("long authored captions retain complete text inside canvas after fonts settle", async ({
	page,
}) => {
	await page.setContent('<body style="margin:0"><div id="app"></div></body>');
	await page.addScriptTag({ content: script });
	const text =
		"Looooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooong\n".repeat(
			10,
		);
	const long = [{ ...cues[0]!, caption: { ...caption, text, words: [] } }];
	await page.evaluate((cues) => window.mountCaption(cues, "Standard", "monospace"), long);
	await expect.poll(() => page.evaluate(() => window.captionPlayerReady)).toBe(true);
	const cue = page.locator('[data-caption-cue="caption:1"]');
	await expect(cue).toHaveText(text);
	await expect
		.poll(() => cue.evaluate((el) => el.getBoundingClientRect().width))
		.toBeLessThanOrEqual(864);
});
