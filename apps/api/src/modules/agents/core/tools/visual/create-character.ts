import { promptIdsFor } from "../../prompt-definitions.ts";
import { PROMPT_FRAGMENTS } from "./create-character-prompt-definitions.ts";
import { renderPromptParts } from "@maleo/shared";
import { defineTool } from "../../types.ts";
import { recordAssetProvenance } from "../../../../../lib/agent-trace.ts";
import { characterArgs } from "../../helpers/schemas.ts";
import { getStyleBible } from "../../plan-state.ts";
import { ensureVisualStyle } from "../../style-engine.ts";
import { generateSceneFrame } from "../../visual-gen.ts";
import { upsertGeneratedReference } from "../../generated-reference.ts";

/* Persist an agent-created character as a workspace reference entity and select it
 * into the project, so it is immediately castable. Best-effort: a persistence
 * failure must not abort the run — the character still appears for this session,
 * it just will not survive a reload. Returns the entity id, or null. */
async function persistAgentCharacter(
	projectId: string,
	character: { name: string; description: string; image?: string },
): Promise<string | null> {
	try {
		const { entity } = await upsertGeneratedReference({
			projectId,
			key: `character:${character.name}`,
			role: "character",
			label: character.name,
			description: character.description,
			canonicalImageUrl: character.image ?? null,
			visibilityMode: "face",
			purpose: "agent-character",
		});
		return entity.id;
	} catch {
		return null;
	}
}

export const createCharacter = defineTool({
	name: "create_character",
	kind: "generate",
	inspection: {
		prompts: [
			"prompt:character:createCharacter",
			"prompt:content:generateStyleBible",
			"prompt:constraints:lockedConstraintBlock",
			...promptIdsFor("image", "codexImage"),
		],
		promptMode: "composed",
		operations: [
			{
				id: "operation:create_character:service",
				label: "Generate optional style-locked portrait and persist character reference",
				description: "Generate optional style-locked portrait and persist character reference.",
				source: "apps/api/src/modules/agents/core/tools/visual/create-character.ts",
				conditions: ["Portrait failure keeps the character record without its image."],
			},
		],
	},
	contentType: ["video"],
	intents: ["build_short", "add_element"],
	input: characterArgs,
	description: "create_character { name, description } - add a reusable character reference",
	handler: async (ctx, args) => {
		const job = ctx.job;
		const name = args.name ?? "Character";
		const description = args.description ?? "";
		let image: string | undefined;
		try {
			const styleLock = await ensureVisualStyle(job, job.brief || description || name);
			if (styleLock.ok)
				image = await generateSceneFrame(
					{
						name,
						durationSec: 4,
						shot: "Portrait",
						move: "Static",
						transition: "fade",
						visual: renderPromptParts(PROMPT_FRAGMENTS.createCharacterFragment0.parts, [
							description || name,
						]),
						voiceover: "",
					},
					job.aspect,
					job.styleImageUrl,
					styleLock.visualStyle ?? getStyleBible(job),
					undefined,
					{ workspace: job.workspace, projectId: job.projectId },
				);
		} catch {
			/* portrait optional */
		}
		// Persist a reference_entity so the character has a durable, castable identity
		// and survives a reload. Previously this lived only on the in-memory job, and
		// the client minted a throwaway `char-${Date.now()}` id for it on every apply.
		const entityId = await persistAgentCharacter(job.projectId, { name, description, image });
		job.characters.push({ id: entityId ?? undefined, name, description, image });
		if (image) {
			job.events.push({ kind: "asset_created", assetType: "image", url: image });
			if (ctx.toolCallId)
				await recordAssetProvenance(job, ctx.toolCallId, {
					assetType: "image",
					url: image,
					ref: `character:${name}`,
					prompt: renderPromptParts(PROMPT_FRAGMENTS.createCharacterFragment1.parts, [
						description || name,
					]),
					model: "image-service",
				});
		}
		return { note: `Created character "${name}"`, thumbs: image ? [image] : undefined };
	},
});
