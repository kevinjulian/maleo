/* The whole-sequence editorial direction pass and its correction retry. */
import { truthy, type Expression, type PromptTemplate } from "@maleo/shared";

const infographics: Expression = { not: { eq: ["options.allowInfographics", false] } };

export const SEQUENCE_TEMPLATES: readonly PromptTemplate[] = [
	{
		id: "prompt:sequence:storySequenceDirectionPrompt",
		description:
			"One editorial pass over the drafted beats: purpose, presentation, shots and reference bindings.",
		body: [
			"You are doing one whole-sequence editorial pass AFTER story drafting and BEFORE asset generation.\n\nDraft beats, in final order:\n",
			{ type: "format", name: "sequenceBeats", in: { sections: "sections" } },
			"\n\nProject roster (closed list; reuse compatible ids before planning anything new):\n",
			{ type: "format", name: "sequenceRoster", in: { roster: "options.roster" } },
			"\n\nProvisional planned-reference candidates (keep, drop, or replace; your output is final):\n",
			{
				type: "format",
				name: "sequenceCandidates",
				in: { plannedReferences: "options.plannedReferences" },
			},
			"\n\nVisual material:\n",
			{ type: "slot", path: "options.visual", filters: ["trim", { default: "(none)" }] },
			"\n\nHard rules:\n",
			{ type: "slot", path: "options.rules", filters: ["trim", { default: "(none)" }] },
			"\n\nTimeline presentation constraints:\n",
			{ type: "format", name: "jsonObject", in: { value: "options.templateConstraints" } },
			"\n\nFor every beatId, decide:\n- purpose: establish|explain|contrast|reveal|consequence|resolve\n- presentation: ",
			{
				type: "when",
				if: infographics,
				then: ["narrative|headline|explainer|infographic|transition"],
				else: ["narrative|headline|explainer|transition"],
			},
			'\n- visualConcept: one concrete visual treatment that advances this exact narration\n- noveltyKey: short description of what makes this beat visually distinct from adjacent beats\n- onScreenText: optional short native overlay text. Never put this text inside visualConcept; image models must not render it.\n- motionGraphic: only for infographic presentation, using sourced facts already present above. Never invent numbers, rows, prices, or comparisons. Otherwise omit it.\n- sfxCue: one specific story-motivated sound, or null. Silence is preferred over generic whooshes, impacts, ambience, or repeated accents.\n- shots: one entry for EVERY planned visual index, ordered. Each entry has concrete visualIntent, continuity|novelty role, exact ordered bindings, and rationale <=160 characters.\n\nReference rules:\n- A binding is exactly {"entityId":"..."} from project roster OR {"plannedKey":"..."} from your final plannedReferences.\n- Reuse roster first. Plan only recurring character/location/prop subjects with no compatible roster entity. Never plan products; missing products need operator action.\n- Do not bind one-off extras, abstract motifs, diagrams, or props not physically visible in that shot.\n- Per shot: at most ',
			{ type: "const", name: "DEFAULT_CAST_SUBJECT_CAP" },
			" character/product bindings and at most ",
			{ type: "const", name: "MAX_REFERENCE_IMAGES" },
			' bindings in total. Bind the subjects the shot is about, not every reference the story mentions. Most shots need one or two; none needs a full cast list.\n- Return one referenceAliases entry for every distinct bound identity, using ref "entity:<id>" or "planned:<key>".\n- Every operatorRequiredReference must be bound by at least one shot in its beat.\n\nSequence rules:\n- Return every supplied beatId exactly once, in the same order. Do not rewrite narration, titles, ids, or story structure.\n- Adjacent beats cannot share both presentation and noveltyKey.\n- Adjacent non-null sfxCue values cannot repeat.\n',
			{
				type: "when",
				if: infographics,
				then: [
					"- Use infographic only when sourceEvidence contains exact data needed by motionGraphic.",
				],
				else: [
					"- Infographic presentation is unavailable because the selected timeline template disables data overlays.",
				],
			},
			"\n- Vary framing, information density, and visual role across sequence. Images must explain or intensify narration, never decorate it.\n",
			{
				type: "when",
				if: truthy("correction"),
				then: [
					"\nThe previous attempt was rejected. Fix exactly this and change nothing else:\n",
					{ type: "slot", path: "correction" },
					"\n",
				],
			},
			'\nRespond with ONLY compact JSON:\n{"plannedReferences":[{"key":"","role":"character","label":"","description":"","sectionIds":[]}],"referenceAliases":[{"ref":"entity:<id>|planned:<key>","aliases":[]}],"beats":[{"beatId":"","editorial":{"purpose":"establish","presentation":"narrative","visualConcept":"","noveltyKey":"","onScreenText":"","motionGraphic":{"needed":false,"kind":"none","purpose":"none","reason":""},"sfxCue":null,"shots":[{"index":0,"visualIntent":"","role":"continuity","bindings":[],"rationale":""}]}}]}',
		],
		response: {
			parser: "json.fenced",
			schema: "storySequenceDirection",
			policy: "sequence.correctOnceThenMarkUndirected",
		},
	},
];
