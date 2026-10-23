import { z } from "zod";
import {
	clipControlBlockers,
	clipsPastSource,
	type Clip,
	mediaCompatibilityReason,
	parseImportedMediaFields,
	reverseMediaBlockers,
	sourceAudioBlockers,
} from "@maleo/shared";
import { getMediaObject } from "@maleo/db/media-objects";
import { getMedia } from "@maleo/storage";
import type { ContentProjectDetail } from "@maleo/db/project-detail";
import { buildAssetManifest, type AssetManifestEntry } from "./asset-manifest.ts";

const assetSchema = z.object({
	label: z.string().optional(),
	url: z.string(),
	compatibility: z.unknown().optional(),
});

/** Why each used, unavailable manifest entry blocks a server render. */
function manifestBlockers(entries: readonly AssetManifestEntry[]): string[] {
	return entries.flatMap((entry) => {
		if (!entry.used || (entry.state !== "pending" && entry.state !== "failed")) return [];
		if (entry.state === "pending")
			return [
				`${entry.label ?? "A file"} is still uploading. Wait for it to finish before export.`,
			];
		return ["Managed source unavailable. Replace missing source before export."];
	});
}

/** Check managed sources before enqueue; worker checks again when materializing.
 *  Availability comes from the asset manifest. `editorState.media_assets` is the
 *  project's library, which callers read from its rows (`projectMediaLibrary`). */
export async function renderMediaBlockers(
	input: unknown,
	workspace: string,
	editorState: ContentProjectDetail["project"]["editor_state_json"],
): Promise<string[]> {
	const manifest = await buildAssetManifest(input, editorState?.media_assets ?? [], workspace);
	const used = manifest.filter((entry) => entry.used);
	const urls = new Set(used.map((entry) => entry.url));
	const clips = z
		.object({
			clips: z.array(z.custom<Clip>((value) => Boolean(value) && typeof value === "object")),
		})
		.safeParse(input);
	const named = z
		.array(
			z.object({
				id: z.string(),
				label: z.string(),
				source: z.string().optional(),
				metadata: z.object({ duration: z.number().optional() }).optional(),
			}),
		)
		.catch([])
		.parse(editorState?.media_assets ?? []);
	const blockers: string[] = [
		...manifestBlockers(manifest),
		...new Set(clipsPastSource(clips.success ? clips.data.clips : [], named).values()),
		...clipControlBlockers(input),
		...reverseMediaBlockers(input),
		...sourceAudioBlockers(input, editorState?.media_assets),
	];
	const assets = Array.isArray(editorState?.media_assets) ? editorState.media_assets : [];
	for (const value of assets) {
		const parsed = assetSchema.safeParse(value);
		if (!parsed.success || !urls.has(parsed.data.url)) continue;
		const reason = mediaCompatibilityReason(
			parseImportedMediaFields(parsed.data).compatibility,
			"render",
		);
		if (reason)
			blockers.push(`${parsed.data.label ?? "Media"}: ${reason}. Replace source before export.`);
	}
	for (const entry of used) {
		if (entry.state !== "ready") continue;
		// Import originals are provenance only; their compatibility is whatever the client wrote.
		if (entry.kind === "file") {
			blockers.push("Original upload is not a playable source. Replace source before export.");
			continue;
		}
		const row = await getMediaObject(entry.id);
		try {
			if (!row) throw new Error("registry row removed after the manifest read");
			await getMedia(row.storage_key);
		} catch {
			blockers.push("Source file unavailable. Restore storage or replace source before export.");
		}
	}
	return [...new Set(blockers)];
}
