import { defineTool } from "../../types.ts";
import { infographicArgs } from "../../helpers/schemas.ts";
import { DEFAULT_INFOGRAPHIC_DUR_SEC, DEFAULT_INFOGRAPHIC_LAYOUT } from "../../helpers/consts.ts";
import { freshClipId } from "../../helpers/ids.ts";
import { infographicPayloadFromArgs } from "../../overlays.ts";
import { placeOverlay } from "../../edit-document.ts";

export const addInfographic = defineTool({
	name: "add_infographic",
	kind: "mutate",
	builds: true,
	edits: true,
	contentType: ["video"],
	intents: ["add_element"],
	input: infographicArgs,
	description:
		"add_infographic { type, title, startSec, durationSec, value?, suffix?, comparison?, unit?, price?, compareAt?, note?, rows?, columns?, tableRows?, highlight?, track?, layout? } - add a structured Remotion clip (JSON only, never JSX/CSS animation) rendered as a timeline overlay. Remotion timing comes from startSec + durationSec; animation is frame-derived in the renderer. type: stat_reveal (title,value,suffix?,comparison?), bar_chart (title,rows:[{label,value,color?}],unit?), table_build (title,columns,tableRows:string[][],highlight?), price_tag (title,price,compareAt?,note?). Use for moving charts, tables, metric reveals, price/offer callouts, and data explainers.",
	handler: async (ctx, args) => {
		const job = ctx.job;
		const payload = infographicPayloadFromArgs(args);
		placeOverlay(job, "infographicOverlays", {
			id: freshClipId(),
			startSec: Math.max(0, args.startSec ?? 0),
			durationSec: Math.max(1, args.durationSec ?? DEFAULT_INFOGRAPHIC_DUR_SEC),
			track: Math.max(0, Math.round(args.track ?? 0)),
			layout: {
				...DEFAULT_INFOGRAPHIC_LAYOUT,
				...args.layout,
			},
			animation: {
				in: "slide_up",
				main: payload.type === "stat_reveal" ? "count" : "build",
				out: "fade",
			},
			payload,
		});
		return { note: `Added ${payload.type.replace(/_/g, " ")} infographic "${payload.title}"` };
	},
});
