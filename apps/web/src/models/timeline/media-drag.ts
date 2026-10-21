/* Writing the drag payload the timeline reads.
 *
 * The counterpart to `readMediaDrop`. It exists because three surfaces can now
 * place an asset — the project's media, stock results, and the reference
 * library — and a payload written slightly differently by one of them is a drop
 * that silently loses a field. Written once, the reader and the writer are one
 * pair rather than three. */
import type { AudioOverlayKind } from "@maleo/shared/audio-overlays";
import {
	MEDIA_DND_AUDIO_KIND,
	MEDIA_DND_DUR,
	MEDIA_DND_ID,
	MEDIA_DND_KIND,
	MEDIA_DND_LABEL,
	MEDIA_DND_MIME,
	MEDIA_DND_REF_ENTITY,
	MEDIA_DND_SOURCE,
	MEDIA_DND_THUMB,
	type MediaAsset,
} from "./editor-media.ts";

export interface MediaDragPayload {
	url: string;
	kind: "image" | "video" | "audio";
	label: string;
	source: MediaAsset["source"];
	/** Only for a surface whose asset is already admitted. A stock or reference
	 *  result leaves it unset, and admission names the asset on drop. */
	mediaAssetId?: string;
	thumb?: string;
	dur?: number;
	/** Which audio track the asset belongs on. Without it every audio drop lands
	 *  as music, which is how a sound effect became a music clip. */
	audioKind?: AudioOverlayKind;
	/** Set when the drag came from the reference library. The admitted asset
	 *  records it, so a placed image can be traced to the entity it came from. */
	referenceEntityId?: string;
}

let activeDrag: MediaDragPayload | null = null;

/** HTML5 protects getData during dragover. This transient, same-page preview
 * never authorizes a drop; readMediaDrop remains the commit-time reader. */
export function mediaDragPreview(): MediaDragPayload | null {
	return activeDrag;
}

export function writeMediaDragPayload(
	dt: DataTransfer,
	item: MediaDragPayload,
	element?: HTMLElement,
): void {
	dt.setData(MEDIA_DND_MIME, item.url);
	dt.setData(MEDIA_DND_KIND, item.kind);
	dt.setData(MEDIA_DND_LABEL, item.label);
	dt.setData(MEDIA_DND_SOURCE, item.source);
	if (item.mediaAssetId) dt.setData(MEDIA_DND_ID, item.mediaAssetId);
	if (item.thumb) dt.setData(MEDIA_DND_THUMB, item.thumb);
	if (item.dur != null) dt.setData(MEDIA_DND_DUR, String(item.dur));
	if (item.audioKind) dt.setData(MEDIA_DND_AUDIO_KIND, item.audioKind);
	if (item.referenceEntityId) dt.setData(MEDIA_DND_REF_ENTITY, item.referenceEntityId);
	dt.effectAllowed = "copy";
	if (!element) return;
	activeDrag = { ...item };
	const ghost = document.createElement("div");
	ghost.className = "tl2-media-drag-ghost";
	const thumbnail =
		item.thumb ||
		(item.kind === "image"
			? element.querySelector<HTMLImageElement>("img")?.src
			: element.querySelector<HTMLVideoElement>("video")?.poster);
	if (thumbnail) {
		const img = document.createElement("img");
		img.src = thumbnail;
		img.alt = "";
		ghost.append(img);
	}
	const name = document.createElement("span");
	name.textContent = item.label;
	ghost.append(name);
	document.body.append(ghost);
	dt.setDragImage(ghost, 20, 20);
	const clear = (): void => {
		activeDrag = null;
		ghost.remove();
		window.removeEventListener("dragend", clear, true);
		window.removeEventListener("drop", clear, true);
	};
	window.addEventListener("dragend", clear, true);
	window.addEventListener("drop", clear, true);
}
