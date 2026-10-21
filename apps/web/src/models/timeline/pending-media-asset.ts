/* A file chosen for import, as a project asset before its upload finishes
 * (`use-media-while-uploading` D1, D3). Its id is the import request key and its
 * URL the stable `pending:` reference, so clips placed now keep pointing at it
 * once the import is ready. */
import {
	isPendingMediaUrl,
	mediaCompatibilityReason,
	pendingMediaUrl,
	type ImportedMediaKind,
} from "@maleo/shared";
import type { LocalMediaProbe } from "@models/analysis/local-media-probe.ts";
import type { MediaAsset } from "./editor-media.ts";

export const PREVIEW_AFTER_PROCESSING = "Preview after processing";

export function pendingMediaAsset(
	requestKey: string,
	file: File,
	kind: ImportedMediaKind,
	probe: LocalMediaProbe,
): MediaAsset {
	return {
		id: requestKey,
		label: file.name,
		url: pendingMediaUrl(requestKey),
		kind,
		source: "upload",
		...(probe.duration ? { dur: probe.duration } : {}),
		metadata: {
			originalFilename: file.name,
			byteSize: file.size,
			kind,
			...(probe.width && probe.height ? { width: probe.width, height: probe.height } : {}),
			...(probe.duration ? { duration: probe.duration } : {}),
			...(probe.hasAudio === undefined ? {} : { hasAudio: probe.hasAudio }),
		},
		// Placeable either way; the preview path waits for the converted copy.
		...(probe.decodable
			? {}
			: {
					compatibility: {
						preview: { status: "processing", reason: PREVIEW_AFTER_PROCESSING },
						render: { status: "unknown" },
					},
				}),
	};
}

/** Why an asset cannot be placed now. A pending asset needs only a length (an
 *  undecodable one still places, and previews after processing); any other asset
 *  needs both compatibility paths. */
export function mediaUseReason(
	asset: Pick<MediaAsset, "url" | "kind" | "dur" | "compatibility">,
): string | undefined {
	if (isPendingMediaUrl(asset.url))
		return asset.kind !== "image" && !asset.dur
			? "Length unknown until processing finishes"
			: undefined;
	return (
		mediaCompatibilityReason(asset.compatibility, "preview") ??
		mediaCompatibilityReason(asset.compatibility, "render")
	);
}
