/* The shared citation list.
 *
 * Static render only — this harness has no DOM or event layer — so the
 * assertions are about the COLLAPSED state, which is the state an operator sees
 * first and the one that has to tell them whether the quote was checked. The
 * expanded list is exercised by driving the surface in the app.
 */
import { describe, expect, test } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { SourceLinks } from "./source-links.tsx";

const URL_A = "https://www.iea.org/energy-system/buildings";
const URL_B = "https://arxiv.org/abs/2303.10130";

describe("collapsed citation chip", () => {
	/* "matches" and "sources" are not cosmetic. A matched quote survived
	 * validateQuotedEvidence against retrieved text; an unmatched url was cited
	 * and never confirmed. The chip is where that difference is visible. */
	test("validated evidence is labelled as matched, and counted", () => {
		const html = renderToStaticMarkup(
			<SourceLinks
				urls={[URL_A, URL_B]}
				evidence={[
					{ url: URL_A, quote: "Heat pumps are the central technology in the global transition" },
					{ url: URL_B, quote: "an early look at the labor market impact" },
				]}
			/>,
		);
		expect(html).toContain("2 evidence matches");
		expect(html).not.toContain("2 sources");
	});

	test("cited-but-unmatched urls are labelled as sources, not as evidence", () => {
		const html = renderToStaticMarkup(<SourceLinks urls={[URL_A]} />);
		expect(html).toContain("1 source");
		expect(html).not.toContain("evidence match");
	});

	test("the singular is used for one of either", () => {
		expect(renderToStaticMarkup(<SourceLinks urls={[URL_A]} />)).toContain("1 source");
		expect(
			renderToStaticMarkup(
				<SourceLinks urls={[URL_A]} evidence={[{ url: URL_A, quote: "one quote" }]} />,
			),
		).toContain("1 evidence match");
	});

	/* Collapsed by default so a citation cannot lengthen a script row until the
	 * operator asks for it. The quote living behind the toggle is the point. */
	test("the quote and the link are behind the toggle, not in the collapsed row", () => {
		const html = renderToStaticMarkup(
			<SourceLinks urls={[URL_A]} evidence={[{ url: URL_A, quote: "the central technology" }]} />,
		);
		expect(html).not.toContain("the central technology");
		expect(html).not.toContain("iea.org ↗");
	});
});
