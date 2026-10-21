import type { ImagePromptIntent } from "@maleo/shared";
import { compileImagePrompt } from "./image-prompt.ts";
import { buildCodexImagePrompt } from "../providers/codex/cli.ts";

export function mediaPromptSamples() {
	const intent: ImagePromptIntent = {
		output: { kind: "single-image", aspect: "9:16", fullFrame: true },
		subjectLocks: [
			{
				source: "reference",
				role: "character",
				label: "Seed",
				descriptors: ["brown shell"],
				mustAvoid: ["human hands"],
			},
		],
		scene: { visualMoment: "seed opening", action: "roots emerging", endState: "sprout" },
		composition: { shotType: "close-up", movement: "static" },
		style: { medium: "ink" },
		lightingColor: { lighting: "soft", palette: "earth tones" },
		constraints: { mustInclude: ["root"], mustAvoid: ["text"] },
		negative: ["watermark", "collage"],
		references: [
			{
				role: "character",
				entityId: "seed",
				label: "Seed",
				description: "brown shell",
				url: "https://example.org/seed.png",
			},
		],
	};
	return {
		native: compileImagePrompt(intent, { mode: "native", maxImages: 4 }),
		textOnly: compileImagePrompt(intent, { mode: "text-only" }),
		none: compileImagePrompt(intent, { mode: "none" }),
		directPlacement: compileImagePrompt(
			{
				...intent,
				references: [{ ...intent.references[0]!, role: "product", referenceUse: "direct_place" }],
			},
			{ mode: "text-only" },
		),
		codexPlain: buildCodexImagePrompt({ prompt: "seed opening", references: [] }),
		codexReference: buildCodexImagePrompt({
			prompt: "seed opening",
			aspect: "9:16",
			references: ["/fixture/seed.png"],
		}),
	};
}
