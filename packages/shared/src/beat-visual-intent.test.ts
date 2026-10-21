import { describe, expect, it } from "vite-plus/test";
import {
	adjacentDuplicateBeatIndexes,
	beatVisualIntentSchema,
	sameBeatVisual,
	type BeatVisualIntent,
} from "./beat-visual-intent.ts";

const beat = (over: Partial<BeatVisualIntent> = {}): BeatVisualIntent =>
	beatVisualIntentSchema.parse({
		beatIndex: 0,
		subjectIds: ["worker-bee"],
		locationId: "hive",
		visualMoment: "pushing the wax cap open from inside the cell",
		shotType: "extreme macro",
		cameraAngle: "first-person",
		...over,
	});

describe("beatVisualIntentSchema", () => {
	it("parses a beat and defaults its arrays", () => {
		const parsed = beat();
		expect(parsed.mustInclude).toEqual([]);
		expect(parsed.mustAvoid).toEqual([]);
		expect(parsed.action).toBeUndefined();
	});

	it("rejects a result carrying the story's medium", () => {
		expect(() =>
			beatVisualIntentSchema.parse({ beatIndex: 0, visualMoment: "a cell", medium: "watercolor" }),
		).toThrow();
	});

	it("rejects a result carrying lighting, palette, or negatives", () => {
		for (const key of ["lighting", "palette", "negatives", "realism", "visualTreatment"]) {
			expect(() =>
				beatVisualIntentSchema.parse({ beatIndex: 0, visualMoment: "a cell", [key]: "x" }),
			).toThrow();
		}
	});

	it("requires a visual moment", () => {
		expect(() => beatVisualIntentSchema.parse({ beatIndex: 0 })).toThrow();
	});

	it("coerces a string beat index", () => {
		expect(beatVisualIntentSchema.parse({ beatIndex: "2", visualMoment: "a cell" }).beatIndex).toBe(
			2,
		);
	});
});

describe("sameBeatVisual", () => {
	it("matches beats equal on every compared field", () => {
		expect(sameBeatVisual(beat(), beat({ beatIndex: 1 }))).toBe(true);
	});

	it("ignores case and punctuation in the moment", () => {
		expect(
			sameBeatVisual(
				beat(),
				beat({ visualMoment: "Pushing the wax cap open, from inside the cell." }),
			),
		).toBe(true);
	});

	it("ignores subject id order", () => {
		const a = beat({ subjectIds: ["worker-bee", "queen"] });
		const b = beat({ subjectIds: ["queen", "worker-bee"] });
		expect(sameBeatVisual(a, b)).toBe(true);
	});

	it("separates beats differing only by camera angle", () => {
		expect(sameBeatVisual(beat(), beat({ cameraAngle: "over-shoulder" }))).toBe(false);
	});

	it("separates beats differing only by location", () => {
		expect(sameBeatVisual(beat(), beat({ locationId: "flower-field" }))).toBe(false);
	});

	it("separates beats differing only by cast", () => {
		expect(sameBeatVisual(beat(), beat({ subjectIds: ["queen"] }))).toBe(false);
	});

	it("does not treat a differing mood or novelty key as a difference", () => {
		// Neither changes the picture; a beat that varies only by mood would render
		// the same image, which is what the check exists to catch.
		expect(sameBeatVisual(beat(), beat({ mood: "tense", noveltyKey: "first light" }))).toBe(true);
	});
});

describe("adjacentDuplicateBeatIndexes", () => {
	it("reports the lower index of each matching pair", () => {
		const beats = [
			beat({ beatIndex: 0 }),
			beat({ beatIndex: 1 }),
			beat({ beatIndex: 2, cameraAngle: "over-shoulder" }),
		];
		expect(adjacentDuplicateBeatIndexes(beats)).toEqual([0]);
	});

	it("reports nothing when every adjacent pair differs", () => {
		const beats = [
			beat({ beatIndex: 0 }),
			beat({ beatIndex: 1, shotType: "wide" }),
			beat({ beatIndex: 2, locationId: "flower-field" }),
		];
		expect(adjacentDuplicateBeatIndexes(beats)).toEqual([]);
	});

	it("reports nothing for a single beat", () => {
		expect(adjacentDuplicateBeatIndexes([beat()])).toEqual([]);
	});
});
