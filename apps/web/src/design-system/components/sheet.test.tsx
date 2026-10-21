import { describe, expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { Sheet } from "./sheet.tsx";

/* Static render only. This cannot see whether a sheet is reachable in a real
 * tree — that is what the phone-width Playwright run in section 6 is for — but
 * it does hold the two things the primitive exists to guarantee: the edge is a
 * class the stylesheet knows, and the open state is not merely visual. */
const html = (el: React.ReactElement): string => renderToStaticMarkup(el);
const classOf = (el: React.ReactElement): string =>
	/<aside class="([^"]*)"/.exec(html(el))?.[1] ?? "";

const base = { onClose: () => {}, label: "test sheet", children: <p>body</p> };

describe("Sheet edges", () => {
	it("emits the edge class the stylesheet declares", () => {
		expect(classOf(<Sheet {...base} open edge="left" />)).toBe(
			"ui-sheet ui-sheet-left ui-sheet-open",
		);
		expect(classOf(<Sheet {...base} open edge="right" />)).toBe(
			"ui-sheet ui-sheet-right ui-sheet-open",
		);
		expect(classOf(<Sheet {...base} open edge="bottom" />)).toBe(
			"ui-sheet ui-sheet-bottom ui-sheet-open",
		);
	});
	it("defaults to the left edge", () => {
		expect(classOf(<Sheet {...base} open />)).toBe("ui-sheet ui-sheet-left ui-sheet-open");
	});
	it("omits the open token when closed", () => {
		expect(classOf(<Sheet {...base} open={false} edge="bottom" />)).toBe(
			"ui-sheet ui-sheet-bottom",
		);
	});
});

describe("Sheet class merging", () => {
	/* The primitive rule: a caller's className goes through cn(), not a
	 * template literal. A hand-rolled join is what produces "undefined" in a
	 * class attribute when the caller passes nothing. */
	it("keeps a caller's own className", () => {
		expect(classOf(<Sheet {...base} open edge="right" className="cv-chatpane" />)).toBe(
			"ui-sheet ui-sheet-right ui-sheet-open cv-chatpane",
		);
	});
	it("emits no stray tokens when no className is passed", () => {
		expect(classOf(<Sheet {...base} open />)).not.toContain("undefined");
	});
});

describe("Sheet closed state is inert, not just invisible", () => {
	/* A closed sheet stays mounted and is translated off-screen, so without
	 * these the keyboard tabs into a pane nobody can see. Asserted because the
	 * failure is invisible to sighted mouse use and to every screenshot. */
	it("marks a closed sheet hidden and inert", () => {
		const out = html(<Sheet {...base} open={false} />);
		expect(out).toContain('aria-hidden="true"');
		expect(out).toContain("inert");
	});
	it("marks an open sheet neither", () => {
		const out = html(<Sheet {...base} open />);
		expect(out).toContain('aria-hidden="false"');
		expect(out).not.toContain(" inert");
	});
});

describe("Sheet accessibility contract", () => {
	it("is a labelled modal dialog", () => {
		const out = html(<Sheet {...base} open label="Chat" />);
		expect(out).toContain('role="dialog"');
		expect(out).toContain('aria-modal="true"');
		expect(out).toContain('aria-label="Chat"');
	});
	it("renders a scrim alongside the pane", () => {
		expect(html(<Sheet {...base} open />)).toContain("ui-sheet-scrim ui-sheet-open");
	});
	it("passes size through as the sizing custom property", () => {
		expect(html(<Sheet {...base} open edge="bottom" size="60svh" />)).toContain(
			"--ui-sheet-size:60svh",
		);
	});
});
