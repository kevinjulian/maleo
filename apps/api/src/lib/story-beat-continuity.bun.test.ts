/* Continuity across the beat and the section boundary.
 *
 * Two beats authored without knowing what the beat before them showed is how a
 * story ends up with shots that each make sense alone and none that follow. The
 * end state is the whole carried context, so these pin that it reaches the author
 * — including across a section boundary, where the viewer's continuity does not
 * reset even though the authoring call does. */
import { describe, expect, test } from "bun:test";
import { beatVisualIntentSchema } from "@maleo/shared";
import {
	authoredBeatInputs,
	renderBeatIntentProse,
} from "../modules/agents/core/services/story-assets.ts";

const intent = (over: Record<string, unknown> = {}) =>
	beatVisualIntentSchema.parse({
		beatIndex: 0,
		visualMoment: "the wax cap lifting from inside the cell",
		action: "pushing upward with the forelegs",
		shotType: "extreme macro",
		cameraAngle: "first-person",
		...over,
	});

test("image submission requires authored intent for every beat", () => {
	const beat = {
		text: "worker bee",
		visualPrompt: "prose mirror",
		durationSec: 4,
		voiceSegmentIndex: 0,
	};
	expect(() => authoredBeatInputs([beat])).toThrow("Visual beat 1 has no authored intent");
	expect(authoredBeatInputs([{ ...beat, intent: intent() }])[0]?.intent.visualMoment).toBe(
		"the wax cap lifting from inside the cell",
	);
});

describe("renderBeatIntentProse", () => {
	test("renders the moment, action, and camera as the reviewer-facing mirror", () => {
		expect(renderBeatIntentProse(intent())).toBe(
			"the wax cap lifting from inside the cell. pushing upward with the forelegs. extreme macro, first-person",
		);
	});

	test("omits absent fields rather than emitting empty joins", () => {
		expect(
			renderBeatIntentProse(
				intent({ action: undefined, cameraAngle: undefined, shotType: undefined }),
			),
		).toBe("the wax cap lifting from inside the cell");
	});

	test("never carries the story's constants", () => {
		// Nothing in a BeatVisualIntent can hold them — the schema has no field for
		// medium, lighting, palette or negatives — so the mirror cannot leak them.
		const prose = renderBeatIntentProse(intent());
		for (const constant of ["watercolor", "#FFFFFF", "morning light", "no human"]) {
			expect(prose).not.toContain(constant);
		}
	});
});
