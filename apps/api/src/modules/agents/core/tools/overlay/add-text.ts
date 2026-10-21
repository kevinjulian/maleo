import { defineTool } from "../../types.ts";
import { addTextArgs } from "../../helpers/schemas.ts";
import { TEXT_PRESETS, DEFAULT_TEXT_DUR_SEC } from "../../helpers/consts.ts";
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
		"add_text { content, startSec, durationSec, preset? } - add an on-screen text overlay. preset picks the text role: title, subtitle, lower-third, stat (big number), quote, location, timeline (year/date), chapter.",
	handler: async (ctx, args) => {
		const job = ctx.job;
		const rawPreset = args.preset ?? "";
		const preset = TEXT_PRESETS.has(rawPreset) ? rawPreset : undefined;
		placeOverlay(job, "textOverlays", {
			id: freshClipId(),
			content: args.content ?? "Title",
			startSec: Math.max(0, args.startSec ?? 0),
			durationSec: Math.max(0.5, args.durationSec ?? DEFAULT_TEXT_DUR_SEC),
			preset,
		});
		return { note: `Added ${preset ?? "title"} text "${args.content ?? "Title"}"` };
	},
});
