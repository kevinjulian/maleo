import { describe, expect, test } from "vite-plus/test";
import { titleForCrumb, titleForOutput, titleFromContent, titleSlug } from "./project-title.ts";

describe("titleFromContent", () => {
	test("each type reads its own first item, with a per-type fallback", () => {
		expect(titleFromContent({ type: "video", firstMarkerTitle: "Cold open" })).toBe("Cold open");
		expect(titleFromContent({ type: "video" })).toBe("Storyboard");
		expect(titleFromContent({ type: "image", firstSlideName: "Hook" })).toBe("Hook");
		expect(titleFromContent({ type: "image" })).toBe("Carousel");
		expect(titleFromContent({ type: "text", firstPostBody: "a thread about serums" })).toBe(
			"a thread about serums",
		);
		expect(titleFromContent({ type: "text" })).toBe("Draft");
	});

	// A project exists before its type is loaded; the editor renders in that gap.
	test("an unknown type has no derived title", () => {
		expect(titleFromContent({ type: null })).toBe("");
	});

	test("a long post body is cut to a title length", () => {
		const body = "x".repeat(60);
		expect(titleFromContent({ type: "text", firstPostBody: body })).toBe("x".repeat(32));
	});

	// Whitespace-only content is absent, not a title made of spaces.
	test("blank content falls back rather than titling with whitespace", () => {
		expect(titleFromContent({ type: "video", firstMarkerTitle: "   " })).toBe("Storyboard");
		expect(titleFromContent({ type: "image", firstSlideName: "  " })).toBe("Carousel");
	});
});

describe("titleSlug", () => {
	test("lowercases, collapses non-alphanumerics, and trims the dashes", () => {
		expect(titleSlug("Cold Open: part 2!")).toBe("cold-open-part-2");
		expect(titleSlug("  spaced  out  ")).toBe("spaced-out");
	});

	/* Empty rather than a fallback: the download wants "video", an output row
	 * wants something else, and a slug that picks for them sends one of them the
	 * wrong name. */
	test("unslugifiable input gives an empty string, not a default", () => {
		expect(titleSlug("")).toBe("");
		expect(titleSlug("!!!")).toBe("");
	});
});

describe("titleForCrumb", () => {
	test("the operator's own title wins over the derived one", () => {
		expect(titleForCrumb("My launch", "Storyboard")).toBe("My launch");
		expect(titleForCrumb("   ", "Storyboard")).toBe("Storyboard");
		expect(titleForCrumb(undefined, "Storyboard")).toBe("Storyboard");
		expect(titleForCrumb(undefined, "")).toBe("Untitled");
	});
});

describe("titleForOutput", () => {
	test("falls back to a per-type label", () => {
		expect(titleForOutput("Cold open", "video")).toBe("Cold open");
		expect(titleForOutput("", "image")).toBe("image deliverable");
		expect(titleForOutput("", null)).toBe("content deliverable");
	});
});
