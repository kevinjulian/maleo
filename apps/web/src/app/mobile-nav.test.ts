import { describe, expect, it } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { viewToMobileTab } from "./app.tsx";

/* The mobile "Images" tab used to open the References library while the desktop
 * rail's "Images" opened the lab, and viewToMobileTab was written to agree with the
 * broken one — so References lit a tab that did not lead there, which made the
 * divergence look intentional. Both halves are asserted here.
 *
 * The destination is now the gallery. standardize-page-chrome pointed it at the lab
 * as an interim step, when the lab was the only images surface there was. */

describe("mobile tab derivation", () => {
	it("marks both images destinations as the images tab", () => {
		// One nav entry, two destinations: the gallery and the lab beneath it.
		expect(viewToMobileTab({ kind: "images" })).toBe("images");
		expect(viewToMobileTab({ kind: "imagelab" })).toBe("images");
	});

	it("does not let the references library claim the images tab", () => {
		expect(viewToMobileTab({ kind: "library", type: "references" })).toBe("none");
	});

	it("leaves every tab unlit for surfaces the bottom bar does not reach", () => {
		for (const type of [
			"references",
			"voices",
			"presets",
			"materials",
			"templates",
			"elements",
		] as const) {
			expect(viewToMobileTab({ kind: "library", type })).toBe("none");
		}
	});

	it("maps the surfaces the bottom bar does reach", () => {
		expect(viewToMobileTab({ kind: "content" })).toBe("content");
		expect(viewToMobileTab({ kind: "content-edit", id: "p1" })).toBe("content");
		expect(viewToMobileTab({ kind: "create" })).toBe("create");
		expect(viewToMobileTab({ kind: "video" })).toBe("video");
		expect(viewToMobileTab({ kind: "god", section: "users" })).toBe("none");
	});
});

describe("mobile nav destinations", () => {
	it("sends the images tab to the gallery, like the desktop rail", () => {
		const src = readFileSync(`${import.meta.dirname}/app.tsx`, "utf8");
		expect(src).toMatch(/case "images":\s*return goImages\(\);/);
		// Neither the original bug nor the interim lab destination.
		expect(src).not.toMatch(/case "images":\s*return goLibrary\("references"\);/);
		expect(src).not.toMatch(/case "images":\s*return goImageLab\(\);/);
	});
});

describe("speech reaches the bottom bar", () => {
	it("lights the speech tab from both of its destinations", () => {
		expect(viewToMobileTab({ kind: "speech" })).toBe("speech");
		expect(viewToMobileTab({ kind: "speechlab" })).toBe("speech");
	});

	/* Adding a destination means touching five enumerations in app.tsx, and the
	   sidebar is the one that gets remembered. These are the four that do not. */
	it("is wired into the nav, the rail and the mobile handler", () => {
		const src = readFileSync(`${import.meta.dirname}/app.tsx`, "utf8");
		expect(src).toContain('{ tab: "speech", label: "Speech"');
		expect(src).toMatch(/case "speech":\s*return goSpeech\(\);/);
		// The rail lives in the shell cluster now; its entries are one table.
		const rail = readFileSync(`${import.meta.dirname}/../components/shell/app-sidebar.tsx`, "utf8");
		expect(rail).toContain('{ tab: "speech", label: "Speech"');
	});

	/* The lab is a full-height composer; the bottom bar would cover it, which is
	   why the image lab already hides it. */
	it("hides the bottom bar on the speech lab, as it does on the image lab", () => {
		const src = readFileSync(`${import.meta.dirname}/app.tsx`, "utf8");
		expect(src).toContain('view.kind !== "imagelab" && view.kind !== "speechlab"');
	});
});
