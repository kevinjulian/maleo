import { describe, expect, test } from "vite-plus/test";
import { AUDIO_OVERLAY_KINDS, audioKindLabel, defaultDuckUnderVoice } from "./audio-overlays.ts";

describe("audio kind labels", () => {
	test("every kind has a label", () => {
		for (const kind of AUDIO_OVERLAY_KINDS) expect(audioKindLabel(kind).length).toBeGreaterThan(0);
	});
});

describe("duck under voice", () => {
	test("every kind has a default in range", () => {
		for (const kind of AUDIO_OVERLAY_KINDS) {
			expect(defaultDuckUnderVoice(kind)).toBeGreaterThan(0);
			expect(defaultDuckUnderVoice(kind)).toBeLessThanOrEqual(1);
		}
	});

	test("voiceover does not duck — it is what everything else ducks under", () => {
		expect(defaultDuckUnderVoice("voiceover")).toBe(1);
	});

	test("a music bed ducks hardest, then ambience, then sound effects", () => {
		expect(defaultDuckUnderVoice("music")).toBeLessThan(defaultDuckUnderVoice("ambient"));
		expect(defaultDuckUnderVoice("ambient")).toBeLessThan(defaultDuckUnderVoice("sfx"));
	});
});
