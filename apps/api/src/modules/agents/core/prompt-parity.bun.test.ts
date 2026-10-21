import { expect, test } from "bun:test";
import expected from "./__tests__/support/prompt-parity.json";
import { promptSamples } from "./__tests__/support/prompt-samples.ts";

test("inspectable production prompts preserve pre-extraction requests", async () => {
	expect(await promptSamples()).toEqual(expected);
});
