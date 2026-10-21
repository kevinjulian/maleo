/* The internal agent: one Mastra agent per model, carrying the guardrails.
 *
 * Every limit lives in the agent definition rather than per call, so a run
 * resumed in another process is governed by exactly the same rules. */
import { Agent, type ToolsInput } from "@mastra/core/agent";
import type { RequestContext } from "@mastra/core/request-context";
import { askUserTool, MAX_STEPS, outcomeGate } from "./guardrails.ts";
import { directCallFor, directCallModel } from "./direct-call.ts";
import { agentInstructions } from "./instructions.ts";
import { settleProcessor } from "./settle.ts";
import { externalToolsFor } from "./tools/mcp-tools.ts";
import { agentToolsFor, type AgentRunContext } from "./tools/registry-tools.ts";
import { storyAssetsWorkflow } from "./workflows/story-assets.ts";
import { PLAN_STORY_TOOL, planStoryTool } from "./tools/plan-story-tool.ts";
import { createStoryVideoTool } from "./tools/create-story-video-tool.ts";

/** The workflows offered to one run: video's, or none. Image and text projects
 *  are retired and never reach a run; the guard here keeps it that way. */
type AgentWorkflows = { generate_story_assets: typeof storyAssetsWorkflow } | Record<string, never>;

/** The Mastra workflows a run may start, by its content type. Each is offered as a tool. */
export function agentWorkflowsFor({
	requestContext,
}: {
	requestContext: RequestContext<AgentRunContext>;
}): AgentWorkflows {
	if (requestContext.get("contentType") === "video")
		return { generate_story_assets: storyAssetsWorkflow };
	return {};
}

/* Workflow definitions run by the engine, offered as tools by content type. Video
 * planning is `workflow-plan_story`, the name the agent instructions describe. */
export function definitionToolsFor(
	requestContext: RequestContext<AgentRunContext>,
): Record<string, typeof planStoryTool | typeof createStoryVideoTool> {
	return requestContext.get("contentType") === "video"
		? { [PLAN_STORY_TOOL]: planStoryTool, create_story_video: createStoryVideoTool }
		: {};
}

/** Every workflow the runtime defines, for registering with Mastra (snapshots, resume). */
export { AGENT_WORKFLOWS } from "./workflows/index.ts";

/** A fixed model, or one resolved per call (the durable agent reads the current selection). */
type AgentModel = ConstructorParameters<
	typeof Agent<"maleo-agent", ToolsInput, undefined, AgentRunContext>
>[0]["model"];

/* The run limits. The in-process agent takes them as its defaults; the durable
 * agent ignores defaults, so its host passes them on every call. */
export const AGENT_RUN_OPTIONS = {
	maxSteps: MAX_STEPS,
	isTaskComplete: { scorers: [outcomeGate], suppressFeedback: false },
};

/* A single-tool run is driven by its direct-call model; every other run by the
 * given model. Resolved per call, so a resumed run gets the same one. */
function modelFor(model: AgentModel): AgentModel {
	const resolve = async (args: { requestContext: RequestContext<AgentRunContext> }) => {
		const direct = await directCallFor(args.requestContext);
		if (direct) return directCallModel(direct);
		// SAFETY: a dynamic model argument is called with the same arguments this resolver receives.
		return typeof model === "function" ? await (model as (a: typeof args) => unknown)(args) : model;
	};
	// SAFETY: the resolver returns either the given model's own value or the direct-call model, which implements the AI SDK v2 model interface Mastra calls (specificationVersion, doGenerate, doStream).
	return resolve as AgentModel;
}

export function createInternalAgent(model: AgentModel) {
	return new Agent<"maleo-agent", ToolsInput, undefined, AgentRunContext>({
		id: "maleo-agent",
		name: "maleo agent",
		instructions: agentInstructions,
		model: modelFor(model),
		// The run's own tools, then its workspace's allowlisted external ones (mcp-tools.ts).
		tools: async ({ requestContext }: { requestContext: RequestContext<AgentRunContext> }) => ({
			...(await externalToolsFor({ requestContext })),
			...agentToolsFor({ requestContext }),
			...definitionToolsFor(requestContext),
			ask_user: askUserTool,
		}),
		workflows: agentWorkflowsFor,
		// Settles the AgentJob on whichever worker finishes the generation (settle.ts).
		// SAFETY: settleProcessor implements processOutputResult, the one output-processor method it needs.
		outputProcessors: [settleProcessor as never],
		defaultOptions: AGENT_RUN_OPTIONS,
	});
}
