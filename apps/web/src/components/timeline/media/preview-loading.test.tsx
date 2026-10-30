// @vitest-environment happy-dom
import { describe, expect, test } from "vite-plus/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	ClipPreviewBadge,
	previewLoadingLabel,
	previewReadinessMessage,
	previewReadinessShort,
	type ClipReadiness,
} from "./preview-loading.tsx";

const clip = (state: ClipReadiness["state"]): ClipReadiness => ({
	id: "clip:1",
	state,
	loaded: state.state === "loading" ? state.loaded : 0,
	total: state.state === "loading" ? state.total : null,
	blockers: [],
});

describe("preview clip badge", () => {
	test("transport explanation counts clips and names failures", () => {
		expect(previewReadinessMessage([])).toBe("Preparing preview.");
		expect(previewReadinessMessage([clip({ state: "ready" }), clip({ state: "queued" })])).toBe(
			"Loading preview media: 1 of 2 clips ready.",
		);
		expect(previewReadinessMessage([clip({ state: "failed", message: "No local bytes" })])).toBe(
			"Preview unavailable: No local bytes",
		);
	});
	test("the toolbar form is short and counts ready clips", () => {
		expect(previewReadinessShort([])).toBe("Preparing preview");
		expect(previewReadinessShort([clip({ state: "ready" }), clip({ state: "queued" })])).toBe(
			"Preparing preview · 1/2",
		);
		expect(previewReadinessShort([clip({ state: "failed", message: "x" })])).toBe(
			"Preview unavailable",
		);
	});
	test.each([
		[{ state: "queued" }, "Preview queued"],
		[{ state: "loading", loaded: 40, total: 100 }, "Loading preview 40%"],
		[{ state: "loading", loaded: 40, total: null }, "Loading preview"],
		[{ state: "loading", loaded: 0, total: 0 }, "Loading preview"],
		[{ state: "validating" }, "Validating preview"],
		[{ state: "ready" }, "Preview ready"],
		[{ state: "failed", message: "Track cannot decode" }, "Preview failed: Track cannot decode"],
	] satisfies [ClipReadiness["state"], string][])(
		"names %j without input controls",
		(state, label) => {
			const value = clip(state);
			expect(previewLoadingLabel(value)).toBe(label);
			const host = document.createElement("div");
			host.innerHTML = renderToStaticMarkup(createElement(ClipPreviewBadge, { clip: value }));
			if (state.state === "ready") {
				// A ready clip shows nothing.
				expect(host.innerHTML).toBe("");
				return;
			}
			expect(host.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe(label);
			expect(host.querySelector("button, input, [tabindex]")).toBeNull();
			const line = host.querySelector(".tl2-clip-upload-line");
			expect(!!line).toBe(state.state !== "failed");
			if (state.state === "loading" && state.total === 100) {
				expect(line?.getAttribute("style")).toContain("--upload-progress:0.4");
				expect(host.querySelector('[data-preview-indeterminate="true"]')).toBeNull();
			} else if (line) {
				expect(host.querySelector('[data-preview-indeterminate="true"]')).not.toBeNull();
			}
		},
	);
});
