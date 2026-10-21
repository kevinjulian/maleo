/* Find elements that are styled by a rule written for something else.
 *
 * A selector like `button.ok, .ok` has a bare `.ok` arm, so it matches ANY
 * element carrying a state class named `ok` — including `.sb-credit.ok`, which
 * is why the sidebar credit chip renders as a green success button. That is a
 * collision, not a design.
 *
 * This walks the real DOM of every covered screen and reports, for each bare
 * state selector, the elements it hits that also carry a component class of
 * their own. Those are the candidates: an element with its own component class
 * being painted by a rule that never named it.
 *
 * Run: bun run visual:collisions   (needs the dev server up)
 */
import { chromium } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { SCREENS } from "./screens.ts";

const PORT = process.env.MALEO_WEB_PORT ?? "3030";
const SRC = resolve(import.meta.dir, "../src");

function sheets(dir: string, out: string[] = []): string[] {
	for (const n of readdirSync(dir)) {
		const p = resolve(dir, n);
		if (statSync(p).isDirectory()) sheets(p, out);
		else if (extname(p) === ".css") out.push(p);
	}
	return out;
}

/* A scan that finds nothing must fail, not pass. This walks the tree by
 * directory, so a move that renames those directories would otherwise make it
 * scan zero stylesheets and report a clean result — the worst outcome
 * available, because it looks like the answer you wanted. */
function sheetsOrFail(dir: string): string[] {
	const found = sheets(dir);
	if (found.length === 0) {
		console.error(`no stylesheets found under ${dir} — the scan is pointed at the wrong tree`);
		process.exit(1);
	}
	return found;
}

/** Selector arms whose whole compound is one class: `.ok`, not `.pill.ok`. */
function bareArms(): Array<{ cls: string; sel: string; file: string }> {
	const found: Array<{ cls: string; sel: string; file: string }> = [];
	for (const file of sheetsOrFail(SRC)) {
		const css = readFileSync(file, "utf8");
		for (const m of css.matchAll(/(?:^|\})\s*([^{}@][^{}]*?)\{/gm)) {
			const raw = m[1]!;
			const cut = raw.lastIndexOf("*/");
			const sel = (cut === -1 ? raw : raw.slice(cut + 2)).trim();
			if (!sel || sel.startsWith("@")) continue;
			for (const arm of sel.split(",").map((a) => a.trim())) {
				// The last compound decides what the rule paints.
				const last = arm.split(/[\s>+~]+/).pop() ?? "";
				const m2 = /^\.([a-zA-Z][\w-]*)$/.exec(last.replace(/:{1,2}[\w-()]+/g, ""));
				if (m2) found.push({ cls: m2[1]!, sel, file: file.slice(SRC.length + 1) });
			}
		}
	}
	return found;
}

const arms = bareArms();
const browser = await chromium.launch();
const page = await browser.newPage({
	baseURL: `http://127.0.0.1:${PORT}`,
	viewport: { width: 1440, height: 900 },
});

const hits = new Map<string, Set<string>>();
for (const screen of SCREENS) {
	try {
		await page.goto(screen.path, { waitUntil: "networkidle", timeout: 30_000 });
		// The same navigation the screenshot suite does, or a screen behind a rail
		// is reported as "did not settle" rather than scanned.
		for (const step of [screen.click ?? []].flat()) {
			await page.locator(step).first().click({ timeout: 15_000 });
		}
		await page.locator(screen.ready).first().waitFor({ state: "visible", timeout: 15_000 });
	} catch {
		console.log(`skipped ${screen.name} (did not settle)`);
		continue;
	}
	for (const { cls } of arms) {
		const found = await page.evaluate((c) => {
			const out: string[] = [];
			for (const el of document.querySelectorAll(`.${c}`)) {
				const others = [...el.classList].filter((x) => x !== c);
				// An element with no other class is the rule's intended target.
				if (others.length) out.push(others.join("."));
			}
			return out;
		}, cls);
		if (!found.length) continue;
		const key = cls;
		hits.set(key, new Set([...(hits.get(key) ?? []), ...found]));
	}
}
await browser.close();

const byClass = [...hits].sort((a, b) => b[1].size - a[1].size);
console.log(
	`\n${byClass.length} bare state classes land on elements that carry a component class of their own:\n`,
);
for (const [cls, targets] of byClass) {
	const where = arms.filter((a) => a.cls === cls).map((a) => a.file);
	console.log(`.${cls}  (rules in ${[...new Set(where)].join(", ")})`);
	for (const t of [...targets].sort().slice(0, 8)) console.log(`    .${t}`);
	if (targets.size > 8) console.log(`    … ${targets.size - 8} more`);
	console.log();
}
console.log("Each line is a candidate, not a verdict: some of these compose on purpose.");
console.log("Check whether the bare rule sets anything the component did not ask for.");
