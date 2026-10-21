/* Render tool specs into the planner prompt.
 *
 * The description on each ToolDef is the one-line spec the model reads, so the
 * prompt text is generated from the registry — never hand-maintained alongside it.
 *
 * `renderToolLine` used to sit in front of this and return `tool.description`
 * unchanged; it was a function standing where a field access belonged. */
import type { AnyToolDef } from "./types.ts";

export function renderToolList(tools: AnyToolDef[]): string {
	return tools.map((tool) => tool.description).join("\n");
}
