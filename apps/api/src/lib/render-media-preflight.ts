import { z } from "zod";
import {
	clipControlBlockers,
	clipsPastSource,
	type Clip,
	mediaCompatibilityReason,
	parseImportedMediaFields,
	pendingMediaBlockers,
	reverseMediaBlockers,
	sourceAudioBlockers,
} from "@maleo/shared";
import { getMediaObject } from "@maleo/db/media-objects";
import { getMedia } from "@maleo/storage";
import type { ContentProjectDetail } from "@maleo/db/project-detail";

const assetSchema = z.object({
	label: z.string().optional(),
	url: z.string(),
	compatibility: z.unknown().optional(),
});

/** Check managed sources before enqueue; worker checks again when materializing. */
export async function renderMediaBlockers(
	input: unknown,
	workspace: string,
	editorState: ContentProjectDetail["project"]["editor_state_json"],
): Promise<string[]> {
	const urls = new Set<string>();
	const collect = (value: unknown): void => {
		if (typeof value === "string") urls.add(value);
		else if (Array.isArray(value)) value.forEach(collect);
		else if (value && typeof value === "object") Object.values(value).forEach(collect);
	};
	collect(input);
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
		...pendingMediaBlockers(input, editorState?.media_assets),
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
	const ids = new Set<string>();
	for (const url of urls) {
		try {
			const id = /^\/api\/media\/([0-9a-f-]{36})$/.exec(
				new URL(url, "http://local.invalid").pathname,
			)?.[1];
			if (id) ids.add(id);
		} catch {
			/* Ordinary text is not a media URL. */
		}
	}
	for (const id of ids) {
		const row = await getMediaObject(id);
		if (!row || row.workspace !== workspace) {
			blockers.push("Managed source unavailable. Replace missing source before export.");
			continue;
		}
		// Import originals are provenance only; their compatibility is whatever the client wrote.
		if (row.kind === "file") {
			blockers.push("Original upload is not a playable source. Replace source before export.");
			continue;
		}
		try {
			await getMedia(row.storage_key);
		} catch {
			blockers.push("Source file unavailable. Restore storage or replace source before export.");
		}
	}
	return [...new Set(blockers)];
}
