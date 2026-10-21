import { describe, expect, it } from "vite-plus/test";
import { deriveBranding } from "./branding.ts";

describe("deriveBranding", () => {
	it("uses config branding when provided", () => {
		const b = deriveBranding("kunti", {
			color: "#dc2626",
			color_bright: "#f87171",
			color_deep: "#991b1b",
			tagline: "kuntilanak twitter · receh",
			initials: "ku",
		});
		expect(b.color).toBe("#dc2626");
		expect(b.color_bright).toBe("#f87171");
		expect(b.color_deep).toBe("#991b1b");
		expect(b.tagline).toBe("kuntilanak twitter · receh");
		expect(b.initials).toBe("KU"); // upper-cased
	});

	it("generates hex colors from the name when branding omitted", () => {
		const b = deriveBranding("newworkspace", { tagline: "custom" });
		expect(b.tagline).toBe("custom");
		expect(b.color).toMatch(/^#[0-9a-f]{6}$/i);
		expect(b.color_bright).toMatch(/^#[0-9a-f]{6}$/i);
		expect(b.color_deep).toMatch(/^#[0-9a-f]{6}$/i);
		expect(b.initials).toBe("NE");
	});

	it("is deterministic for a given name", () => {
		expect(deriveBranding("zzz")).toEqual(deriveBranding("zzz"));
	});

	it("gives different hues to different names (no fixed palette collisions)", () => {
		const names = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];
		const colors = names.map((n) => deriveBranding(n).color);
		expect(new Set(colors).size).toBe(names.length);
	});

	it("treats null branding as fully derived", () => {
		const b = deriveBranding("ghost", null);
		expect(b.tagline).toBe("workspace");
		expect(b.initials).toBe("GH");
	});

	it("ignores null fields and falls back per-field", () => {
		const b = deriveBranding("mix", {
			color: "#123456",
			color_bright: null,
			tagline: null,
		});
		expect(b.color).toBe("#123456");
		expect(b.color_bright).toMatch(/^#[0-9a-f]{6}$/i);
		expect(b.tagline).toBe("workspace");
	});
});
