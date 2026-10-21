import { expect, test } from "vite-plus/test";
import { readFile } from "node:fs/promises";

/* The editor workspace's structural stylesheet, moved from @maleo/vui (task 3.5). */
const css = await readFile(new URL("./editor-workspace.css", import.meta.url), "utf8");
// Declarations compared on one line: whitespace between CSS tokens is not meaningful.
const flat = css.replace(/\s+/g, " ");

test("the workspace stylesheet is layered and scoped", () => {
	expect(css).toContain("@layer workspace {");
	expect(css).not.toMatch(/:root\b/);
	for (const match of css.matchAll(/^\s*([^@][^{]+)\{/gm)) {
		const selector = match[1]!.trim();
		if (selector.includes(".vui-")) expect(selector).toContain("[data-vui-root]");
	}
});

test("fullscreen keeps safe-area padding and dynamic viewport sizing", () => {
	expect(flat).toContain("--vui-safe-area-top: env(safe-area-inset-top, 0px)");
	expect(flat).toContain(
		"padding: var(--vui-safe-area-top) var(--vui-safe-area-right) var(--vui-safe-area-bottom) var(--vui-safe-area-left)",
	);
	expect(flat).toContain(
		".vui-workspace-fullscreen .vui-overlay-dialog { width: 100%; height: 100%; }",
	);
	expect(flat).not.toContain(".vui-workspace-fullscreen { padding: 0;");
});

test("workspace layout branches on containing width", () => {
	expect(flat).toContain("container-type: inline-size");
	expect(flat).toContain("@container (min-width: 701px) and (max-width: 999px)");
	expect(flat).toContain("@container (min-width: 1000px)");
	expect(flat).toContain(".vui-workspace-embedded { position: relative; inset: auto; }");
	expect(flat).toContain(".vui-workspace-modal .vui-workspace-header");
	expect(flat).toContain(
		"grid-template-rows: minmax(180px, 1fr) minmax(150px, 35dvh); flex: 1 1 0; overflow: hidden;",
	);
	expect(flat).toContain(
		"grid-template-rows: minmax(140px, 1fr) minmax(150px, 35dvh); flex: 1 1 0; overflow: hidden;",
	);
});

test("the shell stylesheet declares every token it reads", () => {
	/* This sheet styles the SHELL — workspace, overlay, sheet, accordion,
	 * inspector rail, transport, preview — and nothing else. Its timeline half
	 * went with the primitives it styled, so the README's token table now
	 * describes `theme.css`, and `theme.test.ts` checks that table both ways.
	 *
	 * What is still worth pinning here is narrower and belongs to this file: a
	 * token this sheet READS must be one it also DECLARES, or a consumer who
	 * imports it alone gets a rule resolving to nothing. */
	/* Not anchored to the line start: this sheet declares the four safe-area
	 * tokens on one line, separated by semicolons, and an anchored match found
	 * only the first of them. */
	const declared = new Set(
		[...css.matchAll(/(--vui-[a-z0-9-]+):\s*[^;}]/g)].map((match) => match[1]!),
	);
	const read = new Set([...css.matchAll(/var\((--vui-[a-z0-9-]+)/g)].map((match) => match[1]!));
	expect(read.size).toBeGreaterThan(10);
	for (const token of read)
		expect(declared.has(token), `${token} is read but never declared`).toBe(true);
	/* And the timeline tokens are gone with the rules that read them. */
	for (const token of ["--vui-lane-height", "--vui-range"])
		expect(declared.has(token), `${token} outlived the timeline stylesheet`).toBe(false);
});

/* The accordion spaces itself from tokens.
 *
 * The contract tells consumers to override tokens before slots. A component
 * whose padding is a literal makes that untrue: the override resolves against
 * nothing, the consumer sees no change, and the only thing left is the private
 * class name the same contract forbids reaching for. Asserted on the rule rather
 * than on a computed style, because what is being claimed is that the rule reads
 * the token — the browser check that it MOVES lives in the app's visual suite,
 * where a real stylesheet is loaded. */
test("the accordion's metrics come from tokens, not from literals", () => {
	const tokens = [
		"--vui-accordion-header-height",
		"--vui-accordion-padding-inline",
		"--vui-accordion-gap",
		"--vui-accordion-body-padding-bottom",
	];
	for (const token of tokens) expect(css, `${token} is declared`).toContain(`${token}:`);

	const header = css.match(/\.vui-accordion > button \{([^}]*)\}/)![1]!;
	const body = css.match(/\.vui-accordion-body \{([^}]*)\}/)![1]!;
	for (const [name, rule] of [
		["header", header],
		["body", body],
	] as const) {
		expect(rule, `the accordion ${name} reads a token`).toMatch(/var\(--vui-accordion-/);
		/* No literal length on the properties the tokens own. Colours and borders
		 * are not in question here; padding, gap and height are. */
		expect(
			/(?:padding|gap|min-height):[^;]*\d+px/.test(rule),
			`the accordion ${name} still hardcodes a length`,
		).toBe(false);
	}
});
