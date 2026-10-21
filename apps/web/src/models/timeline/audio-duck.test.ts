/* The two duck tables have to agree.
 *
 * The renderer mixes with `DEFAULT_DUCK_UNDER_VOICE` (`@maleo/video`), and the
 * inspector shows the operator what a clip is doing with `defaultDuckUnderVoice`
 * (`@maleo/shared`). They are two copies because neither package can import the
 * other: the render package deliberately declares no workspace dependencies, and
 * shared must not depend on the renderer.
 *
 * This is the only place that can see both, so it is where the copy is checked
 * rather than trusted. A slider that says 35% while the render mixes at 20% is
 * exactly the kind of quiet disagreement that made the volume control read as
 * broken in the first place.
 */
import { describe, expect, test } from "vite-plus/test";
import { AUDIO_OVERLAY_KINDS, defaultDuckUnderVoice } from "@maleo/shared/audio-overlays";
import { DEFAULT_DUCK_UNDER_VOICE, dialoguePriorityEnvelope } from "@maleo/video/composition";

describe("duck table parity", () => {
	test("every non-voiceover kind matches the renderer's own table", () => {
		for (const kind of AUDIO_OVERLAY_KINDS) {
			if (kind === "voiceover") continue;
			expect(defaultDuckUnderVoice(kind)).toBe(DEFAULT_DUCK_UNDER_VOICE[kind]);
		}
	});

	test("the renderer honours a clip's own duck depth", () => {
		const ranges = [{ startSec: 0, endSec: 10 }];
		// Mid-voiceover: the default is the table value, an override replaces it.
		expect(dialoguePriorityEnvelope(150, 30, ranges, "music")).toBeCloseTo(
			DEFAULT_DUCK_UNDER_VOICE.music,
			5,
		);
		expect(dialoguePriorityEnvelope(150, 30, ranges, "music", 0.8)).toBeCloseTo(0.8, 5);
	});

	test("a duck of 1 is no ducking at all, which is the escape hatch", () => {
		const ranges = [{ startSec: 0, endSec: 10 }];
		expect(dialoguePriorityEnvelope(150, 30, ranges, "music", 1)).toBe(1);
	});

	test("voiceover never ducks, whatever it says", () => {
		expect(dialoguePriorityEnvelope(150, 30, [{ startSec: 0, endSec: 10 }], "voiceover", 0.1)).toBe(
			1,
		);
	});
});
