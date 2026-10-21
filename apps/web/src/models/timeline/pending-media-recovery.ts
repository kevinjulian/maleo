/* Recovering a pending asset whose upload failed or was interrupted
 * (`use-media-while-uploading` D5): choose its file again, or remove it. */
import type { Clip, ImportedMediaKind, ReadyImportedMedia } from "@maleo/shared";
import {
	batch,
	removeClip,
	replaceClip,
	setMediaAssets,
	type EditorCommand,
	type EditScope,
} from "@maleo/shared/editor";
import { mediaSourceIdentity, replaceProjectMedia } from "./media-replacement.ts";

/** Why a file chosen again cannot back every placed use of pending asset `id`: the
 *  same checks source replacement makes (kind, and length against each use). A
 *  locked track is no reason here, because resolving the asset edits no clip. */
export function chosenFileReason(
	scope: Pick<EditScope, "doc" | "mediaAssets">,
	id: string,
	kind: ImportedMediaKind | undefined,
	duration: number | undefined,
): string | undefined {
	const asset = scope.mediaAssets.find((candidate) => candidate.id === id);
	if (!asset) return "Media is no longer available";
	if (kind !== asset.kind)
		return `Choose ${asset.kind === "audio" ? "an audio" : `a ${asset.kind}`} file`;
	if (kind !== "image" && !duration) return "Length unknown; choose another file";
	// A dry run of replacement against a stand-in for the chosen file's measured length.
	const stand: ReadyImportedMedia = {
		id,
		label: asset.label,
		url: asset.url,
		kind,
		source: "upload",
		metadata: {
			originalFilename: asset.label,
			byteSize: 0,
			kind,
			...(duration ? { duration } : {}),
		},
		compatibility: { preview: { status: "supported" }, render: { status: "supported" } },
		importedSource: { revision: "chosen-again", fingerprint: "0".repeat(64), originalMediaId: id },
	};
	try {
		replaceProjectMedia(
			{ doc: { ...scope.doc, trackFlags: undefined }, mediaAssets: scope.mediaAssets },
			id,
			mediaSourceIdentity(asset),
			stand,
		);
		return undefined;
	} catch (failure) {
		return failure instanceof Error ? failure.message : String(failure);
	}
}

/** Remove an asset together with every clip that uses it, as one undo step. A scene
 *  keeps its place: its frame or visual that used the asset is cleared. */
export function removeMediaWithUses(
	scope: Pick<EditScope, "doc" | "mediaAssets">,
	id: string,
): EditorCommand {
	const changes: EditorCommand[] = [];
	for (const clip of scope.doc.clips) {
		const scene = clip.scene;
		const free =
			clip.video?.mediaAssetId === id ||
			clip.audio?.mediaAssetId === id ||
			clip.vis?.vclip?.mediaAssetId === id;
		const frame = scene?.mediaAssetId === id,
			end = scene?.endMediaAssetId === id,
			visuals = scene?.visualClips?.some((item) => item.mediaAssetId === id);
		if (!free && !frame && !end && !visuals) continue;
		if (scope.doc.trackFlags?.[clip.track]?.locked)
			throw new Error("Used media is on a locked track");
		if (free) {
			changes.push(removeClip(clip.id));
			continue;
		}
		const next: Clip = {
			...clip,
			scene: {
				...scene!,
				...(frame ? { src: undefined, mediaAssetId: undefined, img: false } : {}),
				...(end ? { endSrc: undefined, endMediaAssetId: undefined } : {}),
				...(visuals
					? { visualClips: scene!.visualClips!.filter((item) => item.mediaAssetId !== id) }
					: {}),
			},
		};
		changes.push(replaceClip(clip.id, next));
	}
	return batch(
		[...changes, setMediaAssets(scope.mediaAssets.filter((asset) => asset.id !== id))],
		"media.remove",
	);
}
