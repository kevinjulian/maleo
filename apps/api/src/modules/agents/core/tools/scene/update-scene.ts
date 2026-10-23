import { defineTool } from "../../types.ts";
import { updateSceneArgs } from "../../helpers/schemas.ts";
import { EMOTIONS, oneOf, STORY_BEATS, VISUAL_TYPES, type Scene } from "@maleo/shared";
import { sceneEditCommand } from "@maleo/shared/editor";
import { clipAt, runDocument, runEdit } from "../../edit-document.ts";

export const updateScene = defineTool({
	name: "update_scene",
	kind: "mutate",
	builds: true,
	edits: true,
	contentType: ["video"],
	intents: ["edit_element"],
	input: updateSceneArgs,
	description:
		"update_scene { index, name?, visual?, voiceover?, durationSec?, shot?, move?, transition?, action?, sfx?, beat?, emotion?, intent?, question?, claim?, evidence?, analogy?, visualType?, onScreenText?, refIds? } - edit scene at 0-based index",
	handler: async (ctx, args) => {
		const doc = runDocument(ctx.job);
		const scene = clipAt(doc, "scene", args.index).scene!;
		const h = ctx.helpers;
		// An empty string clears an optional field; an absent one leaves it alone.
		const clear = (v: string | undefined) => v || undefined;
		const patch: Partial<Scene> = {
			...(args.name != null ? { name: args.name } : {}),
			...(args.visual != null ? { vis: args.visual } : {}),
			...(args.voiceover != null ? { vo: args.voiceover } : {}),
			...(args.shot != null ? { shot: args.shot } : {}),
			...(args.move != null ? { move: args.move } : {}),
			...(args.durationSec != null ? { dur: h.clampSceneDuration(args.durationSec) } : {}),
			...(args.beat != null ? { beat: oneOf(args.beat, STORY_BEATS) } : {}),
			...(args.emotion != null ? { emotion: oneOf(args.emotion, EMOTIONS) } : {}),
			...(args.intent != null ? { intent: clear(args.intent) } : {}),
			...(args.question != null ? { question: clear(args.question) } : {}),
			...(args.claim != null ? { claim: clear(args.claim) } : {}),
			...(args.evidence != null ? { evidence: clear(args.evidence) } : {}),
			...(args.analogy != null ? { analogy: clear(args.analogy) } : {}),
			...(args.visualType != null ? { visualType: oneOf(args.visualType, VISUAL_TYPES) } : {}),
			...(args.onScreenText != null ? { onScreenText: clear(args.onScreenText) } : {}),
		};
		runEdit(ctx.job, sceneEditCommand(doc, scene.id, patch));
		return { note: `Updated scene ${args.index + 1}` };
	},
});
