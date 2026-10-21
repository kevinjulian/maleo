/* Agent tool registry — the single list every other layer derives from.
 *
 * The planner enum, the prompt's tool descriptions, and the loop's validation
 * gate all read from TOOLS, so a tool's identity can't drift across files.
 * Ordering is prompt order: domain tools first, then the terminal tools last. */
import type { AnyToolDef, ContentType, Intent, ToolKind } from "./types.ts";
import { askUser } from "./tools/ask-user.ts";
import { finishTool } from "./tools/finish.ts";
import { readTools } from "./tools/read/index.ts";
import { researchTools } from "./tools/research/index.ts";
import { planTools } from "./tools/plan/index.ts";
import { sceneTools } from "./tools/scene/index.ts";
import { visualTools } from "./tools/visual/index.ts";
import { overlayTools } from "./tools/overlay/index.ts";
import { audioTools } from "./tools/audio/index.ts";
import { storyTools } from "./tools/story/index.ts";

// Registration groups also supply the catalog's human capability classification.
export const TOOL_GROUPS = [
	{ capability: "Project inspection", tools: readTools },
	{ capability: "Research", tools: researchTools },
	{ capability: "Story planning", tools: planTools },
	{ capability: "Timeline editing", tools: sceneTools },
	{ capability: "Visual authoring", tools: visualTools },
	{ capability: "Overlays and effects", tools: overlayTools },
	{ capability: "Audio", tools: audioTools },
	{ capability: "Story assets", tools: storyTools },
	{ capability: "Conversation control", tools: [askUser, finishTool] },
];
export const TOOLS: AnyToolDef[] = TOOL_GROUPS.flatMap((group) => group.tools);

export const toolByName: ReadonlyMap<string, AnyToolDef> = new Map(TOOLS.map((t) => [t.name, t]));

// execTool aliases with no prompt line of their own (add_beat === add_scene).
export const TOOL_ALIASES = ["add_beat"] as const;

// Alias → canonical tool name, so an alias dispatches the canonical tool's
// schema + handler (add_beat runs add_scene).
export const TOOL_ALIAS_CANONICAL: Record<string, string> = { add_beat: "add_scene" };

/* Tool names that were renamed after runs had already been persisted.
 *
 * A suspended job's pending tool call names the tool it will dispatch on resume,
 * and `saveRun` writes the whole job into `workflow_run.snapshot_json`, so a run
 * parked before a rename can still name the old tool. Resolving retired names at
 * dispatch lets those runs finish.
 *
 * Deliberately NOT in TOOL_ALIASES: aliases are offered to the planner, and the
 * retired names must never be selectable again. This map is read only when a
 * name arrives from storage.
 *
 * Historical tool-call cards in saved chat logs are left saying the old name on
 * purpose — they are a record of what ran, and rewriting them would make the
 * log lie about history.
 *
 * Removable when `bun scripts/check-migration-shims.ts` reports 0 for this site —
 * that counts only RESUMABLE runs, because a finished run never dispatches again. */
export const RETIRED_TOOL_NAMES: ReadonlyMap<string, string> = new Map([
	["generate_longform_assets", "generate_story_assets"],
]);

// Every tool name the planner may emit — used to build the decision enum.
export const ALL_TOOL_NAMES: string[] = [...TOOLS.map((t) => t.name), ...TOOL_ALIASES];

// Grounding + terminal + clarify tools: always offered, whatever the intent.
export const CORE_TOOL_NAMES: ReadonlySet<string> = new Set([
	"view_timeline",
	"read_skill",
	"ask_user",
	"finish",
]);

// Tools available for a content type (untagged tools apply to all).
export function toolsForContentType(contentType: ContentType): AnyToolDef[] {
	return TOOLS.filter((t) => !t.contentType || t.contentType.includes(contentType));
}

export function toolNamesForContentType(contentType: ContentType): string[] {
	const visible = toolsForContentType(contentType).map((t) => t.name);
	const aliases = TOOL_ALIASES.filter((alias) => visible.includes(TOOL_ALIAS_CANONICAL[alias]!));
	return [...visible, ...aliases];
}

// Tools of a given effect kind (read / mutate / generate / approve / respond).
export function toolsByKind(kind: ToolKind): AnyToolDef[] {
	return TOOLS.filter((t) => t.kind === kind);
}

// Stage-2 selection: the tools a given intent may use, always unioned with the
// always-available core, in prompt order.
export function toolsForIntent(intent: Intent, contentType: ContentType): AnyToolDef[] {
	return toolsForContentType(contentType).filter(
		(t) => t.intents.includes(intent) || CORE_TOOL_NAMES.has(t.name),
	);
}
