import { filterKnownCastIds } from "@maleo/shared";
import { defineTool } from "../../types.ts";
import { addSceneArgs } from "../../helpers/schemas.ts";
import { DEFAULT_SCENE_DUR_SEC } from "../../helpers/consts.ts";
import { projectRoster } from "../../visual-gen.ts";

export const addScene = defineTool({
	name: "add_scene",
	kind: "mutate",
	builds: true,
	contentType: ["video"],
	intents: ["build_short", "add_element"],
	input: addSceneArgs,
	description:
		"add_scene { name, visual, voiceover, durationSec, shot, move, transition?, action?, sfx?, beat?, emotion?, intent?, question?, claim?, evidence?, analogy?, visualType?, onScreenText?, refIds? } - append a new beat (story beat / scene); add_beat is an alias. When a Style direction is given, set beat (hook|setup|conflict|twist|resolution|cta), a one-word emotion, and a short intent. For explainers also set visualType (scene|contrast|timeline|map|diagram|evidence|metaphor|joke|reveal). When Available cast is listed, set refIds to the cast ids that appear in this scene.",
	handler: async (ctx, args) => {
		const job = ctx.job;
		const h = ctx.helpers;
		// Per-scene cast: keep only ids that exist in the project roster (drop any
		// the model invented). Empty → the scene inherits the project-wide refs.
		const declaredRefIds = Array.isArray(args.refIds)
			? args.refIds.filter((x): x is string => typeof x === "string")
			: [];
		const refIds = declaredRefIds.length
			? filterKnownCastIds(declaredRefIds, await projectRoster(job.projectId))
			: [];
		job.scenes.push({
			refIds: refIds.length ? refIds : undefined,
			name: args.name ?? `Scene ${job.scenes.length + 1}`,
			durationSec: h.clampSceneDuration(args.durationSec ?? DEFAULT_SCENE_DUR_SEC),
			shot: args.shot ?? "Medium Shot",
			move: args.move ?? "Static",
			// Leave transition to the auto-resolver (syncSceneTransitions) unless the
			// model named one explicitly — then lock it so the resolver won't override.
			transition: args.transition ?? "fade",
			transitionLocked: args.transition?.trim() ? true : undefined,
			visual: args.visual ?? "",
			voiceover: args.voiceover ?? "",
			action: args.action || undefined,
			sfx: args.sfx || undefined,
			beat: args.beat || undefined,
			emotion: args.emotion || undefined,
			intent: args.intent || undefined,
			question: args.question || undefined,
			claim: args.claim || undefined,
			evidence: args.evidence || undefined,
			analogy: args.analogy || undefined,
			visualType: args.visualType || undefined,
			onScreenText: args.onScreenText || undefined,
		});
		return { note: `Added scene ${job.scenes.length}: ${job.scenes[job.scenes.length - 1]!.name}` };
	},
});
