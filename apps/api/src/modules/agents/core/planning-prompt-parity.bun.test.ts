import { expect, test } from "bun:test";
import expected from "./__tests__/support/planning-prompt-parity.json";
import { planningPromptSamples } from "./__tests__/support/planning-prompt-samples.ts";

test("planning pilot preserves complete requests across defaults, evidence, escapes and repair", () => {
	expect(planningPromptSamples()).toEqual(expected);
});
