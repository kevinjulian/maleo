import { defineTool } from "../../types.ts";
import { requiresIndex } from "../../helpers/schemas.ts";
import { sceneEditCommand } from "@maleo/shared/editor";
import { clipAt, runDocument, runEdit } from "../../edit-document.ts";

export const removeScene = defineTool({
	name: "remove_scene",
	kind: "mutate",
	builds: true,
	edits: true,
	contentType: ["video"],
	intents: ["edit_element"],
	input: requiresIndex,
	description: "remove_scene { index }",
	handler: async (ctx, args) => {
		const doc = runDocument(ctx.job);
		const scene = clipAt(doc, "scene", args.index).scene!;
		runEdit(ctx.job, sceneEditCommand(doc, scene.id, "remove"));
		return { note: `Removed scene "${scene.name}"` };
	},
});
