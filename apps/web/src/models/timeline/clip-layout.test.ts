import { expect, test } from "vite-plus/test";
import type { ClipLayout } from "@maleo/shared";
import { normalizeLayout } from "./clip-layout.ts";

test("a malformed compositing or animation field is dropped on read instead of breaking the editor", () => {
	const corrupt = {
		xPct: 10,
		mask: { shape: "path" },
		color: { brightness: Number.NaN },
		blendMode: "overlay",
		animation: { tracks: { x: [{ t: -1, v: 0 }] } },
	} as unknown as Partial<ClipLayout>;
	const layout = normalizeLayout(corrupt, "video");
	expect(layout.xPct).toBe(10);
	expect(layout).not.toHaveProperty("mask");
	expect(layout).not.toHaveProperty("color");
	expect(layout).not.toHaveProperty("blendMode");
	expect(layout).not.toHaveProperty("animation");
});

test("valid fields and an explicit mask removal survive", () => {
	expect(normalizeLayout({ mask: null, blendMode: "multiply" }, "image")).toMatchObject({
		mask: null,
		blendMode: "multiply",
	});
});
