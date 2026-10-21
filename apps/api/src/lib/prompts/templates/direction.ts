/* Free-text direction routing into Story, Visual, Voice and Rules. */
import type { PromptTemplate } from "@maleo/shared";

export const DIRECTION_TEMPLATES: readonly PromptTemplate[] = [
	{
		id: "prompt:content:directionRouterPrompt",
		description: "Separate free-text direction into Story, Visual, Voice and Rules guidance.",
		body: [
			'Split the operator\'s free-text video direction into four channels for a content-video pipeline. Assign each phrase to exactly one channel; leave a channel empty when nothing applies.\n\n- story: subject, narrative, tone, theme, structure, what the video is ABOUT.\n- visual: image look — style, medium, palette, background, composition, characters/figures.\n- voice: narration — narrator gender/character, language, pacing, delivery.\n- rules: hard constraints and prohibitions that every stage must obey — "no captions", "no humans on screen", "keep the logo exact". Phrase these as constraints, not preferences.\n\nA negative or absolute ("no ...", "never ...", "must ...", "always ...") belongs in rules, not in the channel it talks about.\n\nDirection:\n"""\n',
			{ type: "slot", path: "raw" },
			'\n"""\n\nRespond with ONLY JSON: {"story":"...","visual":"...","voice":"...","rules":"..."}. Use empty strings for unused channels. No prose.',
		],
		response: {
			parser: "json.fenced",
			schema: "directionRoute",
			policy: "direction.storyFallback",
		},
	},
];
