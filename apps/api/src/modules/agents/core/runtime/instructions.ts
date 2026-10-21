import { PROMPT_FRAGMENTS } from "./instructions-prompt-definitions.ts";
import { renderPromptParts } from "@maleo/shared";
/* What the agent is told. Video is the only content type with an agent; image
 * and text projects are retired.
 *
 * Ported from the decision prompts of the loop it replaced (3.2), which carried
 * the product's routing knowledge: ground yourself first, ask only when it is
 * truly ambiguous, build through the workflow, edit with the targeted tools, and
 * actually change the project before answering. Tool names here are the agent's
 * own — a workflow is offered as `workflow-<id>` — and a test pins every name
 * mentioned to a tool the agent is actually offered. */
import type { ContentType } from "../types.ts";

const COMMON = PROMPT_FRAGMENTS.COMMONFragment0.parts[0];

const VIDEO = renderPromptParts(PROMPT_FRAGMENTS.VIDEOFragment0.parts, [COMMON]);

/** The agent's instructions. Only video runs exist. */
export function agentInstructions(): string {
	return VIDEO;
}

export function instructionsFor(_contentType: Extract<ContentType, "video">): string {
	return VIDEO;
}
