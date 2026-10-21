import { describe, expect, test } from "bun:test";
import { buildProviderImageInput } from "./impl.ts";

const styleJson = JSON.stringify({
	aspect: "9:16",
	reference_urls: ["http://legacy/ref.png"],
	intent: {
		output: { kind: "single-image", aspect: "9:16", fullFrame: true },
		subjectLocks: [],
		scene: { visualMoment: "sleepy @Sketch Stickman" },
		constraints: { mustInclude: [], mustAvoid: [] },
		negative: [],
		references: [
			{
				url: "http://managed/ref.png",
				role: "character",
				label: "Sketch Stickman",
				description: "simple line sketch",
			},
		],
	},
});

describe("buildProviderImageInput", () => {
	test("uses intent and native refs after provider selection", () => {
		const input = buildProviderImageInput("legacy prompt", styleJson, {
			mode: "native",
			maxImages: 4,
		});
		expect(input.aspect).toBe("9:16");
		expect(input.referenceUrls).toEqual(["http://managed/ref.png"]);
		expect(input.prompt).toContain("Image 1 = Sketch Stickman");
		expect(input.prompt).not.toContain("@Sketch");
	});

	test("uses intent text-only refs without reference urls", () => {
		const input = buildProviderImageInput("legacy prompt", styleJson, { mode: "text-only" });
		expect(input.referenceUrls).toBeUndefined();
		expect(input.prompt).toContain("Reference brief:");
		expect(input.prompt).not.toContain("Image 1");
	});

	test("preserves raw prompt and urls when no intent is present", () => {
		const input = buildProviderImageInput(
			"legacy prompt",
			JSON.stringify({ aspect: "1:1", reference_urls: ["http://legacy/ref.png"] }),
			{ mode: "text-only" },
		);
		expect(input).toEqual({
			prompt: "legacy prompt",
			aspect: "1:1",
			referenceUrls: ["http://legacy/ref.png"],
		});
	});

	test("rejects invalid structured intent instead of submitting raw prompt", () => {
		expect(() =>
			buildProviderImageInput(
				"raw prompt",
				JSON.stringify({ intent: { scene: { visualMoment: "bee" } } }),
				{ mode: "text-only" },
			),
		).toThrow();
	});
});
