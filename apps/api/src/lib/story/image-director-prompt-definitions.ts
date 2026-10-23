import type { PromptFragment } from "@maleo/shared";

// Fixed instruction fragments consumed by the production builders in image-director.ts.
export const PROMPT_FRAGMENTS = {
	closedListBlockFragment0: {
		owner: "closedListBlock",
		parts: ["- ", " — ", "", ""],
		variables: [
			{ name: "subject.id", type: "string", required: true, source: "subject.id" },
			{ name: "subject.label", type: "string", required: true, source: "subject.label" },
			{
				name: 'subject.descriptors.length ? ` (${subject.descriptors.join("; ")})` : ""',
				type: "string",
				required: true,
				source: 'subject.descriptors.length ? ` (${subject.descriptors.join("; ")})` : ""',
			},
		],
	},
	closedListBlockFragment1: {
		owner: "closedListBlock",
		parts: [" (", ")"],
		variables: [
			{
				name: 'subject.descriptors.join("; ")',
				type: "string",
				required: true,
				source: 'subject.descriptors.join("; ")',
				condition: "Conditional: subject.descriptors.length",
			},
		],
		condition: "Conditional: subject.descriptors.length",
	},
	closedListBlockFragment2: {
		owner: "closedListBlock",
		parts: ["; "],
		variables: [],
		condition: "Conditional: subject.descriptors.length",
	},
	closedListBlockFragment3: { owner: "closedListBlock", parts: ["\n"], variables: [] },
	closedListBlockFragment4: {
		owner: "closedListBlock",
		parts: ["- ", " — ", "", ""],
		variables: [
			{ name: "location.id", type: "string", required: true, source: "location.id" },
			{ name: "location.label", type: "string", required: true, source: "location.label" },
			{
				name: 'location.descriptors.length ? ` (${location.descriptors.join("; ")})` : ""',
				type: "string",
				required: true,
				source: 'location.descriptors.length ? ` (${location.descriptors.join("; ")})` : ""',
			},
		],
	},
	closedListBlockFragment5: {
		owner: "closedListBlock",
		parts: [" (", ")"],
		variables: [
			{
				name: 'location.descriptors.join("; ")',
				type: "string",
				required: true,
				source: 'location.descriptors.join("; ")',
				condition: "Conditional: location.descriptors.length",
			},
		],
		condition: "Conditional: location.descriptors.length",
	},
	closedListBlockFragment6: {
		owner: "closedListBlock",
		parts: ["; "],
		variables: [],
		condition: "Conditional: location.descriptors.length",
	},
	closedListBlockFragment7: { owner: "closedListBlock", parts: ["\n"], variables: [] },
	closedListBlockFragment8: {
		owner: "closedListBlock",
		parts: ["\nSubjects — use these EXACT ids in subjectIds, never invent one:\n", "\n", ""],
		variables: [
			{
				name: 'subjects || "- (none)"',
				type: "string",
				required: true,
				source: 'subjects || "- (none)"',
				default: '"- (none)"',
			},
			{
				name: 'locations ? `\\nLocations — use these EXACT ids in locationId:\\n${locations}\\n` : ""',
				type: "string",
				required: true,
				source:
					'locations ? `\\nLocations — use these EXACT ids in locationId:\\n${locations}\\n` : ""',
			},
		],
	},
	closedListBlockFragment9: { owner: "closedListBlock", parts: ["- (none)"], variables: [] },
	closedListBlockFragment10: {
		owner: "closedListBlock",
		parts: ["\nLocations — use these EXACT ids in locationId:\n", "\n"],
		variables: [
			{
				name: "locations",
				type: "string",
				required: true,
				source: "locations",
				condition: "Conditional: locations",
			},
		],
		condition: "Conditional: locations",
	},
	storyBeatVisualPromptFragment0: {
		owner: "storyBeatVisualPrompt",
		parts: [" | planned POV: ", ""],
		variables: [
			{
				name: '[\n\t\t\t\tbeat.povShot.cameraRole ? `camera ${beat.povShot.cameraRole}` : "",\n\t\t\t\tbeat.povShot.location ? `location ${beat.povShot.location}` : "",\n\t\t\t\tbeat.povShot.bodyAction ? `body ${beat.povShot.bodyAction}` : "",\n\t\t\t\tbeat.povShot.propFocus ? `prop ${beat.povShot.propFocus}` : "",\n\t\t\t\tbeat.povShot.emotionalPressure ? `pressure ${beat.povShot.emotionalPressure}` : "",\n\t\t\t\tbeat.povShot.noveltyKey ? `novelty ${beat.povShot.noveltyKey}` : "",\n\t\t\t].filter(Boolean).join(", ")',
				type: "string",
				required: true,
				source:
					'[\n\t\t\t\tbeat.povShot.cameraRole ? `camera ${beat.povShot.cameraRole}` : "",\n\t\t\t\tbeat.povShot.location ? `location ${beat.povShot.location}` : "",\n\t\t\t\tbeat.povShot.bodyAction ? `body ${beat.povShot.bodyAction}` : "",\n\t\t\t\tbeat.povShot.propFocus ? `prop ${beat.povShot.propFocus}` : "",\n\t\t\t\tbeat.povShot.emotionalPressure ? `pressure ${beat.povShot.emotionalPressure}` : "",\n\t\t\t\tbeat.povShot.noveltyKey ? `novelty ${beat.povShot.noveltyKey}` : "",\n\t\t\t].filter(Boolean).join(", ")',
				condition: "Conditional: beat.povShot",
			},
		],
		condition: "Conditional: beat.povShot",
	},
	storyBeatVisualPromptFragment1: {
		owner: "storyBeatVisualPrompt",
		parts: ["camera ", ""],
		variables: [
			{
				name: "beat.povShot.cameraRole",
				type: '"companion_view" | "first_person_hands" | "body_detail" | "object_closeup" | "environment_establishing" | "reflection_shadow" | "threat_pov" | "over_shoulder" | "system_view"',
				required: true,
				source: "beat.povShot.cameraRole",
				condition: "Conditional: beat.povShot; Conditional: beat.povShot.cameraRole",
			},
		],
		condition: "Conditional: beat.povShot; Conditional: beat.povShot.cameraRole",
	},
	storyBeatVisualPromptFragment2: {
		owner: "storyBeatVisualPrompt",
		parts: ["location ", ""],
		variables: [
			{
				name: "beat.povShot.location",
				type: "string",
				required: true,
				source: "beat.povShot.location",
				condition: "Conditional: beat.povShot; Conditional: beat.povShot.location",
			},
		],
		condition: "Conditional: beat.povShot; Conditional: beat.povShot.location",
	},
	storyBeatVisualPromptFragment3: {
		owner: "storyBeatVisualPrompt",
		parts: ["body ", ""],
		variables: [
			{
				name: "beat.povShot.bodyAction",
				type: "string",
				required: true,
				source: "beat.povShot.bodyAction",
				condition: "Conditional: beat.povShot; Conditional: beat.povShot.bodyAction",
			},
		],
		condition: "Conditional: beat.povShot; Conditional: beat.povShot.bodyAction",
	},
	storyBeatVisualPromptFragment4: {
		owner: "storyBeatVisualPrompt",
		parts: ["prop ", ""],
		variables: [
			{
				name: "beat.povShot.propFocus",
				type: "string",
				required: true,
				source: "beat.povShot.propFocus",
				condition: "Conditional: beat.povShot; Conditional: beat.povShot.propFocus",
			},
		],
		condition: "Conditional: beat.povShot; Conditional: beat.povShot.propFocus",
	},
	storyBeatVisualPromptFragment5: {
		owner: "storyBeatVisualPrompt",
		parts: ["pressure ", ""],
		variables: [
			{
				name: "beat.povShot.emotionalPressure",
				type: "string",
				required: true,
				source: "beat.povShot.emotionalPressure",
				condition: "Conditional: beat.povShot; Conditional: beat.povShot.emotionalPressure",
			},
		],
		condition: "Conditional: beat.povShot; Conditional: beat.povShot.emotionalPressure",
	},
	storyBeatVisualPromptFragment6: {
		owner: "storyBeatVisualPrompt",
		parts: ["novelty ", ""],
		variables: [
			{
				name: "beat.povShot.noveltyKey",
				type: "string",
				required: true,
				source: "beat.povShot.noveltyKey",
				condition: "Conditional: beat.povShot; Conditional: beat.povShot.noveltyKey",
			},
		],
		condition: "Conditional: beat.povShot; Conditional: beat.povShot.noveltyKey",
	},
	storyBeatVisualPromptFragment7: {
		owner: "storyBeatVisualPrompt",
		parts: [", "],
		variables: [],
		condition: "Conditional: beat.povShot",
	},
	storyBeatVisualPromptFragment8: {
		owner: "storyBeatVisualPrompt",
		parts: ["[", "] (", "s) ", "", ""],
		variables: [
			{ name: "index", type: "number", required: true, source: "index" },
			{
				name: "(beat.durationSec ?? 0).toFixed(1)",
				type: "string",
				required: true,
				source: "(beat.durationSec ?? 0).toFixed(1)",
			},
			{
				name: 'beat.text.replace(/\\s+/g, " ").trim()',
				type: "string",
				required: true,
				source: 'beat.text.replace(/\\s+/g, " ").trim()',
			},
			{ name: "pov", type: "string", required: true, source: "pov" },
		],
	},
	storyBeatVisualPromptFragment9: { owner: "storyBeatVisualPrompt", parts: [" "], variables: [] },
	storyBeatVisualPromptFragment10: { owner: "storyBeatVisualPrompt", parts: ["\n"], variables: [] },
	storyBeatVisualPromptFragment11: {
		owner: "storyBeatVisualPrompt",
		parts: ["- ", ". ", ""],
		variables: [
			{ name: "index + 1", type: "number", required: true, source: "index + 1" },
			{
				name: 'shot.replace(/\\s+/g, " ").trim()',
				type: "string",
				required: true,
				source: 'shot.replace(/\\s+/g, " ").trim()',
			},
		],
	},
	storyBeatVisualPromptFragment12: { owner: "storyBeatVisualPrompt", parts: [" "], variables: [] },
	storyBeatVisualPromptFragment13: { owner: "storyBeatVisualPrompt", parts: ["\n"], variables: [] },
	storyBeatVisualPromptFragment14: {
		owner: "storyBeatVisualPrompt",
		parts: [
			"\nApproved reference bindings — each measured beat may select only from these exact objects; copy selected objects into referenceBindings in display order:\n",
			"\n",
		],
		variables: [
			{
				name: "JSON.stringify(opts.approvedBindings)",
				type: "string",
				required: true,
				source: "JSON.stringify(opts.approvedBindings)",
				condition: "Conditional: opts?.approvedBindings?.length",
			},
		],
		condition: "Conditional: opts?.approvedBindings?.length",
	},
	storyBeatVisualPromptFragment15: {
		owner: "storyBeatVisualPrompt",
		parts: [
			"\nApproved sequence direction — obey it: purpose=",
			"; presentation=",
			"; visual concept=",
			"; novelty=",
			"; native overlay text=",
			"; SFX=",
			". Native overlay text is rendered by Maleo; never include it in visualMoment or any image-facing field.\n",
		],
		variables: [
			{
				name: "editorial.purpose",
				type: '"establish" | "explain" | "contrast" | "reveal" | "consequence" | "resolve"',
				required: true,
				source: "editorial.purpose",
				condition: "Conditional: editorial",
			},
			{
				name: "editorial.presentation",
				type: '"explainer" | "transition" | "narrative" | "headline"',
				required: true,
				source: "editorial.presentation",
				condition: "Conditional: editorial",
			},
			{
				name: "editorial.visualConcept",
				type: "string",
				required: true,
				source: "editorial.visualConcept",
				condition: "Conditional: editorial",
			},
			{
				name: "editorial.noveltyKey",
				type: "string",
				required: true,
				source: "editorial.noveltyKey",
				condition: "Conditional: editorial",
			},
			{
				name: 'editorial.onScreenText ?? "none"',
				type: "string",
				required: true,
				source: 'editorial.onScreenText ?? "none"',
				default: '"none"',
				condition: "Conditional: editorial",
			},
			{
				name: 'editorial.sfxCue ?? "silence"',
				type: "string",
				required: true,
				source: 'editorial.sfxCue ?? "silence"',
				default: '"silence"',
				condition: "Conditional: editorial",
			},
		],
		condition: "Conditional: editorial",
	},
	storyBeatVisualPromptFragment16: {
		owner: "storyBeatVisualPrompt",
		parts: ["none"],
		variables: [],
		condition: "Conditional: editorial",
	},
	storyBeatVisualPromptFragment17: {
		owner: "storyBeatVisualPrompt",
		parts: ["silence"],
		variables: [],
		condition: "Conditional: editorial",
	},
	storyBeatVisualPromptFragment18: {
		owner: "storyBeatVisualPrompt",
		parts: [
			"You are the shot designer for one section of a narrated video. The narration is already recorded and cut into ",
			" visual beats. Describe what EACH beat shows, as fields.\n\nSection: ",
			"\nFull narration",
			": ",
			"\n\nBeats, in order — describe one for each index:\n",
			"",
			"",
			"\n",
			"",
			"",
			"",
			"",
			"",
			"",
			"\n\nFor each beat:\n- `visualMoment`: the concrete thing the frame shows for ITS beat. Pixel-facing English.\n- `action`: what is happening. `endState`: where the beat leaves things — the NEXT beat continues from it.\n- `subjectIds` / `locationId`: ids from the lists above only. A subject the narration names in this beat MUST appear in its subjectIds.\n- `shotType`, `cameraAngle`, `framing`: the camera, honouring any planned POV grammar.\n- `mustInclude` / `mustAvoid`: details specific to THIS beat. `noveltyKey`: what makes it unlike its neighbours.\n- `referenceBindings`: ordered approved bindings physically visible in THIS beat. Split or merge planned-shot intent as needed; never invent a binding.\n- `mood`: only when this beat departs from the story's default mood.\n\nRules:\n- Do NOT describe the story's medium, rendering style, lighting, palette, or negatives. Those are fixed for the whole story and are added automatically. A beat that restates them is rejected.\n- Every beat must differ from BOTH neighbours in at least one of visualMoment, shotType, cameraAngle, locationId, or subjectIds. Two beats that would render the same picture is the one failure mode this call exists to prevent.\n- No narration sentence, no subtitle or caption text, no timing fields, no beat labels.\n\nRespond with ONLY compact JSON, exactly ",
			" entries, one per beat index 0..",
			':\n{"visuals":[{"beatIndex":0,"subjectIds":[],"locationId":"","visualMoment":"","action":"","endState":"","shotType":"","cameraAngle":"","framing":"","mustInclude":[],"mustAvoid":[],"noveltyKey":"","referenceBindings":[]}]}\nNo markdown, no commentary.',
		],
		variables: [
			{ name: "beats.length", type: "number", required: true, source: "beats.length" },
			{ name: "section.title", type: "string", required: true, source: "section.title" },
			{
				name: 'opts?.language ? ` (language: ${opts.language})` : ""',
				type: "string",
				required: false,
				source: 'opts?.language ? ` (language: ${opts.language})` : ""',
			},
			{
				name: 'section.narration.replace(/\\s+/g, " ").trim()',
				type: "string",
				required: true,
				source: 'section.narration.replace(/\\s+/g, " ").trim()',
			},
			{ name: "beatLines", type: "string", required: true, source: "beatLines" },
			{ name: "editorialBlock", type: "string", required: true, source: "editorialBlock" },
			{ name: "approvedBindings", type: "string", required: true, source: "approvedBindings" },
			{
				name: 'opts?.previousEndState?.trim() ? `\\nThe beat BEFORE beat 0 ended here — beat 0 continues from it: ${opts.previousEndState.replace(/\\s+/g, " ").trim()}\\n` : ""',
				type: "string",
				required: false,
				source:
					'opts?.previousEndState?.trim() ? `\\nThe beat BEFORE beat 0 ended here — beat 0 continues from it: ${opts.previousEndState.replace(/\\s+/g, " ").trim()}\\n` : ""',
			},
			{
				name: "closedListBlock(opts?.bible)",
				type: "string",
				required: false,
				source: "closedListBlock(opts?.bible)",
			},
			{
				name: 'intent ? `\\nApproved visual intent for this section (the operator agreed the section should show these; spread them across the beats, do NOT copy their wording):\\n${intent}\\n` : ""',
				type: "string",
				required: true,
				source:
					'intent ? `\\nApproved visual intent for this section (the operator agreed the section should show these; spread them across the beats, do NOT copy their wording):\\n${intent}\\n` : ""',
			},
			{
				name: 'opts?.style?.trim() ? `\\nThe story\'s locked look, for context only — do NOT restate any of it in your answer; it is applied automatically to every beat: ${opts.style.replace(/\\s+/g, " ").trim()}\\n` : ""',
				type: "string",
				required: false,
				source:
					'opts?.style?.trim() ? `\\nThe story\'s locked look, for context only — do NOT restate any of it in your answer; it is applied automatically to every beat: ${opts.style.replace(/\\s+/g, " ").trim()}\\n` : ""',
			},
			{
				name: 'opts?.visual?.trim() ? `\\nProject Visual direction: ${opts.visual.replace(/\\s+/g, " ").trim()}\\n` : ""',
				type: "string",
				required: false,
				source:
					'opts?.visual?.trim() ? `\\nProject Visual direction: ${opts.visual.replace(/\\s+/g, " ").trim()}\\n` : ""',
			},
			{
				name: 'opts?.rules?.trim() ? `\\nHard constraints — obey exactly, never soften: ${opts.rules.replace(/\\s+/g, " ").trim()}\\n` : ""',
				type: "string",
				required: false,
				source:
					'opts?.rules?.trim() ? `\\nHard constraints — obey exactly, never soften: ${opts.rules.replace(/\\s+/g, " ").trim()}\\n` : ""',
			},
			{
				name: "lockedConstraintBlock(opts?.locked)",
				type: "string",
				required: false,
				source: "lockedConstraintBlock(opts?.locked)",
			},
			{ name: "beats.length", type: "number", required: true, source: "beats.length" },
			{ name: "beats.length - 1", type: "number", required: true, source: "beats.length - 1" },
		],
	},
	storyBeatVisualPromptFragment19: {
		owner: "storyBeatVisualPrompt",
		parts: [" (language: ", ")"],
		variables: [
			{
				name: "opts.language",
				type: "string",
				required: true,
				source: "opts.language",
				condition: "Conditional: opts?.language",
			},
		],
		condition: "Conditional: opts?.language",
	},
	storyBeatVisualPromptFragment20: { owner: "storyBeatVisualPrompt", parts: [" "], variables: [] },
	storyBeatVisualPromptFragment21: {
		owner: "storyBeatVisualPrompt",
		parts: ["\nThe beat BEFORE beat 0 ended here — beat 0 continues from it: ", "\n"],
		variables: [
			{
				name: 'opts.previousEndState.replace(/\\s+/g, " ").trim()',
				type: "string",
				required: true,
				source: 'opts.previousEndState.replace(/\\s+/g, " ").trim()',
				condition: "Conditional: opts?.previousEndState?.trim()",
			},
		],
		condition: "Conditional: opts?.previousEndState?.trim()",
	},
	storyBeatVisualPromptFragment22: {
		owner: "storyBeatVisualPrompt",
		parts: [" "],
		variables: [],
		condition: "Conditional: opts?.previousEndState?.trim()",
	},
	storyBeatVisualPromptFragment23: {
		owner: "storyBeatVisualPrompt",
		parts: [
			"\nApproved visual intent for this section (the operator agreed the section should show these; spread them across the beats, do NOT copy their wording):\n",
			"\n",
		],
		variables: [
			{
				name: "intent",
				type: "string",
				required: true,
				source: "intent",
				condition: "Conditional: intent",
			},
		],
		condition: "Conditional: intent",
	},
	storyBeatVisualPromptFragment24: {
		owner: "storyBeatVisualPrompt",
		parts: [
			"\nThe story's locked look, for context only — do NOT restate any of it in your answer; it is applied automatically to every beat: ",
			"\n",
		],
		variables: [
			{
				name: 'opts.style.replace(/\\s+/g, " ").trim()',
				type: "string",
				required: true,
				source: 'opts.style.replace(/\\s+/g, " ").trim()',
				condition: "Conditional: opts?.style?.trim()",
			},
		],
		condition: "Conditional: opts?.style?.trim()",
	},
	storyBeatVisualPromptFragment25: {
		owner: "storyBeatVisualPrompt",
		parts: [" "],
		variables: [],
		condition: "Conditional: opts?.style?.trim()",
	},
	storyBeatVisualPromptFragment26: {
		owner: "storyBeatVisualPrompt",
		parts: ["\nProject Visual direction: ", "\n"],
		variables: [
			{
				name: 'opts.visual.replace(/\\s+/g, " ").trim()',
				type: "string",
				required: true,
				source: 'opts.visual.replace(/\\s+/g, " ").trim()',
				condition: "Conditional: opts?.visual?.trim()",
			},
		],
		condition: "Conditional: opts?.visual?.trim()",
	},
	storyBeatVisualPromptFragment27: {
		owner: "storyBeatVisualPrompt",
		parts: [" "],
		variables: [],
		condition: "Conditional: opts?.visual?.trim()",
	},
	storyBeatVisualPromptFragment28: {
		owner: "storyBeatVisualPrompt",
		parts: ["\nHard constraints — obey exactly, never soften: ", "\n"],
		variables: [
			{
				name: 'opts.rules.replace(/\\s+/g, " ").trim()',
				type: "string",
				required: true,
				source: 'opts.rules.replace(/\\s+/g, " ").trim()',
				condition: "Conditional: opts?.rules?.trim()",
			},
		],
		condition: "Conditional: opts?.rules?.trim()",
	},
	storyBeatVisualPromptFragment29: {
		owner: "storyBeatVisualPrompt",
		parts: [" "],
		variables: [],
		condition: "Conditional: opts?.rules?.trim()",
	},
} as const satisfies Readonly<Record<string, PromptFragment>>;
