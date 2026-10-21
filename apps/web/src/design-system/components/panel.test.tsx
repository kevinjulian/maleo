/* The containment contract, as a test rather than a paragraph.
 *
 * Panel and Section are two tiers kept as two because they are two jobs: a
 * Panel owns a width and scrolls, a Section groups controls inside it. The
 * third tier, Control (one labelled input), was replaced by PropertyRow. Convergence is allowed to change
 * how they look; it is not allowed to let one tier grow the next one's chrome,
 * which is how an inspector turns into a spreadsheet of nested boxes.
 *
 * Static render only. Whether the tiers are actually nested this way in the
 * running editor is what the editor walkthrough in 5.3 answers — what is held
 * here is that the primitives cannot emit each other.
 */
import { describe, expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { Panel, panelClassName, Section } from "./panel.tsx";

const html = (el: React.ReactElement): string => renderToStaticMarkup(el);

describe("containment tiers", () => {
	it("emits one tier's class each", () => {
		expect(html(<Panel />)).toBe('<aside class="tl2-panel"></aside>');
		expect(html(<Section />)).toBe('<section class="tl2-dsec"></section>');
	});

	it("nests Panel > Section without the inner tier wearing the outer class", () => {
		const markup = html(
			<Panel>
				<Section>
					<input aria-label="Opacity" />
				</Section>
			</Panel>,
		);
		expect(markup).toBe(
			'<aside class="tl2-panel"><section class="tl2-dsec"><input aria-label="Opacity"/></section></aside>',
		);
	});

	/* A tier inside itself is not supported, and the reason is visual rather
	 * than technical: `tl2-panel` carries a border and a background, so a Panel
	 * in a Panel draws a second frame around the same content. Nothing in the
	 * type system stops it, so the check is that no primitive does it for you. */
	it("adds no chrome of its own when a caller nests a tier in itself", () => {
		expect(
			html(
				<Section>
					<Section />
				</Section>,
			),
		).toBe('<section class="tl2-dsec"><section class="tl2-dsec"></section></section>');
	});

	it("keeps the sheet treatment on Panel and spells it the same way in both paths", () => {
		expect(html(<Panel sheet />)).toContain('class="tl2-panel tl2-panel-sheet"');
		expect(panelClassName({ sheet: true })).toBe("tl2-panel tl2-panel-sheet");
		expect(panelClassName()).toBe("tl2-panel");
	});
});
