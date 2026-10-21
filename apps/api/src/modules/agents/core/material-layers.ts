import { renderPrompt } from "../../../lib/prompts/registry.ts";
/* Where routed material layers go in each stage's prompt.
 *
 * The layer ORDER is the contract. Story planning, image generation and voice
 * synthesis each concatenate a fixed sequence, and a given input set has to
 * produce a stable prompt — so each sequence is written once: the story and voice
 * sequences as templates (`lib/prompts/templates/materials.ts`), the visual
 * sequence here, and every caller assembles through these helpers.
 *
 * Materials reach the agent as `job.direction`'s routed channels: materials are
 * the authoring model, direction is the wire model, and `directionFromMaterials`
 * in @maleo/shared is the single conversion. That is why this reads channels and
 * not a materials object — the stages have one shape to look at, not two.
 *
 * `rules` layers LAST in every stage. A constraint that appears before the
 * guidance it constrains reads as something to balance against; appearing after
 * it reads as something that overrides it, which is what a hard constraint is.
 */
import {
	resolveMaterialMentions,
	type CreativeDirection,
	type MentionableReference,
} from "@maleo/shared";

/** The visual layer order; story and voice orders are their templates. */
export const VISUAL_LAYER_ORDER = ["sceneVisual", "visual", "rules"] as const;

function layer(parts: ReadonlyArray<string | null | undefined>): string {
	return parts
		.map((part) => part?.trim())
		.filter((part): part is string => Boolean(part))
		.join("\n\n");
}

/** The rules layer, labelled so a model reads it as constraint rather than taste. */
export function rulesLayer(direction: CreativeDirection | undefined): string {
	const rules = direction?.rules?.trim();
	return rules ? renderPrompt("prompt:materials:RULES_PREFIX", { rules }).text : "";
}

/** Story planning / research: subject + Story material + Rules.
 *
 *  Visual and Voice are deliberately absent. An image directive that reaches the
 *  research topic redirects what the video is ABOUT, which is the specific leak
 *  the channels exist to prevent.
 *
 *  The narration writer style is absent for the same reason, and it is worth naming
 *  because it is not obvious: this string is ALSO the research topic, fingerprinted
 *  to decide whether a run's existing research still matches. Appending craft
 *  guidance changed that fingerprint, so choosing a writer style silently discarded
 *  the run's research and refetched it. Craft reaches the narration drafter through
 *  `writerStyleCraftBlock`, in the drafting prompt where it belongs. */
export function storyPromptLayers(
	subject: string,
	direction: CreativeDirection | undefined,
): string {
	return renderPrompt("prompt:materials:storyPromptLayers", { subject, direction }).text;
}

/** Narration scripting: the story brief + Voice material as delivery guidance +
 *  Rules. Voice belongs here and NOT in the research topic above. */
export function voicePromptLayers(
	storyBrief: string,
	direction: CreativeDirection | undefined,
): string {
	return renderPrompt("prompt:materials:voicePromptLayers", { storyBrief, direction }).text;
}

/** Image generation: the scene's own description + Visual material + Rules.
 *
 *  The scene description leads because it says what this frame IS; Visual material
 *  refines the look of it, and rules constrain both. The style bible arrives inside
 *  the Visual channel — it is a derived Visual material, not a layer of its own.
 *
 *  `references` are the scene's resolved cast. They are here to strip editor
 *  mention syntax: `@Sketch Stickman` in a Visual material used to reach the
 *  provider with its `@` intact, asking an image model for a subject spelled with
 *  a sigil while the reference map named the same subject properly beside it.
 *  Omitted, the layers still compose — mentions simply go unresolved, which the
 *  caller can then report. */
export function visualPromptLayers(
	sceneVisual: string,
	direction: CreativeDirection | undefined,
	references: readonly MentionableReference[] = [],
): string {
	const blocks = { sceneVisual, visual: direction?.visual, rules: rulesLayer(direction) };
	return resolveMaterialMentions(layer(VISUAL_LAYER_ORDER.map((key) => blocks[key])), references)
		.text;
}

/** The mentions a stage could not resolve, for reporting before submission. */
export function unresolvedVisualMentions(
	sceneVisual: string,
	direction: CreativeDirection | undefined,
	references: readonly MentionableReference[] = [],
): string[] {
	return resolveMaterialMentions(
		layer([sceneVisual, direction?.visual, rulesLayer(direction)]),
		references,
	).unresolved;
}
