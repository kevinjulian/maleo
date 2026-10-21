import { PROMPT_FRAGMENTS } from "./generated-reference-prompt-definitions.ts";
import { renderPromptParts } from "@maleo/shared";
import { createHash } from "node:crypto";
import { getContentProject } from "@maleo/db/project-detail";
import {
	addProjectReference,
	upsertReferenceEntity,
	type ProjectReferenceRow,
	type ReferenceEntityRow,
} from "@maleo/db/references";
import type { StoryReferenceRole, StoryReferenceVisibility } from "@maleo/shared";

export interface GeneratedReferenceInput {
	projectId: string;
	key?: string;
	role: StoryReferenceRole;
	label: string;
	description: string;
	canonicalImageUrl?: string | null;
	visibilityMode?: StoryReferenceVisibility;
	purpose?: string;
}

export interface GeneratedReferenceResult {
	entity: ReferenceEntityRow;
	reference: ProjectReferenceRow;
}

function normalizeKeyPart(value: string | undefined): string {
	return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function generatedReferenceId(input: {
	workspace: string;
	role: string;
	label: string;
	description: string;
	purpose?: string;
	key?: string;
}): string {
	const stable = [
		normalizeKeyPart(input.workspace),
		normalizeKeyPart(input.role),
		normalizeKeyPart(input.purpose),
		normalizeKeyPart(input.key),
		normalizeKeyPart(input.label),
		normalizeKeyPart(input.description),
	].join("\n");
	return `genref-${createHash("sha256").update(stable).digest("hex").slice(0, 24)}`;
}

export function canonicalReferencePrompt(input: {
	role: StoryReferenceRole;
	label: string;
	description: string;
	visibilityMode?: StoryReferenceVisibility;
}): string {
	const base = renderPromptParts(PROMPT_FRAGMENTS.canonicalReferencePromptFragment0.parts, [
		input.role,
		input.label,
		input.description,
	]);
	switch (input.visibilityMode) {
		case PROMPT_FRAGMENTS.canonicalReferencePromptFragment1.parts[0]:
			return renderPromptParts(PROMPT_FRAGMENTS.canonicalReferencePromptFragment2.parts, [base]);
		case PROMPT_FRAGMENTS.canonicalReferencePromptFragment3.parts[0]:
			return renderPromptParts(PROMPT_FRAGMENTS.canonicalReferencePromptFragment4.parts, [base]);
		case PROMPT_FRAGMENTS.canonicalReferencePromptFragment5.parts[0]:
			return renderPromptParts(PROMPT_FRAGMENTS.canonicalReferencePromptFragment6.parts, [base]);
		case PROMPT_FRAGMENTS.canonicalReferencePromptFragment7.parts[0]:
			return renderPromptParts(PROMPT_FRAGMENTS.canonicalReferencePromptFragment8.parts, [base]);
		case PROMPT_FRAGMENTS.canonicalReferencePromptFragment9.parts[0]:
			return renderPromptParts(PROMPT_FRAGMENTS.canonicalReferencePromptFragment10.parts, [base]);
		case PROMPT_FRAGMENTS.canonicalReferencePromptFragment11.parts[0]:
			return renderPromptParts(PROMPT_FRAGMENTS.canonicalReferencePromptFragment12.parts, [base]);
		case PROMPT_FRAGMENTS.canonicalReferencePromptFragment13.parts[0]:
		case undefined:
		default:
			return renderPromptParts(PROMPT_FRAGMENTS.canonicalReferencePromptFragment14.parts, [base]);
	}
}

export async function upsertGeneratedReference(
	input: GeneratedReferenceInput,
): Promise<GeneratedReferenceResult> {
	const project = await getContentProject(input.projectId);
	const workspace = project?.project.workspace;
	if (!workspace) throw new Error(`Project not found for generated reference: ${input.projectId}`);
	const label = input.label.replace(/\s+/g, " ").trim();
	const description = input.description.replace(/\s+/g, " ").trim();
	if (!label || !description) throw new Error("Generated reference requires label and description");
	const id = generatedReferenceId({
		workspace,
		role: input.role,
		label,
		description,
		purpose: input.purpose,
		key: input.key,
	});
	const entity = await upsertReferenceEntity({
		id,
		workspace,
		role: input.role,
		label,
		description,
		canonical_image_url: input.canonicalImageUrl ?? null,
		tags: ["generated", input.role, input.purpose ?? "story-reference"].filter(Boolean),
		origin: "generated",
	});
	if (!entity) throw new Error(`Failed to create generated reference: ${label}`);
	const reference = await addProjectReference({
		project_id: input.projectId,
		entity_id: entity.id,
	});
	if (!reference) throw new Error(`Failed to attach generated reference to project: ${entity.id}`);
	return { entity, reference };
}
