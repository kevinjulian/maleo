/* The render worker's job status shape and the pure predicate that decides
 * whether it is still worth polling. */

import { isJobActive, type JobStatus } from "@models/video/render-job.ts";

export type RenderQueueStatus = {
	id: string;
	output_url?: string | null;
	output_path?: string | null;
	status: JobStatus;
	phase?: string | null;
	phase_detail?: string | null;
	image_status?: string | null;
	progress?: number;
	error?: string | null;
};

export function shouldPollRenderJob(status: RenderQueueStatus["status"]): boolean {
	return isJobActive({ status });
}
