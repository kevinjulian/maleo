import { expect, test } from "vite-plus/test";
import { VISUAL_PRIMITIVE_IDS } from "@maleo/shared";
import { elementKindOfPreset, templateElementGroup, textOnlyPresets } from "./element-groups.ts";
test("plain text, five shapes and user motion have separate groups", () => {
	expect(textOnlyPresets([...VISUAL_PRIMITIVE_IDS, "motion-comp"])).toEqual(["plain"]);
	expect(VISUAL_PRIMITIVE_IDS.map(elementKindOfPreset)).toEqual([
		"text",
		"shapes",
		"shapes",
		"shapes",
		"shapes",
		"shapes",
	]);
	expect(elementKindOfPreset("motion-comp")).toBe("motion");
});

test("saved primitive variants stay outside Motion", () => {
	expect(templateElementGroup({ kind: "text", base: "plain" })).toBe("text");
	expect(templateElementGroup({ kind: "text", base: "shape-star" })).toBe("shapes");
	expect(templateElementGroup({ kind: "composition", base: "composition" })).toBe("motion");
});
