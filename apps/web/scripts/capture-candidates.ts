/* Screenshot every inventory candidate, light and dark.
 *
 * The pixels have to be the product's own. The alternative — rebuilding each
 * component in a design tool's shapes — produces a drawing of what someone
 * believed the component looks like, and when it drifts the design tool holds a
 * confident wrong copy. So this loads the running application, mounts the
 * fixtures into it, and photographs the result: the CSS is the compiled bundle
 * the product ships, not a re-linked subset of it.
 *
 * It mounts fixtures rather than hunting instances in the real UI. Hunting is
 * higher fidelity and needs a route, a state and a crop target per candidate,
 * and several candidates have no reachable instance at all. The trade is
 * recorded in fixtures.ts: this proves the stylesheet, not the call sites.
 *
 * Determinism is borrowed from the visual suite — same viewport, device scale,
 * locale and timezone — because the inventory has to regenerate byte-identically
 * at one commit.
 *
 * Run: bun run --cwd apps/web capture:candidates   (needs the web dev server)
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
// From @playwright/test, which the visual suite already depends on — the bare
// `playwright` package is not installed and adding it would duplicate it.
import { chromium } from "@playwright/test";
import { FIXTURES } from "../visual/inventory/fixtures.ts";

const BASE = process.env.MALEO_WEB_URL ?? "http://127.0.0.1:3030";
const OUT = resolve(import.meta.dir, "..", "..", "..", "build", "ui-inventory", "shots");

/* The mount sits over the application rather than replacing it: the app keeps
 * rendering underneath, so nothing it does on unmount can strip the stylesheet
 * out from under the capture. */
const MOUNT_ID = "__candidate_mount__";

/** One element as the browser resolved it: its box, and the properties that decide appearance. */
type Node = {
	tag: string;
	cls: string;
	text: string;
	box: Record<string, number>;
	style: Record<string, string | string[]>;
	children: Node[];
};
/** One fixture variant, measured in one theme. */
type Measured = { id: string; variant: string; theme: string; tree: Node[] };
/** A measured value once browser defaults are dropped: px become numbers. */
type StyleValue = string | number | Array<string | number>;
/** The rebuild-facing shape: `b` is [x, y, w, h] relative to the fixture. */
type SpecNode = {
	t: string;
	b: number[];
	s: Record<string, StyleValue>;
	c?: string;
	x?: string;
	k?: SpecNode[];
};

const page = await (async () => {
	const browser = await chromium.launch();
	const context = await browser.newContext({
		viewport: { width: 1280, height: 900 },
		deviceScaleFactor: 2, // legible when a designer zooms a card
		locale: "en-US",
		timezoneId: "UTC",
		colorScheme: "light",
		reducedMotion: "reduce", // a transition mid-capture is a flaky pixel
	});
	const p = await context.newPage();
	const res = await p.goto(BASE, { waitUntil: "domcontentloaded" }).catch(() => null);
	if (!res || !res.ok()) {
		console.error(`capture-candidates: ${BASE} did not respond — start it with \`bun run web\``);
		process.exit(1);
	}
	// The stylesheet is the whole point; wait for it rather than for the app.
	await p.waitForFunction(
		() => {
			const probe = document.createElement("div");
			probe.className = "cv-input";
			document.body.appendChild(probe);
			const seen = getComputedStyle(probe).borderRadius !== "0px";
			probe.remove();
			return seen;
		},
		undefined,
		{ timeout: 30_000 },
	);
	return p;
})();

await page.evaluate((id) => {
	const host = document.createElement("div");
	host.id = id;
	Object.assign(host.style, {
		position: "fixed",
		inset: "0",
		zIndex: "2147483647",
		background: "var(--bg)",
		padding: "40px",
		overflow: "auto",
	});
	document.body.appendChild(host);
}, MOUNT_ID);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const shots: Array<{ id: string; variant: string; theme: string; file: string }> = [];
const skipped: Array<{ id: string; reason: string }> = [];
/* Resolved geometry and colour for every element of every fixture.
 *
 * This is what makes rebuilding a candidate as native design-tool shapes honest
 * rather than a guess. The alternative is reading `padding: 10px 16px` and
 * `background: var(--surface)` out of the stylesheet and resolving them by hand
 * — a small CSS engine, and one whose output nothing checks. getComputedStyle
 * has already done that work exactly, cascade, inheritance and custom
 * properties included, so the numbers below are the browser's own. */
const styles: Measured[] = [];

for (const theme of ["light", "dark"] as const) {
	await page.evaluate(
		(t) => document.documentElement.classList.toggle("dark", t === "dark"),
		theme,
	);
	for (const fixture of FIXTURES) {
		if (!fixture.variants.length) {
			if (theme === "light")
				skipped.push({ id: fixture.id, reason: fixture.noIsolatedAppearance ?? "no fixture" });
			continue;
		}
		for (const variant of fixture.variants) {
			/* innerHTML with fixture markup: the strings come from fixtures.ts in
			 * this repository, never from input, and they run in a throwaway local
			 * browser that is closed at the end of this script. Rendering them as
			 * markup is the entire point — textContent would photograph the source. */
			await page.evaluate(
				({ id, html, width }) => {
					const host = document.getElementById(id)!;
					host.innerHTML = `<div id="__shot__" style="display:inline-block;${width ? `width:${width}px;` : ""}"></div>`;
					document.getElementById("__shot__")!.innerHTML = html;
				},
				{ id: MOUNT_ID, html: variant.html, width: fixture.width },
			);
			// Fonts settle after the first paint; a half-rendered glyph is a diff.
			await page.evaluate(() => document.fonts.ready);
			const target = page.locator("#__shot__");
			const safe = fixture.id.replace(/[^a-z0-9]+/gi, "-");
			const file = `${safe}--${variant.label.replace(/[^a-z0-9]+/gi, "-")}--${theme}.png`;
			await target.screenshot({ path: resolve(OUT, file), animations: "disabled" });
			shots.push({ id: fixture.id, variant: variant.label, theme, file });

			const tree = await page.evaluate(() => {
				const host = document.getElementById("__shot__")!;
				/* Give every text run its own box.
				 *
				 * A button's label is a bare text node between the icon and the edge,
				 * so it has no rect of its own and its position can only be inferred
				 * from padding, gap and the icon's width — which is guesswork exactly
				 * where the rebuild needs certainty. An inline span inherits every
				 * inherited property and adds no box of its own, so wrapping changes
				 * what can be measured without changing what is laid out. */
				const wrap = (el: Element): void => {
					/* Snapshot before mutating: replaceWith() below edits this parent's
					 * child list, and iterating the live NodeList while doing so skips
					 * siblings. */
					const children = Array.from(el.childNodes);
					for (const node of children) {
						if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim()) {
							const span = document.createElement("span");
							span.dataset.run = "1";
							node.replaceWith(span);
							span.appendChild(node);
							continue;
						}
						if (node.nodeType !== Node.ELEMENT_NODE) continue;
						// SAFETY: nodeType === ELEMENT_NODE is what makes a Node an
						// Element, and it is checked on the line above.
						wrap(node as Element);
					}
				};
				wrap(host);
				const origin = host.getBoundingClientRect();
				const read = (el: Element): Node => {
					const c = getComputedStyle(el);
					const r = el.getBoundingClientRect();
					/* Only the text a node owns directly. Taking textContent would
					 * repeat every descendant's words at each level up the tree. */
					const own = [...el.childNodes]
						.filter((n) => n.nodeType === 3)
						.map((n) => n.textContent ?? "")
						.join("")
						.replace(/\s+/g, " ")
						.trim();
					return {
						tag: el.tagName.toLowerCase(),
						cls: el.getAttribute("class") ?? "",
						text: own,
						// Relative to the fixture, so a shape can be placed without
						// knowing where in the viewport the capture happened.
						box: {
							x: Math.round((r.x - origin.x) * 100) / 100,
							y: Math.round((r.y - origin.y) * 100) / 100,
							w: Math.round(r.width * 100) / 100,
							h: Math.round(r.height * 100) / 100,
						},
						style: {
							display: c.display,
							flexDirection: c.flexDirection,
							alignItems: c.alignItems,
							justifyContent: c.justifyContent,
							gap: c.gap,
							padding: [c.paddingTop, c.paddingRight, c.paddingBottom, c.paddingLeft],
							background: c.backgroundColor,
							border: [
								c.borderTopWidth,
								c.borderRightWidth,
								c.borderBottomWidth,
								c.borderLeftWidth,
							],
							borderColor: c.borderTopColor,
							borderStyle: c.borderTopStyle,
							radius: [
								c.borderTopLeftRadius,
								c.borderTopRightRadius,
								c.borderBottomRightRadius,
								c.borderBottomLeftRadius,
							],
							color: c.color,
							fontFamily: c.fontFamily,
							fontSize: c.fontSize,
							fontWeight: c.fontWeight,
							lineHeight: c.lineHeight,
							letterSpacing: c.letterSpacing,
							textTransform: c.textTransform,
							boxShadow: c.boxShadow,
							opacity: c.opacity,
						},
						children: [...el.children].map(read),
					};
				};
				return [...host.children].map(read);
			});
			styles.push({ id: fixture.id, variant: variant.label, theme, tree });
		}
	}
}

writeFileSync(
	resolve(OUT, "index.json"),
	`${JSON.stringify({ base: BASE, shots, skipped }, null, "\t")}\n`,
);
writeFileSync(resolve(OUT, "styles.json"), `${JSON.stringify(styles)}\n`);

/* The same measurements with every browser default dropped, which is what a
 * rebuilder consumes. Emitted here rather than by a separate pass so it cannot
 * fall out of step with the capture it describes. */
const DEFAULTS: Record<string, string> = {
	display: "block",
	flexDirection: "row",
	alignItems: "normal",
	justifyContent: "normal",
	gap: "normal",
	background: "rgba(0, 0, 0, 0)",
	borderStyle: "none",
	textTransform: "none",
	boxShadow: "none",
	opacity: "1",
	borderColor: "rgba(0, 0, 0, 0)",
	letterSpacing: "normal",
};
const px = (v: string): number | string => {
	const n = Number.parseFloat(v);
	return v.endsWith("px") && Number.isFinite(n) ? Math.round(n * 100) / 100 : v;
};
const compact = (n: Node): SpecNode => {
	const s: Record<string, StyleValue> = {};
	for (const [k, v] of Object.entries(n.style)) {
		if (Array.isArray(v)) {
			const vals = v.map(px);
			// A side-list collapses to one number when all four agree.
			if (vals.some((x) => x !== 0)) s[k] = new Set(vals).size === 1 ? vals[0] : vals;
			continue;
		}
		if (DEFAULTS[k] === v) continue;
		if (k === "fontFamily") s[k] = v.split(",")[0]!.replace(/["']/g, "").trim();
		else if (k === "fontSize" || k === "lineHeight") s[k] = px(v);
		else s[k] = v;
	}
	const out: SpecNode = { t: n.tag, b: [n.box.x!, n.box.y!, n.box.w!, n.box.h!], s };
	if (n.cls) out.c = n.cls;
	if (n.text) out.x = n.text;
	const kids = n.children.map(compact);
	if (kids.length) out.k = kids;
	return out;
};
writeFileSync(
	resolve(OUT, "spec.json"),
	`${JSON.stringify(styles.map((e) => ({ id: e.id, v: e.variant, th: e.theme, n: e.tree.map(compact) })))}\n`,
);

await page.context().browser()?.close();
console.log(`captured ${shots.length} images for ${FIXTURES.length - skipped.length} candidates`);
if (skipped.length) {
	console.log(`no isolated appearance (${skipped.length}):`);
	for (const s of skipped) console.log(`  ${s.id} — ${s.reason.split(".")[0]}.`);
}
