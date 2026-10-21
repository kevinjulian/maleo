import { defineTool } from "../../types.ts";
import type { AgentAudioOverlay } from "../../model.ts";
import { resolveStockAudio } from "@maleo/stock";
import { addAudioArgs } from "../../helpers/schemas.ts";
import {
	AUDIO_OVERLAY_KINDS,
	DEFAULT_AUDIO_DUR_SEC,
	DEFAULT_ACCENT_HIT_DUR_SEC,
} from "../../helpers/consts.ts";
import { freshClipId } from "../../helpers/ids.ts";
import { oneOf } from "@maleo/shared";
import { placeOverlay } from "../../edit-document.ts";

export const addAudio = defineTool({
	name: "add_audio",
	kind: "mutate",
	builds: true,
	edits: true,
	contentType: ["video"],
	intents: ["add_element"],
	input: addAudioArgs,
	description:
		'add_audio { kind, content, startSec, durationSec, url? } - place a non-voiceover audio cue on the timeline. kind: sfx (one-shot), ambient (background bed), accent_hit (stinger on a beat), music. content is a short search phrase (e.g. "sword clash", "tense drone"); leave url empty and it is resolved from the curated music library or Freesound SFX.',
	handler: async (ctx, args) => {
		const job = ctx.job;
		const rawKind = args.kind ?? "sfx";
		// The tool accepts four non-voiceover kinds, which are exactly the stock
		// audio kinds — so `oneOf` narrows once and both uses below read that.
		const kind = oneOf(rawKind, AUDIO_OVERLAY_KINDS) ?? "sfx";
		const content = args.content ?? kind;
		let url = args.url ?? "";
		let origin: AgentAudioOverlay["origin"];
		if (!url) {
			const hit = await resolveStockAudio(kind, content);
			if (hit) {
				url = hit.url;
				origin = "stock";
			}
		}
		placeOverlay(job, "audioOverlays", {
			id: freshClipId(),
			kind,
			origin,
			content,
			url,
			startSec: Math.max(0, args.startSec ?? 0),
			durationSec: Math.max(
				0.3,
				(args.durationSec ?? kind === "accent_hit")
					? DEFAULT_ACCENT_HIT_DUR_SEC
					: DEFAULT_AUDIO_DUR_SEC,
			),
		});
		return {
			note: url
				? `Added ${kind} "${content}"`
				: `Added ${kind} cue "${content}" (no matching stock audio — provide a url or set a provider key)`,
		};
	},
});
