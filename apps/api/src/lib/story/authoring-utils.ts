import { renderPrompt } from "../prompts/registry.ts";
export function parseJson(text: string): unknown {
	const trimmed = text.trim();
	const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const raw = fence?.[1] ?? trimmed;
	return JSON.parse(raw);
}

export interface LockedVisualConstraints {
	/** Operator or preset-authored Visual material. */
	visual?: string;
	/** Rules materials — hard constraints, not taste. */
	rules?: string;
	/** Labels and descriptions of the references the project locked. */
	references?: ReadonlyArray<{ label: string; description?: string }>;
}

/* Neutral wording, because both the style bible and the section planner read this
 * block and they are writing different things — a look, and a shot description.
 * What they share is that neither may contradict it. */
export function lockedConstraintBlock(locked: LockedVisualConstraints | undefined): string {
	return renderPrompt("prompt:constraints:lockedConstraintBlock", { locked }).text;
}
