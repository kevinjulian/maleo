import { expect, test } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { AccordionSection } from "./primitives.tsx";

for (const open of [false, true])
	test(`accordion SVG disclosure while ${open ? "open" : "closed"}`, () => {
		const html = renderToStaticMarkup(
			<AccordionSection label="Transform" open={open}>
				<input aria-label="Rotation" />
			</AccordionSection>,
		);
		expect(html).toContain(`aria-expanded="${open}"`);
		expect(html).toContain('<svg aria-hidden="true"');
		expect(html).toContain(open ? 'd="m6 9 6 6 6-6"' : 'd="m9 6 6 6-6 6"');
		expect(html.includes('aria-label="Rotation"')).toBe(open);
		expect(html).not.toContain("⌄");
	});
