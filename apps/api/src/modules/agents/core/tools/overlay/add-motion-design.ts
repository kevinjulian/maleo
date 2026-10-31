import { authorMotionDesign, MOTION_INTENT_PROMPT } from "../../../../../lib/motion-author.ts";
import { defineTool } from "../../types.ts";
import { addMotionDesignArgs } from "../../helpers/schemas.ts";
import { freshClipId } from "../../helpers/ids.ts";
import { placeOverlays } from "../../edit-document.ts";
import { getStyleBible } from "../../plan-state.ts";

/* One moment of motion design (motion-design-generation): the model decides the
 * layers, the shared compiler decides every key, and the result is placed as one
 * clip per layer on lanes above the existing overlays, through one batch
 * command, so it is one undo step and every key is editable on the timeline. A
 * refused or failed authoring throws, which the tool envelope reports as an
 * error; nothing is placed. */
export const addMotionDesign = defineTool({
	name: "add_motion_design",
	kind: "generate",
	builds: true,
	edits: true,
	inspection: {
		prompts: [MOTION_INTENT_PROMPT],
		promptMode: "passthrough",
		operations: [
			{
				id: "operation:add_motion_design:service",
				label: "Author motion intent, compile it, place one composition clip",
				description:
					"Author a motion intent, compile it with the motion tokens, lint it, then place one composition clip through editor commands.",
				source: "apps/api/src/modules/agents/core/tools/overlay/add-motion-design.ts",
				conditions: ["A refused intent is retried once; a second refusal places nothing."],
			},
		],
	},
	contentType: ["video"],
	intents: ["add_element"],
	input: addMotionDesignArgs,
	description:
		'add_motion_design { description, startSec, durationSec, text?, presentation? } - add animated motion graphics built from text and shapes (title cards, callouts, underlines, list reveals) as ONE editable composition clip. `text` is the exact on-screen wording (nothing else is written); `description` says what the motion should show; presentation is headline|explainer|transition (default headline). e.g. { description: "bold title card with an accent bar", startSec: 4, durationSec: 3, text: "Ship faster" }',
	handler: async (ctx, args) => {
		const job = ctx.job;
		const sourceText = args.text?.trim() ?? "";
		const result = await authorMotionDesign({
			sourceText,
			presentation: args.presentation ?? "headline",
			spanSec: args.durationSec,
			aspect: job.aspect,
			visualConcept: args.description,
			visualStyle: getStyleBible(job),
		});
		if (!result.ok) throw new Error(`add_motion_design refused: ${result.error}`);
		// One clip per layer, each on its own lane, all in one batch: one undo step.
		const base = freshClipId();
		const lane = Math.max(1, ...job.textOverlays.map((t) => (t.track ?? 0) + 1));
		placeOverlays(
			job,
			"textOverlays",
			result.clips.map((clip, index) => ({
				id: base + index,
				content: clip.content,
				startSec: args.startSec + clip.startSec,
				durationSec: clip.durationSec,
				preset: clip.preset,
				...(clip.style ? { style: clip.style } : {}),
				...(clip.params ? { params: clip.params } : {}),
				layout: clip.layout,
				track: lane + clip.lane,
			})),
			"Add motion design",
		);
		const findings = result.findings.length
			? ` Motion notes: ${result.findings.map((f) => f.message).join("; ")}.`
			: "";
		return {
			note: `Added motion design (${result.clips.length} clips) at ${args.startSec}s for ${args.durationSec}s.${findings}`,
		};
	},
});
