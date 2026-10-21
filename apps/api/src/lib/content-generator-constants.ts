import { MIN_SHORTFORM_SCENE_SEC, MAX_SHORTFORM_SCENE_SEC } from "@maleo/shared";

/** The most shots one story section may plan; the draft schema and its prompt both read it. */
export const MAX_STORY_SHOTS_PER_SECTION = 8;
export const SHORTFORM_SCENE_DURATION_RULE = `${MIN_SHORTFORM_SCENE_SEC}-${MAX_SHORTFORM_SCENE_SEC} seconds`;
