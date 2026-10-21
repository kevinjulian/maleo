import { expect, test } from "vite-plus/test";
import expected from "./media-prompt-parity.json";
import { mediaPromptSamples } from "./media-prompt-samples.ts";

test("compiler and provider wrapper retain pre-extraction requests", () => {
	expect(mediaPromptSamples()).toEqual(expected);
});
