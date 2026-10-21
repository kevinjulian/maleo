/* `create_story_video`: the one-shot build as a workflow definition on the engine. */
import { createLongformArgs } from "../../helpers/schemas.ts";
import { stageContracts } from "../../engine/contracts.ts";
import { CREATE_STORY_VIDEO } from "../../engine/planning/one-shot.ts";
import { planningRegistry } from "../../engine/planning/registry.ts";
import { workflowTool } from "./workflow-tools.ts";

export const createStoryVideoTool = workflowTool({
	id: CREATE_STORY_VIDEO.id,
	description: `create_story_video { brief?, targetDurationSec?, voice? } - ${CREATE_STORY_VIDEO.description}`,
	inputSchema: createLongformArgs,
	workflow: CREATE_STORY_VIDEO.id,
	registry: planningRegistry,
	report: CREATE_STORY_VIDEO.id,
	builds: true,
	contract: stageContracts,
});
