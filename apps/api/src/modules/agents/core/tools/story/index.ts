/* longform domain — editing, approving and generating a planned story's
 * sections. Planning and the one-shot build are workflow definitions (engine/planning/). */
import type { AnyToolDef } from "../../types.ts";
import { updateSection } from "./update-section.ts";
import { generateStoryAssets } from "./generate-story-assets.ts";
import { improveSection } from "./improve-section.ts";
import { regenerateSection } from "./regenerate-section.ts";

export const storyTools: AnyToolDef[] = [
	updateSection,
	generateStoryAssets,
	improveSection,
	regenerateSection,
];
