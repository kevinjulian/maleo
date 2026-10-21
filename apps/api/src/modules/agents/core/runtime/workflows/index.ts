import { storyAssetsWorkflow } from "./story-assets.ts";

/* The Mastra workflows. Video planning is a workflow definition on the engine
 * (engine/planning/), offered as the `workflow-plan_story` tool. */
export const AGENT_WORKFLOWS = { generate_story_assets: storyAssetsWorkflow };
