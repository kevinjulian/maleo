import { z } from "zod";
import {
	CaptionEngineReadinessSchema,
	CaptionJobResponseSchema,
	type TimelineDoc,
} from "@maleo/shared";
import { ApiError, request } from "./client.ts";

export function captionJobError(error: unknown): string {
	if (error instanceof ApiError) {
		const body = z.object({ message: z.string().min(1) }).safeParse(error.body);
		return body.success
			? body.data.message
			: `Caption request failed (HTTP ${error.status}). Retry generation or check Settings.`;
	}
	return error instanceof Error
		? error.message
		: "Caption request failed. Retry generation or check Settings.";
}

const root = (project: string) =>
	`/api/operations/projects/${encodeURIComponent(project)}/captions`;
const readinessSchema = z.object({
	available: z.boolean(),
	reason: z.string().optional(),
	captions: CaptionEngineReadinessSchema.optional(),
});
export async function captionReadiness(project: string, workspace: string, signal: AbortSignal) {
	const response = await request(
		`${root(project)}/readiness`,
		{ signal: AbortSignal.any([signal, AbortSignal.timeout(35_000)]) },
		{ richError: true, workspace },
	);
	return readinessSchema.parse(await response.json());
}
export interface CaptionJobInput {
	requestKey: string;
	doc: TimelineDoc;
	source: "all" | { clipId: string; visualId?: string };
	sourceRevisions: Record<string, string>;
	language: string;
	captionTrack: number;
	replaceEdited: boolean;
}
export async function submitCaptionJob(project: string, workspace: string, input: CaptionJobInput) {
	const response = await request(
		`${root(project)}/jobs`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(input),
			signal: AbortSignal.timeout(35_000),
		},
		{ richError: true, workspace },
	);
	return z.object({ id: z.string().min(1) }).parse(await response.json()).id;
}
export async function pollCaptionJob(
	project: string,
	workspace: string,
	id: string,
	signal: AbortSignal,
) {
	const response = await request(
		`${root(project)}/jobs/${encodeURIComponent(id)}`,
		{
			signal: AbortSignal.any([signal, AbortSignal.timeout(35_000)]),
		},
		{ richError: true, workspace },
	);
	return CaptionJobResponseSchema.parse(await response.json());
}
export async function cancelCaptionJob(project: string, workspace: string, id: string) {
	await request(
		`${root(project)}/jobs/${encodeURIComponent(id)}`,
		{
			method: "DELETE",
			signal: AbortSignal.timeout(35_000),
		},
		{ richError: true, workspace },
	);
}
