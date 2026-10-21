/* The editor workspace's styling boundary, as a check rather than a paragraph.
 *
 * Until migrate-editor-to-shared-rust-core task 3.5 this held two owners apart:
 * @maleo/vui's stylesheet and the app, joined by one palette seam in
 * app/styles.css. The stylesheet is the app's now
 * (components/editor-workspace/editor-workspace.css), so the boundary is
 * between that one sheet and every other:
 *
 *   - The workspace's surface tokens (`--vui-surface`, `--vui-fg`, …) are
 *     declared once, in that sheet, resolved to the app's palette there.
 *   - A cluster sheet may still override a `--vui-<component>-*` token on its
 *     own element — the timeline sets `--vui-accordion-*` twice, at two
 *     densities.
 *   - Nothing declares a `--vui-*` on `:root`, and only that sheet defines a
 *     `.vui-*` class.
 */
import { describe, expect, test } from "vite-plus/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const APP = join(import.meta.dirname, "..");

function sheets(root: string): string[] {
	return readdirSync(root).flatMap((name) => {
		const path = join(root, name);
		if (statSync(path).isDirectory()) return sheets(path);
		return path.endsWith(".css") ? [path] : [];
	});
}

/** Rule bodies keyed by their selector, comments stripped. */
function rules(css: string): Array<{ selector: string; body: string }> {
	const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
	return [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
		selector: m[1].trim(),
		body: m[2],
	}));
}

describe("the editor workspace sheet owns its tokens and classes", () => {
	test("no app stylesheet puts a VUI token on :root", () => {
		const offenders = sheets(APP).flatMap((path) =>
			rules(readFileSync(path, "utf8"))
				.filter((rule) => /(^|,)\s*:root\s*$/.test(rule.selector) && /--vui-/.test(rule.body))
				.map(() => relative(APP, path)),
		);
		expect(offenders).toEqual([]);
	});

	test("the workspace surface tokens are declared once, in the workspace sheet", () => {
		const owner = join(APP, "components/editor-workspace/editor-workspace.css");
		const css = readFileSync(owner, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
		const declared = [...css.matchAll(/--vui-(bg|surface|surface-raised|border|fg|muted|accent):/g)]
			.map((m) => m[1])
			.sort();
		expect(declared).toEqual([
			"accent",
			"bg",
			"border",
			"fg",
			"muted",
			"surface",
			"surface-raised",
		]);
	});

	test("another sheet configures the workspace only through a component token on its own element", () => {
		const offenders: string[] = [];
		for (const path of sheets(APP)) {
			if (path.endsWith("components/editor-workspace/editor-workspace.css")) continue;
			for (const rule of rules(readFileSync(path, "utf8"))) {
				const tokens = [...rule.body.matchAll(/--vui-([a-z-]+):/g)].map((m) => m[1]);
				/* A bare surface token (`--vui-fg`) outside the seam is the app
				 * redefining VUI's palette; a component token (`--vui-accordion-…`)
				 * is the app configuring one component, which is the contract. */
				const bare = tokens.filter((token) => !token.includes("-"));
				if (bare.length) offenders.push(`${relative(APP, path)}: ${bare.join(", ")}`);
			}
		}
		expect(offenders).toEqual([]);
	});

	test("only the workspace sheet defines a VUI class", () => {
		const offenders = sheets(APP)
			.filter((path) => !path.endsWith("components/editor-workspace/editor-workspace.css"))
			.filter((path) =>
				/^\s*\.vui-/m.test(readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "")),
			)
			.map((path) => relative(APP, path));
		expect(offenders).toEqual([]);
	});
});
