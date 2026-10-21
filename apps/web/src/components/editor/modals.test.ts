import { describe, expect, it } from "vite-plus/test";
import { appendPromptPreset, LIBRARY_PROMPT_PRESETS } from "./modals.tsx";

describe("create-content library prompt presets", () => {
	it("appends preset text to existing prompt", () => {
		const next = appendPromptPreset("stickman character pack", LIBRARY_PROMPT_PRESETS[0].prompt);
		expect(next).toContain("stickman character pack");
		expect(next).toContain(LIBRARY_PROMPT_PRESETS[0].prompt);
	});

	it("does not duplicate same preset block", () => {
		const once = appendPromptPreset("stickman character pack", LIBRARY_PROMPT_PRESETS[0].prompt);
		const twice = appendPromptPreset(once, LIBRARY_PROMPT_PRESETS[0].prompt);
		expect(twice).toBe(once);
	});
});
