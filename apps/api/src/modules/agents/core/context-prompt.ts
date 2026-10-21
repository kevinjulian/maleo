import { renderPrompt } from "../../../lib/prompts/registry.ts";
import type { ChatContextEnvelope, ChatIndexEntry, ChatProjectIndex } from "@maleo/shared";

/* How many entries of one index group the prompt may carry.
 *
 * The index exists so prompt size tracks the task rather than the project, and
 * that only holds if something enforces it. Without a bound, a long project
 * sends every clip it has into the decider prompt on every ReAct step — the
 * failure the index was introduced to prevent, arriving by a different route.
 *
 * Truncation states what it dropped. A silently shortened list reads to the
 * model as the whole project, which is how a planner concludes that scene 40
 * does not exist and writes a replacement for it. */
const MAX_INDEX_ENTRIES = 25;

/** Non-empty groups, each bounded; the template says what was left out. Entries
 *  rather than keys-plus-lookup, and empty groups dropped — a project with no
 *  references should cost nothing to say so. */
function indexGroups(
	index: ChatProjectIndex,
): Array<{ name: string; shown: ChatIndexEntry[]; omitted: number }> {
	return Object.entries(index)
		.filter(([, entries]) => entries.length > 0)
		.map(([name, entries]) => {
			const shown = entries.slice(0, MAX_INDEX_ENTRIES);
			return { name, shown, omitted: entries.length - shown.length };
		});
}

/** Render frozen project-chat context for model-facing planning prompts. */
export function chatContextPrompt(context: ChatContextEnvelope | undefined): string {
	return renderPrompt("prompt:context:chatContextPrompt", {
		context,
		indexGroups: context ? indexGroups(context.index) : [],
	}).text;
}

/** Add frozen context to deterministic build briefs that bypass ReAct choice. */
export function briefWithChatContext(
	brief: string,
	context: ChatContextEnvelope | undefined,
): string {
	return renderPrompt("prompt:context:briefWithChatContext", {
		brief,
		context,
		indexGroups: context ? indexGroups(context.index) : [],
	}).text;
}
