/* Frozen project-chat context for planning prompts that bypass the agent's own choice. */
import type { PromptTemplate } from "@maleo/shared";

const line = "\n";

export const CONTEXT_TEMPLATES: readonly PromptTemplate[] = [
	{
		id: "prompt:context:renderIndex",
		description: "Compact project index groups, bounded per group, saying what was left out.",
		body: [
			{
				type: "each",
				path: "groups",
				as: "group",
				sep: "\n",
				empty: ["  (empty)"],
				template: [
					"  - ",
					{ type: "slot", path: "group.name" },
					": ",
					"",
					{ type: "format", name: "json", in: { value: "group.shown" } },
					{
						type: "when",
						if: { not: { empty: "group.omitted" } },
						then: [" (+", { type: "slot", path: "group.omitted" }, " more not shown)"],
					},
					"",
				],
			},
		],
	},
	{
		id: "prompt:context:chatContextPrompt",
		description:
			"What the run was frozen to see: focus, project index, focused detail, decisions and conversation.",
		body: [
			{
				type: "when",
				if: { exists: "context" },
				then: [
					"Resolved project-chat context (frozen for this run):",
					line,
					"- Focus source: ",
					{ type: "slot", path: "context.focus.source" },
					"",
					line,
					"- Focused entities: ",
					{
						type: "each",
						path: "context.focus.entities",
						as: "entity",
						sep: ", ",
						empty: ["project:project"],
						template: [
							"",
							{ type: "slot", path: "entity.kind" },
							":",
							{ type: "slot", path: "entity.id" },
							"",
						],
					},
					"",
					line,
					"- Project index:",
					line,
					{ type: "include", prompt: "prompt:context:renderIndex", in: { groups: "indexGroups" } },
					line,
					"- Focused detail: ",
					{ type: "format", name: "json", in: { value: "context.detail" } },
					"",
					line,
					"- Settled decisions: ",
					{
						type: "format",
						name: "jsonPick",
						in: {
							value: "context.memory.decisions",
							fields: { value: ["kind", "question", "answer"] },
						},
					},
					"",
					line,
					"- Unresolved questions: ",
					{
						type: "format",
						name: "jsonPluck",
						in: { value: "context.memory.unresolved", field: { value: "question" } },
					},
					"",
					line,
					"- Recent conversation: ",
					{
						type: "format",
						name: "jsonPick",
						in: { value: "context.memory.recentTurns", fields: { value: ["role", "text"] } },
					},
					"",
					line,
					{
						type: "when",
						if: { exists: "context.pendingAction" },
						then: [
							"- Pending action: ",
							{ type: "format", name: "json", in: { value: "context.pendingAction" } },
							"",
							line,
						],
					},
					"Treat focused entities as command scope. Current structured project data overrides older conversation.",
				],
			},
		],
	},
	{
		id: "prompt:context:briefWithChatContext",
		description:
			"A deterministic build brief followed by the run's frozen chat context, when it has one.",
		body: [
			{
				type: "when",
				if: { exists: "context" },
				then: [
					{ type: "slot", path: "brief", filters: ["trim"] },
					"\n\n",
					{ type: "include", prompt: "prompt:context:chatContextPrompt" },
				],
				else: [{ type: "slot", path: "brief" }],
			},
		],
	},
];
