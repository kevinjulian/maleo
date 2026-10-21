import {
	storyboardGenerationStateSchema,
	type StoryboardCommand,
	type StoryboardGenerationState,
	type StoryExtensionPolicy,
} from "@maleo/shared";
import { z } from "zod";
import { BASE } from "./base.ts";
import { ApiError, get, post } from "./client.ts";

const snapshotSchema = z.object({
	state: storyboardGenerationStateSchema.nullable(),
	legacy: z.boolean(),
	generatedByBeatId: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
	references: z
		.record(
			z.string(),
			z.object({ label: z.string(), role: z.string(), source: z.enum(["existing", "planned"]) }),
		)
		.default({}),
});

const failureSchema = snapshotSchema.extend({
	ok: z.literal(false),
	reason: z.enum(["conflict", "invalid", "locked", "not_found"]),
	message: z.string(),
});

export type StoryboardSnapshot = z.infer<typeof snapshotSchema>;
export type StoryboardFailure = z.infer<typeof failureSchema>;
export type StoryboardMutation =
	| ({ ok: true; state: StoryboardGenerationState; legacy: false } & Pick<
			StoryboardSnapshot,
			"generatedByBeatId"
	  > &
			Partial<Pick<StoryboardSnapshot, "references">>)
	| StoryboardFailure;

export async function loadStoryboardAuthoring(projectId: string): Promise<StoryboardSnapshot> {
	return snapshotSchema.parse(
		await get<unknown>(`${BASE}/projects/${projectId}/storyboard-authoring`),
	);
}

async function mutation(path: string, body: unknown): Promise<StoryboardMutation> {
	try {
		const value = await post<unknown>(path, body);
		const parsed = snapshotSchema
			.extend({ ok: z.literal(true), state: storyboardGenerationStateSchema })
			.parse(value);
		return {
			ok: true,
			state: parsed.state,
			legacy: false,
			generatedByBeatId: parsed.generatedByBeatId,
			references: parsed.references,
		};
	} catch (error) {
		if (error instanceof ApiError && [409, 422].includes(error.status))
			return failureSchema.parse(error.body);
		throw error;
	}
}

export function submitStoryboardCommand(
	projectId: string,
	expectedRevisionId: string,
	command: StoryboardCommand,
): Promise<StoryboardMutation> {
	return mutation(`${BASE}/projects/${projectId}/storyboard-authoring/commands`, {
		expectedRevisionId,
		command,
	});
}

export function approveStoryboardDraft(
	projectId: string,
	expectedRevisionId: string,
	extensionPolicy: StoryExtensionPolicy,
): Promise<StoryboardMutation> {
	return mutation(`${BASE}/projects/${projectId}/storyboard-authoring/approve`, {
		expectedRevisionId,
		extensionPolicy,
	});
}
