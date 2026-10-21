/* The registered code that parses, validates and recovers from each model reply.
 *
 * Templates reference these by id; the code itself stays with its owner and is
 * unchanged by the conversion. Each entry names where that code lives, so an
 * inspector can follow a request to the exact parser, schema and policy applied. */
export interface ResponseRef {
	readonly owner: string;
	readonly description: string;
}

export const RESPONSE_PARSERS: Readonly<Record<string, ResponseRef>> = {
	"json.fenced": {
		owner: "apps/api/src/lib/story/authoring-utils.ts#parseJson",
		description: "JSON, optionally inside a ```json fence.",
	},
	"text.oneLine": {
		owner: "apps/api/src/lib/content-generator.ts#generateStyleBible",
		description: "Plain text, whitespace collapsed, capped at 600 characters.",
	},
};

export const RESPONSE_SCHEMAS: Readonly<Record<string, ResponseRef>> = {
	directionRoute: {
		owner: "apps/api/src/lib/content-generator.ts#directionRouteSchema",
		description: "Story, visual, voice and rules channels.",
	},
	storyClarificationBatch: {
		owner: "packages/shared/src/story-clarification.ts#storyClarificationBatchSchema",
		description: "A pre-research question batch.",
	},
	evidenceDecisionBatch: {
		owner: "packages/shared/src/story-clarification.ts#storyClarificationBatchSchema",
		description: "No questions, or a post-research batch bound to held sources.",
	},
	storyFrame: {
		owner: "apps/api/src/lib/content-generator.ts#storyFrameSchema",
		description: "Plan kind, arc, language, engagement, references and grounding.",
	},
	storyDraft: {
		owner: "apps/api/src/lib/content-generator.ts#storyDraftSchema",
		description: "Drafted sections addressed by slot.",
	},
	storySequenceDirection: {
		owner: "packages/shared/src/story-sequence-direction.ts#storySequenceDirectionSchema",
		description: "Per-beat editorial direction, references and aliases.",
	},
	styleBibleLine: {
		owner: "apps/api/src/lib/content-generator.ts#generateStyleBible",
		description: "One line of comma-separated style descriptors.",
	},
	storyBibleDraft: {
		owner: "apps/api/src/lib/content-generator.ts#storyBibleDraftSchema",
		description: "Subjects, locations, look and negatives.",
	},
};

export const RESPONSE_POLICIES: Readonly<Record<string, ResponseRef>> = {
	"direction.storyFallback": {
		owner: "apps/api/src/lib/content-generator.ts#routeDirection",
		description: "Any failure puts the raw text in the story channel.",
	},
	"clarification.askNothing": {
		owner:
			"apps/api/src/modules/agents/core/story-clarification-planner.ts#generateStoryClarification",
		description: "Any failure asks no questions; planning continues.",
	},
	"evidence.fallbackNote": {
		owner:
			"apps/api/src/modules/agents/core/post-research-clarification.ts#analyzeEvidenceDecisions",
		description: "A failure continues on best judgment and says so.",
	},
	"frame.retryThenDegrade": {
		owner: "apps/api/src/lib/content-generator.ts#planStoryFrame",
		description: "One retry, then defaults when a language is configured, else fail.",
	},
	"draft.retrySlotThenMarkUndrafted": {
		owner: "apps/api/src/lib/content-generator.ts#draftStorySections",
		description: "Retry each missing slot once alone, then keep it undrafted with its cause.",
	},
	"sequence.correctOnceThenMarkUndirected": {
		owner: "apps/api/src/lib/story/creative-director.ts#directStorySequence",
		description:
			"Retry once with the failure as correction, then mark the plan as needing direction.",
	},
	"style.bestEffort": {
		owner: "apps/api/src/modules/agents/core/services/planning.ts#generatePreparedStyle",
		description: "A failure leaves the plan without a generated style.",
	},
	"bible.bestEffort": {
		owner: "apps/api/src/modules/agents/core/services/planning.ts#authorPreparedBible",
		description: "A failure leaves the plan without a Story Bible.",
	},
};

/** Response-contract problems in a template set, reported at load. */
export function responseErrors(
	templates: readonly {
		id: string;
		response?: { parser: string; schema: string; policy: string };
	}[],
): string[] {
	return templates.flatMap((template) => {
		const response = template.response;
		if (!response) return [];
		return [
			...(RESPONSE_PARSERS[response.parser]
				? []
				: [`template "${template.id}" names unknown parser "${response.parser}"`]),
			...(RESPONSE_SCHEMAS[response.schema]
				? []
				: [`template "${template.id}" names unknown schema "${response.schema}"`]),
			...(RESPONSE_POLICIES[response.policy]
				? []
				: [`template "${template.id}" names unknown policy "${response.policy}"`]),
		];
	});
}
