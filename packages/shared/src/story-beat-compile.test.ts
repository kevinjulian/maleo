import { describe, expect, it } from "vite-plus/test";
import { buildStoryBeatIntent } from "./story-beat-compile.ts";
import { beatVisualIntentSchema } from "./beat-visual-intent.ts";
import { storyBibleSchema } from "./story-bible.ts";
import type { ImagePromptReference } from "./image-prompt-intent.ts";

const fixtureBeatIntent = (beatIndex: number, visualMoment: string) =>
	beatVisualIntentSchema.parse({ beatIndex, visualMoment });

const BIBLE = storyBibleSchema.parse({
	subjects: [
		{
			id: "worker-bee",
			label: "worker bee",
			aliases: ["lebah pekerja"],
			descriptors: ["fuzzy black-yellow thorax"],
			mustAvoid: ["human eyes"],
			refKey: "ref-worker",
		},
		{ id: "queen", label: "queen bee", descriptors: ["elongated abdomen"] },
	],
	locations: [{ id: "hive", label: "honeycomb interior", descriptors: ["golden wax cells"] }],
	medium: "hand-drawn sketch with watercolor",
	realism: "realistic bee anatomy",
	visualTreatment: "sparse lines, white negative space",
	lighting: "clear morning light",
	palette: "honey-yellow and soft black on white",
	moodDefault: "intimate and industrious",
	cameraLanguage: { defaultShot: "close macro" },
	negatives: ["human presence", "modern objects"],
	summary: "sketsa tangan sederhana dengan cat air",
});

const beat = (over: Record<string, unknown> = {}) =>
	beatVisualIntentSchema.parse({
		beatIndex: 0,
		subjectIds: ["worker-bee"],
		locationId: "hive",
		visualMoment: "pushing the wax cap open from inside the cell",
		action: "pushing upward with the forelegs",
		endState: "cap lifted, first light entering",
		shotType: "extreme macro",
		cameraAngle: "first-person",
		...over,
	});

describe("buildStoryBeatIntent", () => {
	it("is deterministic", () => {
		const a = buildStoryBeatIntent({ bible: BIBLE, beat: beat(), aspect: "9:16" });
		const b = buildStoryBeatIntent({ bible: BIBLE, beat: beat(), aspect: "9:16" });
		expect(a).toEqual(b);
	});

	it("renders the story's constants from the bible, not from the beat", () => {
		const intent = buildStoryBeatIntent({ bible: BIBLE, beat: beat(), aspect: "9:16" });
		expect(intent.style).toEqual({
			medium: "hand-drawn sketch with watercolor",
			realism: "realistic bee anatomy",
			visualTreatment: "sparse lines, white negative space",
		});
		expect(intent.lightingColor).toEqual({
			lighting: "clear morning light",
			palette: "honey-yellow and soft black on white",
			mood: "intimate and industrious",
		});
		expect(intent.negative).toEqual(["human presence", "modern objects"]);
	});

	it("keeps the style block identical across a section's beats", () => {
		const first = buildStoryBeatIntent({
			bible: BIBLE,
			beat: beat({ beatIndex: 0 }),
			aspect: "9:16",
		});
		const second = buildStoryBeatIntent({
			bible: BIBLE,
			beat: beat({
				beatIndex: 1,
				visualMoment: "antennae reading a scent trail",
				shotType: "wide",
			}),
			aspect: "9:16",
		});
		expect(second.style).toEqual(first.style);
		expect(second.lightingColor).toEqual(first.lightingColor);
		expect(second.negative).toEqual(first.negative);
		// What varies is the scene and the camera, and nothing else.
		expect(second.scene).not.toEqual(first.scene);
		expect(second.composition).not.toEqual(first.composition);
	});

	it("lets a beat's mood override the story default without moving the rest of the look", () => {
		const intent = buildStoryBeatIntent({
			bible: BIBLE,
			beat: beat({ mood: "cramped and urgent" }),
			aspect: "9:16",
		});
		expect(intent.lightingColor?.mood).toBe("cramped and urgent");
		expect(intent.lightingColor?.palette).toBe("honey-yellow and soft black on white");
	});

	it("casts only the subjects this beat names", () => {
		const intent = buildStoryBeatIntent({ bible: BIBLE, beat: beat(), aspect: "9:16" });
		expect(intent.subjectLocks.map((lock) => lock.label)).toEqual(["worker bee"]);
		const both = buildStoryBeatIntent({
			bible: BIBLE,
			beat: beat({ subjectIds: ["worker-bee", "queen"] }),
			aspect: "9:16",
		});
		expect(both.subjectLocks.map((lock) => lock.label)).toEqual(["worker bee", "queen bee"]);
	});

	it("uses the resolved reference description as the locked identity", () => {
		const references: ImagePromptReference[] = [
			{
				url: "/u/worker.png",
				role: "character",
				entityId: "ref-worker",
				label: "worker bee",
				description: "translucent wings, pollen baskets",
			},
		];
		const intent = buildStoryBeatIntent({ bible: BIBLE, beat: beat(), references, aspect: "9:16" });
		const lock = intent.subjectLocks[0]!;
		expect(lock.source).toBe("reference");
		expect(lock.role).toBe("character");
		expect(lock.referenceId).toBe("ref-worker");
		// Reference description first, bible descriptors as additive detail.
		expect(lock.descriptors).toEqual([
			"translucent wings, pollen baskets",
			"fuzzy black-yellow thorax",
		]);
		expect(lock.mustAvoid).toEqual(["human eyes"]);
	});

	it("falls back to the bible when a subject has no resolved reference", () => {
		const intent = buildStoryBeatIntent({
			bible: BIBLE,
			beat: beat({ subjectIds: ["queen"] }),
			aspect: "9:16",
		});
		expect(intent.subjectLocks[0]).toMatchObject({
			source: "material",
			label: "queen bee",
			descriptors: ["elongated abdomen"],
		});
	});
});

describe("composition", () => {
	it("uses the beat's camera, never a hardcoded medium shot", () => {
		const intent = buildStoryBeatIntent({ bible: BIBLE, beat: beat(), aspect: "9:16" });
		expect(intent.composition).toEqual({ shotType: "extreme macro", cameraAngle: "first-person" });
		expect(JSON.stringify(intent)).not.toContain("Medium Shot");
	});

	it("a body-detail POV beat does not compile to a default medium shot", () => {
		const intent = buildStoryBeatIntent({
			bible: BIBLE,
			beat: beat({
				shotType: "body detail",
				cameraAngle: "first-person",
				framing: "legs at frame edge",
			}),
			aspect: "9:16",
		});
		expect(intent.composition).toEqual({
			shotType: "body detail",
			cameraAngle: "first-person",
			framing: "legs at frame edge",
		});
	});

	it("falls back to the bible's default shot when the beat names none", () => {
		const intent = buildStoryBeatIntent({
			bible: BIBLE,
			beat: beat({ shotType: undefined }),
			aspect: "9:16",
		});
		expect(intent.composition?.shotType).toBe("close macro");
	});

	it("leaves composition empty when neither the beat nor the bible names a camera", () => {
		const bare = storyBibleSchema.parse({ subjects: [{ id: "s", label: "s" }] });
		const intent = buildStoryBeatIntent({
			bible: bare,
			beat: beat({ shotType: undefined, cameraAngle: undefined }),
			aspect: "9:16",
		});
		expect(intent.composition).toEqual({});
	});
});

describe("material channels compile as constraints", () => {
	it("puts Visual material in mustInclude and Rules in mustAvoid", () => {
		const intent = buildStoryBeatIntent({
			bible: BIBLE,
			beat: beat(),
			visual: "Long lenses. Heavy negative space.",
			rules: "no human presence\nno text in image",
			aspect: "9:16",
		});
		expect(intent.constraints.mustInclude).toContain("Long lenses");
		expect(intent.constraints.mustInclude).toContain("Heavy negative space");
		// The "no" is stripped: the renderer already labels the field `Avoid:`, and
		// "Avoid: no human presence" is a double negative.
		expect(intent.constraints.mustAvoid).toContain("human presence");
		expect(intent.constraints.mustAvoid).toContain("text in image");
		expect(intent.constraints.mustAvoid.join(" ")).not.toContain("no human");
	});

	it("a Rules entry removes the Visual entry it contradicts", () => {
		const intent = buildStoryBeatIntent({
			bible: BIBLE,
			beat: beat(),
			visual: "human hands in frame. Long lenses",
			rules: "no human hands",
			aspect: "9:16",
		});
		expect(intent.constraints.mustAvoid).toContain("human hands");
		expect(intent.constraints.mustInclude).not.toContain("human hands in frame");
		// The uncontradicted Visual entry survives.
		expect(intent.constraints.mustInclude).toContain("Long lenses");
	});

	it("carries the beat's own details and the location's descriptors", () => {
		const intent = buildStoryBeatIntent({
			bible: BIBLE,
			beat: beat({ mustInclude: ["honey glints"], mustAvoid: ["visible sun"] }),
			aspect: "9:16",
		});
		expect(intent.constraints.mustInclude).toContain("honey glints");
		expect(intent.constraints.mustInclude).toContain("golden wax cells");
		expect(intent.constraints.mustAvoid).toContain("visible sun");
	});

	it("resolves @mention syntax so it never reaches the provider", () => {
		const intent = buildStoryBeatIntent({
			bible: BIBLE,
			beat: beat(),
			visual: "keep @Worker Bee centred",
			roster: [{ id: "ref-worker", label: "Worker Bee" }],
			aspect: "9:16",
		});
		expect(intent.constraints.mustInclude.join(" ")).not.toContain("@");
		expect(intent.constraints.mustInclude.join(" ")).toContain("Worker Bee");
	});

	it("does not duplicate a constraint that arrives twice", () => {
		const intent = buildStoryBeatIntent({
			bible: BIBLE,
			beat: beat({ mustInclude: ["golden wax cells"] }),
			visual: "golden wax cells",
			aspect: "9:16",
		});
		expect(
			intent.constraints.mustInclude.filter((entry) => entry === "golden wax cells"),
		).toHaveLength(1);
	});
});

describe("scene", () => {
	it("carries the moment alone and puts the place in the constraints", () => {
		const intent = buildStoryBeatIntent({ bible: BIBLE, beat: beat(), aspect: "9:16" });
		// The location label is NOT spliced into the moment: on a real story that
		// put an Indonesian place name inside an otherwise English sentence, after
		// a full stop the moment already ended with.
		expect(intent.scene.visualMoment).toBe("pushing the wax cap open from inside the cell");
		expect(intent.constraints.mustInclude).toContain("golden wax cells");
		expect(intent.scene.action).toBe("pushing upward with the forelegs");
		expect(intent.scene.endState).toBe("cap lifted, first light entering");
	});

	it("moves a prohibition out of must-include wherever it was authored", () => {
		// The real bee bible returned "no modern objects" as a LOCATION DESCRIPTOR,
		// which asked the provider to include no-modern-objects.
		const bible = storyBibleSchema.parse({
			subjects: [{ id: "s", label: "s" }],
			locations: [{ id: "hive", label: "hive", descriptors: ["golden wax", "no modern objects"] }],
		});
		const intent = buildStoryBeatIntent({
			bible,
			beat: beat({ subjectIds: ["s"] }),
			aspect: "9:16",
		});
		expect(intent.constraints.mustInclude).toEqual(["golden wax"]);
		expect(intent.constraints.mustAvoid).toContain("modern objects");
	});

	it("compiles without a bible at all", () => {
		const intent = buildStoryBeatIntent({
			beat: fixtureBeatIntent(0, "a wax cell"),
			aspect: "9:16",
		});
		expect(intent.scene.visualMoment).toBe("a wax cell");
		expect(intent.subjectLocks).toEqual([]);
		expect(intent.negative).toEqual([]);
	});
});
