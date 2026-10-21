/* Every rule in a layered stylesheet stays inside its layer.
 *
 * A stylesheet that declares `@layer feature { ... }` puts its rules at that
 * layer's precedence. A rule appended AFTER the closing brace is unlayered — and
 * unlayered rules beat every layered one regardless of specificity, so the stray
 * rule silently outranks the whole design system. Nothing about the file looks
 * wrong: the braces balance, the CSS parses, the styles mostly apply.
 *
 * This is a real footgun rather than a hypothetical: appending to the end of a
 * stylesheet is the obvious way to add rules, and it is exactly the wrong one
 * here. Two blocks landed outside their layer this way before this test existed.
 */
import { describe, expect, test } from "vite-plus/test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dirname, "..");

function stylesheets(): string[] {
	return readdirSync(SRC, { recursive: true, encoding: "utf8" })
		.filter((path) => path.endsWith(".css"))
		.map((path) => join(SRC, path))
		.sort();
}

/** Strip comments and string literals so braces inside them cannot skew the count. */
function stripNoise(css: string): string {
	return css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/"[^"\n]*"|'[^'\n]*'/g, '""');
}

/** The selectors sitting at brace depth 0 in a file that declares a layer. */
function unlayeredRules(css: string): string[] {
	const src = stripNoise(css);
	const out: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < src.length; i++) {
		const ch = src[i];
		if (ch === "{") {
			if (depth === 0) {
				const selector = src.slice(start, i).trim();
				// An at-rule opening a block at depth 0 is the layer itself (or a
				// media/supports wrapper); a bare selector there is the bug.
				if (selector && !selector.startsWith("@")) out.push(selector.split("\n").pop()!.trim());
			}
			depth++;
		} else if (ch === "}") {
			depth = Math.max(0, depth - 1);
			if (depth === 0) start = i + 1;
		}
	}
	return out;
}

describe("cascade layers", () => {
	test("there is at least one layered stylesheet to check", () => {
		const layered = stylesheets().filter((file) => readFileSync(file, "utf8").includes("@layer"));
		expect(layered.length).toBeGreaterThan(0);
	});

	/* Sheets that are unlayered on purpose. Every other sheet is checked, not only
	 * those that already declare a layer: seven sheets with no `@layer` at all once
	 * passed this test, and an unlayered sheet's order against the others is the
	 * bundler's — one file per sheet in development, one merged chunk in
	 * production — so the same rules rendered the editor-studio rail at 16px in
	 * development and 12px in production. */
	const UNLAYERED_SHEETS = new Set([
		"design-system/tokens/tokens.css", // custom properties on :root and .dark, not rules a layer ranks
		"app/styles/touch.css", // outranks the feature sheets on purpose; see its header
		"app/styles/shadcn.css", // Tailwind's @theme, compiled away before the cascade
	]);

	test("no rule sits outside a cascade layer", () => {
		const offenders: string[] = [];
		for (const file of stylesheets()) {
			const sheet = file.slice(SRC.length + 1);
			if (UNLAYERED_SHEETS.has(sheet)) continue;
			for (const selector of unlayeredRules(readFileSync(file, "utf8")))
				offenders.push(`${sheet}: ${selector}`);
		}
		expect(offenders).toEqual([]);
	});

	test("every layered stylesheet still has balanced braces", () => {
		for (const file of stylesheets()) {
			const src = stripNoise(readFileSync(file, "utf8"));
			let depth = 0;
			for (const ch of src) depth += ch === "{" ? 1 : ch === "}" ? -1 : 0;
			expect({ file: file.slice(SRC.length + 1), depth }).toEqual({
				file: file.slice(SRC.length + 1),
				depth: 0,
			});
		}
	});
});

/* The two stylesheets this change appended to, named explicitly. The sweep above
 * would catch a regression anywhere; these say which files were the reason. */
describe("the Project Materials stylesheets", () => {
	const layeredDepthOf = (file: string, needle: string): number => {
		const src = stripNoise(readFileSync(join(SRC, file), "utf8"));
		let depth = 0;
		for (const ch of src.slice(0, src.indexOf(needle)))
			depth += ch === "{" ? 1 : ch === "}" ? -1 : 0;
		return depth;
	};

	test("the editor drawer's rules are layered", () => {
		expect(
			layeredDepthOf("components/timeline/stage.css", ".tl2-materials {"),
		).toBeGreaterThanOrEqual(1);
	});

	/* The reference picker's styles moved beside the shared component: the Library
	 * page does not load the timeline stylesheet, so leaving them there rendered the
	 * picker unstyled on one of its two surfaces. */
	test("the shared reference picker's rules are layered", () => {
		expect(
			layeredDepthOf("components/catalog/material-assets.css", ".tl2-materials-assets {"),
		).toBeGreaterThanOrEqual(1);
	});

	test("the create flow's rules are layered", () => {
		expect(
			layeredDepthOf("components/editor/create-content.css", ".cv-materials-rows"),
		).toBeGreaterThanOrEqual(1);
	});
});

/* Layer ORDER, as opposed to layer membership.
 *
 * A layer's position is fixed where its name first appears, and the bundler
 * emits each feature sheet as its own stylesheet ahead of `styles.css`. So the
 * only declaration that governs order is the inline one in `index.html`, which
 * loads before every sheet. A layer named in `styles.css` but missing there is
 * created late — after `feature` — and silently outranks the whole app.
 *
 * This is not hypothetical: `vui` was added to the `styles.css` statement and
 * not to `index.html`, which put package defaults above every app override.
 * `.tl2-content-vui-shell { display: contents }` lost to VUI's own `display`,
 * the content timeline overflowed its grid row, and it read as a phone layout
 * bug rather than a cascade one. */
describe("cascade layer order", () => {
	const orderIn = (text: string): string[] | null => {
		const match = /@layer\s+([a-z-]+(?:\s*,\s*[a-z-]+)+)\s*;/.exec(text);
		return match ? match[1]!.split(",").map((name) => name.trim()) : null;
	};

	test("index.html declares the order, before any stylesheet loads", () => {
		const html = readFileSync(join(SRC, "app/index.html"), "utf8");
		const order = orderIn(html);
		expect(order, "index.html must declare the layer order inline").not.toBeNull();
		/* `workspace` holds the editor workspace's structure (formerly @maleo/vui's
		 * `vui` layer); every app layer must outrank it. */
		expect(order).toContain("workspace");
		expect(order!.indexOf("workspace")).toBeLessThan(order!.indexOf("feature"));
	});

	test("styles.css declares the same order, so the two cannot drift", () => {
		const html = orderIn(readFileSync(join(SRC, "app/index.html"), "utf8"));
		const css = orderIn(readFileSync(join(SRC, "app/styles.css"), "utf8"));
		expect(css).toEqual(html);
	});
});
