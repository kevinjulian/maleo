/* Generation-state leaf — what a generation pass produced, and the timeline built
 * from it, as artifacts.
 *
 * The pass consumes the approved-plan artifact and records a `generation_batch`
 * that references it: per section, the speech, the authored visuals and each
 * frame, with status and url. The input hashes that decided reuse stay on the
 * assets themselves. The timeline
 * the pass then writes is recorded as a `timeline_document` fingerprint that
 * references the batch. So a finished timeline names the batch it came from, and
 * the batch names the exact approved revision. */
import {
	artifactRefOf,
	generationBatchArtifact,
	stableInputHash,
	stableStringify,
	timelineDocumentArtifact,
	type PipelineArtifact,
	type StoryApprovedSnapshot,
} from "@maleo/shared";
import type { AgentJob, StorySection } from "./model.ts";
import { currentProducer, putJobArtifact } from "./artifact-store.ts";
import { agentTimelineDoc } from "./document.ts";

type ItemStatus = "queued" | "running" | "ready" | "failed";

function itemStatus(section: StorySection, produced: boolean): ItemStatus {
	if (produced) return "ready";
	if (section.status === "failed") return "failed";
	return section.status === "voicing" || section.status === "imaging" ? "running" : "queued";
}

function batchItems(sections: readonly StorySection[]) {
	return sections.flatMap((section) => {
		const sectionId = section.sectionId ?? section.id;
		const beatId = section.semanticBeatId;
		const frames = section.imageUrls?.length
			? section.imageUrls
			: section.imageUrl
				? [section.imageUrl]
				: [];
		return [
			{
				sectionId,
				beatId,
				asset: "speech" as const,
				status: itemStatus(section, Boolean(section.audioUrl && section.audioDurationSec)),
				url: section.audioUrl,
			},
			{
				sectionId,
				beatId,
				asset: "authored_visual" as const,
				status: itemStatus(section, Boolean(section.visualSegments?.length)),
			},
			...(frames.length
				? frames.map((url) => ({
						sectionId,
						beatId,
						asset: "frame" as const,
						status: "ready" as const,
						url,
					}))
				: [{ sectionId, beatId, asset: "frame" as const, status: itemStatus(section, false) }]),
		];
	});
}

/** Record what this pass produced for the approved plan it consumed. */
export function recordGenerationBatch(
	job: AgentJob,
	approved: PipelineArtifact<StoryApprovedSnapshot>,
	sections: readonly StorySection[],
): PipelineArtifact {
	return putJobArtifact(
		job,
		generationBatchArtifact.kind,
		{
			items: batchItems(sections),
		},
		currentProducer(job),
		{ inputRefs: [artifactRefOf(approved)] },
	);
}

/** Record the timeline this pass wrote from its batch. */
export function recordTimelineDocument(
	job: AgentJob,
	batch: PipelineArtifact,
	durationSec: number,
): PipelineArtifact {
	const doc = agentTimelineDoc(job);
	return putJobArtifact(
		job,
		timelineDocumentArtifact.kind,
		{
			clipCount: doc.clips.length,
			durationSec,
			documentHash: stableInputHash([
				"timeline-document-v1",
				stableStringify({ clips: doc.clips, markers: doc.markers }),
			]),
		},
		currentProducer(job),
		{ inputRefs: [artifactRefOf(batch)] },
	);
}
