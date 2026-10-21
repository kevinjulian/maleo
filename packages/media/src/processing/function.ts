import { inngest, mediaProcessingRequestedEvent } from "@maleo/inngest";
import { failProcessingJob, getProcessingJob } from "../generation/store.ts";
import { runProcessingJob } from "./run.ts";
import { runCaptionJob } from "./caption-run.ts";
import { isCaptionProcessingJob } from "../api/processing.ts";

export const mediaProcessingRun = inngest.createFunction(
	{
		id: "media-processing-run",
		concurrency: { limit: 1 },
		idempotency: "event.data.idempotencyKey",
		retries: 3,
		triggers: [mediaProcessingRequestedEvent],
		onFailure: async ({ event, error }) => {
			const original = event.data.event;
			const parsed = mediaProcessingRequestedEvent.schema.safeParse(original?.data);
			if (parsed.success) {
				const job = getProcessingJob(parsed.data.jobId);
				if (
					job?.request.workspaceId === parsed.data.workspaceId &&
					job.request.projectId === parsed.data.projectId
				)
					failProcessingJob(job.id, error.message);
			}
		},
	},
	async ({ event, step }) => {
		const job = getProcessingJob(event.data.jobId);
		if (
			!job ||
			job.request.workspaceId !== event.data.workspaceId ||
			job.request.projectId !== event.data.projectId
		)
			throw new Error("Processing event does not own job");
		return step.run(
			isCaptionProcessingJob(job) ? "prepare-recognize-captions" : "probe-normalize-publish",
			() =>
				(isCaptionProcessingJob(job) ? runCaptionJob : runProcessingJob)(job.id, {
					apiBaseUrl: process.env.MALEO_API_URL?.trim() ?? "",
					serviceToken: process.env.MALEO_SERVICE_TOKEN?.trim() ?? "",
				}),
		);
	},
);
