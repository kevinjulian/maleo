/* The project style bible and the Story Bible's visual constants. */
import { truthy, type PromptTemplate } from "@maleo/shared";

export const BIBLE_TEMPLATES: readonly PromptTemplate[] = [
	{
		id: "prompt:content:generateStyleBible",
		description: "One line of visual style every shot follows, fitted to the locked constraints.",
		body: [
			"You are the art director for a LONGFORM narrated video. From the brief, define ONE concise visual style bible every shot must follow so the look stays consistent across all sections.\n\nCover, in order: medium/rendering technique, era/setting accuracy, color palette, lighting, lens/framing feel, and negative rules (what to avoid, e.g. no modern objects for a historical topic).\n\nTopic / brief: ",
			{ type: "slot", path: "brief", filters: ["trim", { default: "(none given)" }] },
			"",
			{
				type: "include",
				prompt: "prompt:constraints:lockedConstraintBlock",
				in: { locked: "locked" },
			},
			"\n\nRespond with ONE line: comma-separated descriptors only, no preamble, no markdown, max ~45 words.",
		],
		response: { parser: "text.oneLine", schema: "styleBibleLine", policy: "style.bestEffort" },
	},
	{
		id: "prompt:content:authorStoryBible",
		description:
			"The story's visual constants — subjects, locations, look and negatives — authored once at plan time.",
		body: [
			"You are the art director for a narrated video. Record the story's VISUAL CONSTANTS — the things that must look identical in every shot — as JSON.\n\nThese are authored ONCE. Per-shot authoring later describes only what a shot shows; it cannot restate the look. So everything that must not drift belongs here.\n\nTopic / brief: ",
			{ type: "slot", path: "brief", filters: ["collapseWs", "trim", { default: "(none given)" }] },
			"",
			{
				type: "when",
				if: { not: { empty: "opts.summary" } },
				then: [
					"\n\nStyle summary already locked for this project (stay consistent with it): ",
					{ type: "slot", path: "opts.summary", filters: ["collapseWs", "trim"] },
					"",
				],
			},
			"",
			{
				type: "when",
				if: { not: { empty: "opts.plannedReferences" } },
				then: [
					"\n\nPlanned cast (these WILL be added; do not omit them, and use these exact labels):\n",
					{
						type: "each",
						path: "opts.plannedReferences",
						as: "ref",
						sep: "\n",
						template: [
							"- ",
							{ type: "slot", path: "ref.label" },
							" (",
							{ type: "slot", path: "ref.role" },
							"): ",
							{ type: "slot", path: "ref.description" },
							"",
						],
					},
					"",
				],
			},
			"",
			{
				type: "when",
				if: { not: { empty: "opts.boundLabels" } },
				then: [
					"\n\nDirection already owns these reference entries: ",
					{
						type: "format",
						name: "joinUnique",
						in: { list: "opts.boundLabels", sep: { value: ", " } },
					},
					". Do NOT author subjects or locations for them; they are added deterministically after this call.",
				],
			},
			"",
			{
				type: "when",
				if: truthy("opts.povLifecycle.viewerRole"),
				then: [
					"\n\nThe viewer experiences the story as: ",
					{ type: "slot", path: "opts.povLifecycle.viewerRole" },
					". That body is a subject.",
				],
			},
			"",
			{
				type: "include",
				prompt: "prompt:constraints:lockedConstraintBlock",
				in: { locked: "opts.locked" },
			},
			"\n\nRules:\n- `subjects`: every recurring thing a shot can be ABOUT. Give each a short kebab-case `id`, a `label`, `aliases` (the words the NARRATION uses for it",
			{
				type: "when",
				if: truthy("opts.language"),
				then: [", written in ", { type: "slot", path: "opts.language" }, " as the narration is"],
			},
			'), `descriptors` (visible traits that must stay stable), and `mustAvoid`.\n- `locations`: recurring places, same shape without aliases.\n- `negatives`: what must never appear in any shot.\n- Style fields describe the whole story, never one shot.\n- At least one subject. Aliases matter: they are matched against narration text later.\n\nRespond with ONLY compact JSON:\n{"subjects":[{"id":"","label":"","aliases":[],"descriptors":[],"mustAvoid":[]}],"locations":[{"id":"","label":"","descriptors":[]}],"medium":"","realism":"","visualTreatment":"","lighting":"","palette":"","moodDefault":"","cameraLanguage":{"defaultShot":"","angleVocabulary":[]},"negatives":[]}\nNo markdown, no commentary.',
		],
		response: { parser: "json.fenced", schema: "storyBibleDraft", policy: "bible.bestEffort" },
	},
];
