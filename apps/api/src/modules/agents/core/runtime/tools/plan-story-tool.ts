/* `workflow-plan_story`: video planning as a workflow definition run by the
 * engine inside the agent's tool call. The name and input are the ones the agent
 * instructions already describe. */
import { z } from "zod";
import { planStoryArgs } from "../../helpers/schemas.ts";
import { stageContracts } from "../../engine/contracts.ts";
import { PLAN_STORY } from "../../engine/planning/definitions.ts";
import { planningRegistry } from "../../engine/planning/registry.ts";
import { workflowTool } from "./workflow-tools.ts";

export const PLAN_STORY_TOOL = "workflow-plan_story";

export const planStoryTool = workflowTool({
	id: PLAN_STORY_TOOL,
	description: PLAN_STORY.description,
	inputSchema: z.object({ inputData: planStoryArgs }),
	workflow: PLAN_STORY.id,
	registry: planningRegistry,
	input: (args) => args.inputData,
	contract: stageContracts,
});
