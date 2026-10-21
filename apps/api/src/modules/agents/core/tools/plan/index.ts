/* plan domain — the story outline. Story planning is the plan_story workflow definition (engine/planning/). */
import type { AnyToolDef } from "../../types.ts";
import { createStoryOutline } from "./create-story-outline.ts";

export const planTools: AnyToolDef[] = [createStoryOutline];
