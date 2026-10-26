import { expect, test } from "vite-plus/test";
import { findTextTemplate, TEMPLATE_ITEMS } from "@models/clip-templates/registry.ts";
test("retained catalogue has one text primitive and five shapes", () => {
	expect(TEMPLATE_ITEMS).toHaveLength(6);
	expect(findTextTemplate("shape-star")?.fields.map((f) => f.key)).toEqual([
		"fill",
		"stroke",
		"strokeWidth",
		"opacity",
	]);
	expect(findTextTemplate("shape-rect")?.fields.map((f) => f.key)).toContain("radius");
	expect(findTextTemplate("plain")?.fields).toEqual([]);
});
