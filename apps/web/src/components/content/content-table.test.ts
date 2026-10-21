import { expect, test } from "vite-plus/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContentTable } from "./content-table.tsx";

// Assert presented facts and activation semantics; browser suite proves geometry
// and navigation rather than pinning a feature's implementation class names.
test("project views retain title, dates, type and truthful duration", () => {
	for (const view of ["list", "grid"] as const) {
		const html = renderToStaticMarkup(
			createElement(ContentTable, {
				view,
				onOpen: () => {},
				rows: [
					{
						projectId: "p",
						title: "Coffee story",
						type: "video",
						createdAt: 10,
						updatedAt: 20,
						thumbnailUrl: null,
						durationSec: null,
					},
				],
			}),
		);
		for (const fact of [
			"Coffee story",
			"created",
			"edited",
			"video",
			"Duration unknown",
			"No preview",
		])
			expect(html).toContain(fact);
		expect(html).toContain('type="button"');
		expect(html).toContain('aria-label="Coffee story"');
		expect(html).toContain(`data-layout="${view}"`);
	}
});
