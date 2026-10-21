/* The Assets rail's Media tab: the project's media, and every way to place,
 * replace, rename or drop one.
 *
 * Split out of `timeline-panel-host.tsx`. The host keeps the tab switch and
 * the error line's state — an error has to outlive a trip to another rail —
 * and this draws the panel and owns the writes it makes. */
import type { ComponentProps, JSX } from "react";
import { ReadyImportedMediaSchema } from "@maleo/shared";
import { setMediaAssets as mediaAssetsCommand } from "@maleo/shared/editor";
import { deepEqual } from "@maleo/shared/editor";
import { AllMediaPanel } from "@components/timeline/media/media-browser.tsx";
import { withReadyPending } from "@models/core/pending-media-sources.ts";
import { resolveSetState } from "@models/core/set-state.ts";
import { mediaSourceIdentity, replaceProjectMedia } from "@models/timeline/media-replacement.ts";
import { placeProjectMedia, removeUnusedProjectMedia } from "@models/timeline/media-library.ts";
import { mediaDropReason, placeMediaOverlay } from "@models/timeline/media-placement.ts";
import { Note } from "@design-system/components/note.tsx";
import type { TimelineDocumentStore } from "@stores/timeline-document-store.ts";
import type { DocumentWriters } from "@stores/document-writers.ts";
import type { ReferenceLibraryState } from "@hooks/editor/use-reference-library.ts";
import type { MediaImportControls } from "@hooks/editor/use-media-import.ts";
import type { TimelinePanelOps, TimelinePanelView } from "./timeline-panel-host.tsx";

type MediaProps = ComponentProps<typeof AllMediaPanel>;

interface TimelineMediaTabProps {
	imports: MediaImportControls;
	store: TimelineDocumentStore;
	writers: DocumentWriters;
	library: ReferenceLibraryState;
	scenes: MediaProps["scenes"];
	videoOverlays: MediaProps["videoOverlays"];
	audioOverlays: MediaProps["audioOverlays"];
	ops: TimelinePanelOps;
	view: TimelinePanelView;
	mediaError: string | null;
	setMediaError: (error: string | null) => void;
	close: () => void;
}

export function TimelineMediaTab({
	imports,
	store,
	writers,
	library,
	scenes,
	videoOverlays,
	audioOverlays,
	ops,
	view,
	mediaError,
	setMediaError,
	close,
}: TimelineMediaTabProps): JSX.Element {
	const { mediaAssets, ensureMediaAsset } = library;

	const setMediaAssets: ReferenceLibraryState["setMediaAssets"] = (update) => {
		const before = library.getMediaAssets(),
			next = resolveSetState(update, before);
		if (!deepEqual(before, next)) writers.apply(mediaAssetsCommand(next));
	};
	return (
		<>
			{mediaError && <Note role="alert">{mediaError}</Note>}
			<AllMediaPanel
				imports={imports}
				embedded
				mediaAssets={mediaAssets}
				scenes={scenes}
				videoOverlays={videoOverlays}
				audioOverlays={audioOverlays}
				onReplace={
					imports?.readiness?.available
						? (id, file) => {
								// The recorded source is what must not change meanwhile; an import of it
								// finishing is resolution, not a change. The replacement is computed against
								// the media as surfaces show it, so a finished import is its managed source.
								const recorded = () => {
									const target = library.getMediaAssets().find((asset) => asset.id === id);
									return target && mediaSourceIdentity(target);
								};
								const expected = recorded();
								if (!expected) return;
								imports.enqueue(
									[file],
									(asset) => {
										try {
											if (recorded() !== expected)
												throw new Error("Source changed while replacement was processing");
											const current = {
												doc: withReadyPending(store.getDoc()),
												mediaAssets: withReadyPending(library.getMediaAssets()),
											};
											const shown = current.mediaAssets.find((candidate) => candidate.id === id)!;
											writers.apply(
												replaceProjectMedia(
													current,
													id,
													mediaSourceIdentity(shown),
													ReadyImportedMediaSchema.parse(asset),
												),
											);
											setMediaError(null);
											return true;
										} catch (error) {
											setMediaError(
												error instanceof Error ? error.message : "Could not replace source",
											);
											return false;
										}
									},
									{ whenReady: true },
								);
							}
						: undefined
				}
				onRename={(id, label) =>
					setMediaAssets((assets) =>
						assets.map((asset) => (asset.id === id ? { ...asset, label } : asset)),
					)
				}
				onPlaceSelected={(ids) => {
					try {
						writers.mutate((doc) =>
							placeProjectMedia(doc, mediaAssets, ids, view.playhead.get(), Date.now()),
						);
						setMediaError(null);
					} catch (error) {
						setMediaError(
							error instanceof Error ? error.message : "Could not place selected media",
						);
					}
				}}
				onRemoveSelected={(ids) => {
					setMediaAssets((assets) => removeUnusedProjectMedia(assets, ids, store.deriveArrays()));
					setMediaError(
						ids.some((id) => view.lockedMediaAssetIds.has(id))
							? "Used media kept. Remove its clips first."
							: null,
					);
				}}
				onRevealUsage={(usage) => {
					const clip = store
						.getDoc()
						.clips.find(
							(candidate) =>
								candidate.id ===
								`${usage.ref.type === "broll" ? "video" : usage.ref.type}:${usage.ref.id}`,
						);
					if (!clip) return;
					ops.jumpToClip(usage.ref);
					ops.seekPreview(clip.startSec + usage.offset);
					close();
				}}
				aspect={view.aspect}
				usedAssetIds={view.lockedMediaAssetIds}
				onInsert={(item) => {
					const media = {
						...item,
						url: item.url ?? "",
						mediaAssetId: item.assetBacked ? item.id : undefined,
					};
					const error = mediaDropReason(media, mediaAssets);
					if (error || (store.getDoc().trackFlags?.[-1]?.locked && item.kind === "image")) {
						setMediaError(error ?? "Track locked");
						return;
					}
					let id = Date.now();
					while (
						store
							.getDoc()
							.clips.some(
								(clip) => clip.id === `${item.kind === "audio" ? "audio" : "video"}:${id}`,
							)
					)
						id++;
					const at = view.playhead.get();
					const flags = store.getDoc().trackFlags ?? {};
					const row = Number(
						Object.keys(flags).find(
							(key) =>
								Number(key) >= 0 &&
								flags[Number(key)]?.group === (item.kind === "audio" ? "audio" : "visual") &&
								!flags[Number(key)]?.locked,
						) ?? 0,
					);
					if (
						item.kind !== "image" &&
						placeMediaOverlay(store.getDoc(), media, at, row, id) === store.getDoc()
					) {
						setMediaError("Destination track locked");
						return;
					}
					setMediaError(null);
					writers.beginGesture();
					try {
						const assetId = ensureMediaAsset({
							...media,
							id: media.mediaAssetId,
							label: item.label,
						});
						if (item.kind === "image") ops.addSceneWithMedia(media.url, assetId);
						else {
							writers.mutate((doc) =>
								placeMediaOverlay(doc, { ...media, mediaAssetId: assetId }, at, row, id),
							);
							ops.selectFreeClip(item.kind === "audio" ? "audio" : "video", id, at);
						}
					} finally {
						writers.endGesture();
					}
				}}
				onReveal={ops.revealMediaAsset}
				// Only ever called for an asset no clip references, so there is
				// nothing to unwire — dropping it from the set is the whole edit.
				onDelete={(id) =>
					setMediaAssets((assets) => removeUnusedProjectMedia(assets, [id], store.deriveArrays()))
				}
				onToggleFavorite={(id) =>
					setMediaAssets((m) => m.map((a) => (a.id === id ? { ...a, favorite: !a.favorite } : a)))
				}
				onClose={close}
			/>
		</>
	);
}
