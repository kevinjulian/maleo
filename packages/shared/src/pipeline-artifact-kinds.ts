/* The artifact kinds pipelines exchange, one definition each.
 *
 * The first seven are the payloads the old `AgentArtifact` union carried, now
 * validated under the common envelope. The last three exist because a stage
 * boundary needs something to reference: the approved plan revision generation
 * may consume, the assets one generation pass produced, and the timeline written
 * from them.
 *
 * Large shapes (`story_plan`, `timeline_document`) validate the fields a consumer
 * relies on and pass the rest through, the same boundary `storyboard-generation.ts`
 * draws for plan state. */
import { z } from "zod";
import { storyApprovedSnapshotSchema } from "./storyboard-generation.ts";
import type {
	BlockerAcknowledgementsPayload,
	KnowledgePayload,
	MediaPayload,
	PostThreadPayload,
	ResearchBundlePayload,
	SlideDeckPayload,
	StoryboardTablePayload,
	StoryPlanPayload,
	StyleBiblePayload,
} from "./agent-wire.ts";
import {
	artifactsOfKind,
	createArtifactKindRegistry,
	defineArtifactKind,
	parseArtifact,
	type ArtifactKind,
	type PipelineArtifact,
} from "./pipeline-artifact.ts";

const complete = (artifact: PipelineArtifact): boolean => artifact.status === "complete";

export const knowledgeArtifact = defineArtifactKind<KnowledgePayload>({
	kind: "knowledge",
	schemaVersion: 1,
	payload: z.object({ title: z.string(), body: z.string() }),
	isReady: complete,
});

export const mediaArtifact = defineArtifactKind<MediaPayload>({
	kind: "media",
	schemaVersion: 1,
	payload: z.object({
		mediaType: z.enum(["audio", "video", "image"]),
		url: z.string().min(1),
		label: z.string().optional(),
		durationSec: z.number().nonnegative().optional(),
	}),
	isReady: complete,
});

export const styleBibleArtifact = defineArtifactKind<StyleBiblePayload>({
	kind: "style_bible",
	schemaVersion: 1,
	singleton: true,
	payload: z.object({
		visualStyle: z.string(),
		source: z.enum(["generated", "style_ref"]),
		refUrl: z.string().optional(),
	}),
	isReady: complete,
});

export const storyboardTableArtifact = defineArtifactKind<StoryboardTablePayload>({
	kind: "storyboard_table",
	schemaVersion: 1,
	payload: z.object({
		title: z.string(),
		rows: z.array(
			z.object({
				startSec: z.number(),
				endSec: z.number(),
				content: z.string(),
				kind: z.enum(["scene", "voiceover", "text", "effect"]),
			}),
		),
	}),
	isReady: complete,
});

const storyPlanSectionSchema = z
	.object({
		id: z.string().min(1),
		title: z.string(),
		narration: z.string(),
		visualPrompt: z.string(),
	})
	.passthrough();

const storyPlanPayloadSchema = z
	.object({
		targetSec: z.number().nonnegative(),
		sections: z.array(storyPlanSectionSchema),
		unverified: z.boolean().optional(),
		verificationStatus: z.enum(["verified", "partial", "unverified"]).optional(),
		citationCoverage: z
			.object({ verified: z.number().int().nonnegative(), total: z.number().int().nonnegative() })
			.optional(),
	})
	.passthrough();

export const storyPlanArtifact = defineArtifactKind<StoryPlanPayload>({
	kind: "story_plan",
	schemaVersion: 1,
	singleton: true,
	/* The schema checks the fields every consumer relies on and keeps the value
	 * unchanged, so what passes is the persisted `StoryPlanPayload`. Spelling out
	 * every section and context field in Zod would be a second copy of
	 * `agent-wire.ts` that drifts from it. */
	payload: z.custom<StoryPlanPayload>(
		(value) => storyPlanPayloadSchema.safeParse(value).success,
		"invalid story plan",
	),
	isReady: complete,
});

export const researchBundleArtifact = defineArtifactKind<ResearchBundlePayload>({
	kind: "research_bundle",
	schemaVersion: 1,
	singleton: true,
	payload: z.object({
		topic: z.string(),
		sources: z.array(
			z.object({
				title: z.string(),
				url: z.string(),
				excerpt: z.string(),
				retrievedAt: z.string(),
			}),
		),
		claimCount: z.number().int().nonnegative(),
		briefKey: z.string().optional(),
		/** The searches that produced the sources, kept for the run trace. */
		queries: z.array(z.string()).optional(),
	}),
	isReady: complete,
});

export const blockerAcknowledgementsArtifact = defineArtifactKind<BlockerAcknowledgementsPayload>({
	kind: "blocker_acknowledgements",
	schemaVersion: 1,
	singleton: true,
	payload: z.object({ ids: z.array(z.string().min(1)) }),
	isReady: complete,
});

/** The frozen plan revision generation is allowed to consume. */
export const approvedPlanArtifact = defineArtifactKind({
	kind: "approved_plan",
	schemaVersion: 1,
	// At most one latest approved snapshot, as plan state already holds.
	singleton: true,
	payload: storyApprovedSnapshotSchema,
	isReady: complete,
});

export const generationItemStatusSchema = z.enum(["queued", "running", "ready", "failed"]);

/** The assets one generation pass produced for an approved plan revision.
 *
 *  Which approval it consumed is its `approved_plan` input reference, and the
 *  input hash that decided each asset's reuse stays on the asset itself
 *  (`asset-staleness.ts`); neither is repeated here, because the same fact at the
 *  same granularity in two places is two places to disagree. */
export const generationBatchArtifact = defineArtifactKind({
	kind: "generation_batch",
	schemaVersion: 1,
	payload: z.object({
		items: z.array(
			z.object({
				sectionId: z.string().min(1),
				beatId: z.string().min(1).optional(),
				asset: z.enum(["speech", "authored_visual", "frame"]),
				status: generationItemStatusSchema,
				url: z.string().optional(),
			}),
		),
	}),
	// Valid while items are still queued or running; consumable only once none are.
	isReady: (artifact) =>
		artifact.status === "complete" &&
		artifact.payload.items.every((item) => item.status !== "queued" && item.status !== "running"),
});

/** The timeline the finalize step wrote, referencing its generation batch.
 *
 *  A fingerprint, not a copy: this artifact lives inside the storyboard document
 *  it describes, so holding the document again would duplicate every clip and
 *  drift from it the moment the operator edits. It records what was written and
 *  how to recognise it. */
export const timelineDocumentArtifact = defineArtifactKind({
	kind: "timeline_document",
	schemaVersion: 1,
	payload: z.object({
		clipCount: z.number().int().nonnegative(),
		durationSec: z.number().nonnegative(),
		/** Hash of the clips and markers as written. */
		documentHash: z.string().min(1),
	}),
	isReady: complete,
});

/** A carousel's slides. Drafted by the content scaffold, rendered by slide visuals. */
export const slideDeckArtifact = defineArtifactKind<SlideDeckPayload>({
	kind: "slide_deck",
	schemaVersion: 1,
	singleton: true,
	payload: z.object({
		slides: z.array(
			z.object({
				key: z.string().optional(),
				name: z.string().optional(),
				caption: z.string(),
				visual: z.string(),
				image: z.string().optional(),
				refIds: z.array(z.string()).optional(),
				noteIds: z.array(z.string()).optional(),
			}),
		),
	}),
	isReady: complete,
});

/** A text thread's posts. */
export const postThreadArtifact = defineArtifactKind<PostThreadPayload>({
	kind: "post_thread",
	schemaVersion: 1,
	singleton: true,
	payload: z.object({
		posts: z.array(
			z.object({ key: z.string().optional(), body: z.string(), image: z.string().optional() }),
		),
	}),
	isReady: complete,
});

export const PIPELINE_ARTIFACT_KINDS: readonly ArtifactKind[] = [
	knowledgeArtifact,
	mediaArtifact,
	styleBibleArtifact,
	storyboardTableArtifact,
	storyPlanArtifact,
	researchBundleArtifact,
	blockerAcknowledgementsArtifact,
	approvedPlanArtifact,
	generationBatchArtifact,
	timelineDocumentArtifact,
	slideDeckArtifact,
	postThreadArtifact,
];

export const pipelineArtifactKinds = createArtifactKindRegistry(PIPELINE_ARTIFACT_KINDS);

/** The `artifacts` array of a persisted document or snapshot, unread. */
export function documentArtifactList(document: unknown): unknown {
	return document && typeof document === "object"
		? Object.getOwnPropertyDescriptor(document, "artifacts")?.value
		: undefined;
}

/** The valid artifacts a persisted document or snapshot carries. Anything that
 *  does not parse against its kind is dropped rather than trusted. */
export function documentArtifacts(value: unknown): PipelineArtifact[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		const parsed = parseArtifact(pipelineArtifactKinds, item);
		return parsed.ok ? [parsed.artifact] : [];
	});
}

/** The story plan artifact in a list, if there is one. */
export function storyPlanArtifactOf(
	artifacts: readonly PipelineArtifact[],
): PipelineArtifact<StoryPlanPayload> | undefined {
	return artifactsOfKind(artifacts, storyPlanArtifact)[0];
}
