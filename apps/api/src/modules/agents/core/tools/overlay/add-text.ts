import { PLAIN_TEXT_AUTHOR_STYLE, defaultClipLayout } from "@maleo/shared";
import { defineTool } from "../../types.ts";
import { addTextArgs } from "../../helpers/schemas.ts";
import { DEFAULT_TEXT_DUR_SEC } from "../../helpers/consts.ts";
import { freshClipId } from "../../helpers/ids.ts";
import { placeOverlay } from "../../edit-document.ts";

export const addText = defineTool({
	name: "add_text",
	kind: "mutate",
	builds: true,
	edits: true,
	contentType: ["video"],
	intents: ["add_element"],
	input: addTextArgs,
	description:
		"add_text { content, startSec, durationSec, preset? } - add an on-screen text overlay. preset is plain. Style and animation use the existing clip controls.",
	handler: async (ctx, args) => {
		const job = ctx.job;
		const preset = "plain";
		placeOverlay(job, "textOverlays", {
			id: freshClipId(),
			content: args.content ?? "Title",
			startSec: Math.max(0, args.startSec ?? 0),
			durationSec: Math.max(0.5, args.durationSec ?? DEFAULT_TEXT_DUR_SEC),
			preset,
			style: { ...PLAIN_TEXT_AUTHOR_STYLE },
			layout: defaultClipLayout("text"),
		});
		return { note: `Added ${preset} text "${args.content ?? "Title"}"` };
	},
});
