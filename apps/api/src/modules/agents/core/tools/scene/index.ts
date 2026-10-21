/* scene domain — add / update / remove story beats. */
import type { AnyToolDef } from "../../types.ts";
import { addScene } from "./add-scene.ts";
import { updateScene } from "./update-scene.ts";
import { removeScene } from "./remove-scene.ts";

export const sceneTools: AnyToolDef[] = [addScene, updateScene, removeScene];
