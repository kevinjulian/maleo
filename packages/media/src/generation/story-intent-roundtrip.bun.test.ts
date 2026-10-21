/* The story compiler's output must survive the worker's own parse.
 *
 * `parseStyle` rejects an invalid intent. A field the compiler emits that
 * `imagePromptIntentSchema` (which is `.strict()`) does not accept must fail
 * before provider submission.
 *
 * This pins the round trip at the seam where that would happen. */
import { describe, expect, it } from "bun:test";
import {
	imagePromptIntentSchema,
	buildStoryBeatIntent,
	beatVisualIntentSchema,
	storyBibleSchema,
} from "@maleo/shared";
import { buildProviderImageInput } from "./impl.ts";

const BIBLE = storyBibleSchema.parse({
	subjects: [
		{
			id: "worker-bee",
			label: "worker bee",
			descriptors: ["fuzzy thorax"],
			mustAvoid: ["human eyes"],
			refKey: "ref-worker",
		},
	],
	locations: [{ id: "hive", label: "honeycomb interior", descriptors: ["golden wax cells"] }],
	medium: "hand-drawn sketch with watercolor",
	realism: "realistic bee anatomy",
	visualTreatment: "sparse lines",
	lighting: "clear morning light",
	palette: "honey-yellow on white",
	moodDefault: "intimate",
	cameraLanguage: { defaultShot: "close macro" },
	negatives: ["human presence", "modern objects"],
	summary: "sketsa tangan sederhana dengan cat air",
});

const BEAT = beatVisualIntentSchema.parse({
	beatIndex: 0,
	subjectIds: ["worker-bee"],
	locationId: "hive",
	visualMoment: "pushing the wax cap open from inside the cell",
	action: "pushing upward with the forelegs",
	endState: "cap lifted",
	shotType: "extreme macro",
	cameraAngle: "first-person",
	framing: "legs at frame edge",
	mustInclude: ["honey glints"],
	mustAvoid: ["visible sun"],
	noveltyKey: "birth viewpoint",
	mood: "cramped",
});

const compiled = (beat = BEAT) =>
	buildStoryBeatIntent({
		bible: BIBLE,
		beat,
		aspect: "9:16",
		visual: "long lenses, heavy negative space",
		rules: "no human presence\nno text in image",
		guidance: "Approved section guidance",
		references: [
			{
				url: "https://host/worker.png",
				role: "character",
				entityId: "ref-worker",
				label: "worker bee",
				description: "translucent wings",
			},
		],
	});

describe("story beat intent survives the worker's parse", () => {
	it("parses under the strict provider schema", () => {
		const parsed = imagePromptIntentSchema.safeParse(compiled());
		// Naming the offending field beats "expected true, received false" when a
		// future field is added to one schema and not the other.
		expect(
			parsed.success
				? []
				: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
		).toEqual([]);
	});

	it("reaches the provider as the compiled prompt, not the fallback string", () => {
		const styleJson = JSON.stringify({ aspect: "9:16", intent: compiled() });
		const input = buildProviderImageInput("FALLBACK PROMPT", styleJson, { mode: "text-only" });
		expect(input.prompt).not.toContain("FALLBACK PROMPT");
		// Every labelled section the compiler filled must be present.
		for (const label of [
			"Subject:",
			"Scene:",
			"Composition:",
			"Style:",
			"Lighting/color:",
			"Must include:",
			"Avoid:",
			"Negative:",
		]) {
			expect(input.prompt).toContain(label);
		}
		expect(input.aspect).toBe("9:16");
	});

	it("carries the story's constants and the beat's camera into the rendered prompt", () => {
		const styleJson = JSON.stringify({ intent: compiled() });
		const { prompt } = buildProviderImageInput("unused", styleJson, { mode: "text-only" });
		expect(prompt).toContain("hand-drawn sketch with watercolor");
		expect(prompt).toContain("extreme macro");
		expect(prompt).toContain("human presence");
		// The beat's mood wins over the bible default.
		expect(prompt).toContain("cramped");
		expect(prompt).not.toContain("intimate");
	});
});
