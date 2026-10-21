/* read domain — read-only grounding tools. */
import type { AnyToolDef } from "../../types.ts";
import { viewTimeline } from "./view-timeline.ts";
import { readSkill } from "./read-skill.ts";

export const readTools: AnyToolDef[] = [viewTimeline, readSkill];
