import { z } from "zod";
import { ProjectMediaProcessingResponseSchema, type MediaProcessingOperation } from "@maleo/shared";
import { request } from "./client.ts";
import { BASE } from "./base.ts";

const base = (project: string) =>
	`${BASE}/projects/${encodeURIComponent(project)}/media/processing`;
export async function processMediaSource(
	project: string,
	input: {
		sourceMediaId: string;
		sourceRevision: string;
		requestKey: string;
		operation: MediaProcessingOperation;
	},
	signal: AbortSignal,
): Promise<string> {
	return z.object({ id: z.string().uuid() }).parse(
		await (
			await request(
				base(project),
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(input),
					signal,
				},
				{ richError: true },
			)
		).json(),
	).id;
}
export async function pollMediaProcessing(project: string, id: string, signal: AbortSignal) {
	return ProjectMediaProcessingResponseSchema.parse(
		await (
			await request(`${base(project)}/${encodeURIComponent(id)}`, { signal }, { richError: true })
		).json(),
	);
}
export async function cancelMediaProcessing(project: string, id: string): Promise<void> {
	await request(
		`${base(project)}/${encodeURIComponent(id)}`,
		{ method: "DELETE", signal: AbortSignal.timeout(30_000) },
		{ richError: true },
	);
}
