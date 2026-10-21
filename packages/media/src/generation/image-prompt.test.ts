import { describe, expect, test } from "vite-plus/test";
import type { ImagePromptIntent } from "@maleo/shared";
import { compileImagePrompt } from "./image-prompt.ts";

const baseIntent: ImagePromptIntent = {
	output: { kind: "single-image", aspect: "9:16", fullFrame: true },
	subjectLocks: [
		{
			source: "reference",
			role: "character",
			label: "Sketch Stickman",
			descriptors: ["simple stickman sketch", "white #FFFFFF background"],
			mustAvoid: ["realistic human"],
			referenceId: "sketch-stickman",
		},
	],
	scene: { visualMoment: "sleepy face with heavy eyelids" },
	composition: { shotType: "Medium Shot", movement: "Static" },
	style: { medium: "minimal hand-drawn sketch" },
	lightingColor: { mood: "quiet bedtime" },
	constraints: { mustInclude: [], mustAvoid: ["human hands"] },
	negative: ["watermark", "collage"],
	references: [
		{
			url: "http://localhost:3030/api/image-gen/files/stickman.png",
			role: "character",
			entityId: "sketch-stickman",
			label: "Sketch Stickman",
			description: "simple sketch stickman; no human hand",
		},
	],
};

describe("compileImagePrompt", () => {
	test("renders native reference binding and urls", () => {
		const out = compileImagePrompt(baseIntent, { mode: "native", maxImages: 4 });
		expect(out.referenceUrls).toEqual(["http://localhost:3030/api/image-gen/files/stickman.png"]);
		expect(out.prompt).toContain("Reference images:");
		expect(out.prompt).toContain("Image 1 = Sketch Stickman");
		expect(out.prompt).toContain("match identity exactly");
		expect(out.prompt).toContain("Use only for Sketch Stickman");
	});

	test("renders explicit referenceUse for native and text-only providers", () => {
		const source = {
			...baseIntent,
			references: [
				{
					...baseIntent.references[0]!,
					role: "product" as const,
					referenceUse: "direct_place" as const,
				},
			],
		};
		const native = compileImagePrompt(source, { mode: "native", maxImages: 4 });
		const textOnly = compileImagePrompt(source, { mode: "text-only" });
		expect(native.prompt).toContain("place this object/product directly");
		expect(textOnly.prompt).toContain("text-only generation cannot guarantee exact pixels");
		expect(textOnly.warnings?.[0]).toContain("cannot guarantee exact pixels");
	});

	test("renders text-only reference brief without urls or attached wording", () => {
		const out = compileImagePrompt(baseIntent, { mode: "text-only" });
		expect(out.referenceUrls).toBeUndefined();
		expect(out.prompt).toContain("Reference brief:");
		expect(out.prompt).not.toContain("Image 1");
		expect(out.prompt).not.toContain("attached");
	});

	test("omits reference text for providers with no reference support", () => {
		const out = compileImagePrompt(baseIntent, { mode: "none" });
		expect(out.referenceUrls).toBeUndefined();
		expect(out.prompt).not.toContain("Reference brief");
		expect(out.prompt).not.toContain("Reference images");
	});

	test("omits empty optional placeholders and metadata", () => {
		const out = compileImagePrompt(
			{
				output: { kind: "single-image", aspect: "1:1", fullFrame: true },
				subjectLocks: [],
				scene: { visualMoment: "single product on a table" },
				constraints: { mustInclude: [], mustAvoid: [] },
				negative: [],
				references: [],
			},
			{ mode: "native", maxImages: 4 },
		);
		expect(out.prompt).not.toContain("No product");
		expect(out.prompt).not.toContain("No action specified");
		expect(out.prompt).not.toContain("Post Processing");
		expect(out.prompt).not.toContain("workspace");
		expect(out.prompt).not.toContain("provider");
	});

	test("dedupes negative terms", () => {
		const out = compileImagePrompt(
			{
				...baseIntent,
				negative: ["watermark", "Watermark", "text overlay"],
			},
			{ mode: "text-only" },
		);
		expect(out.prompt.match(/watermark/gi)?.length).toBe(1);
	});

	test("strips unresolved mentions from provider prompt", () => {
		const out = compileImagePrompt(
			{
				...baseIntent,
				scene: { visualMoment: "match @Sketch Stickman in a sleepy pose" },
				references: [{ ...baseIntent.references[0]!, label: "@Sketch Stickman" }],
			},
			{ mode: "text-only" },
		);
		expect(out.prompt).not.toContain("@Sketch");
		expect(out.prompt).toContain("Sketch Stickman");
	});

	test("does not include narration fields and keeps reference locks stronger than generated text", () => {
		const source = {
			...baseIntent,
			scene: {
				visualMoment: "realistic human face looking sleepy",
				voiceover: "Kelopak mata menjadi berat",
				narrationBeat: "audio beat",
			},
		} as unknown as ImagePromptIntent;
		const out = compileImagePrompt(source, { mode: "text-only" });
		expect(out.prompt).toContain("Preserve: simple stickman sketch");
		expect(out.prompt).toContain("Avoid: realistic human");
		expect(out.prompt).not.toContain("Kelopak mata");
		expect(out.prompt).not.toContain("audio beat");
	});
});
