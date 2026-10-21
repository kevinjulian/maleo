/* Project media: admitted assets plus scene frames, split into In use and
 * Ready to place. Used sources stay protected; ready files can be placed by
 * drag or an explicit keyboard/touch action. */
import { useEffect, useMemo, useRef, useState } from "react";
import { assetUrl } from "@models/core/asset-url.ts";
import { usePendingMediaVersion } from "@hooks/editor/use-pending-media-version.ts";
import { usePendingUploadsVersion } from "@hooks/editor/use-pending-upload.ts";
import { pendingUploadLabel, pendingUploadStateOf } from "@models/core/pending-media-sources.ts";
import {
	PendingUploadActions,
	PendingUploadMeta,
	PendingUploadOverlay,
} from "./pending-upload.tsx";
import type { JSX } from "react";
import { createPortal } from "react-dom";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { PanelHeader } from "@design-system/patterns/panel-header.tsx";
import { SearchField } from "@design-system/components/search-field.tsx";
import { Frame, FrameBadge, FrameAction } from "@design-system/components/frame.tsx";
import { mediaUseReason } from "@models/timeline/pending-media-asset.ts";
import { mediaUsages, type MediaUsage } from "@models/timeline/media-usage.ts";
import { MediaDetails } from "./media-details.tsx";
import { posterSrc } from "./media-thumb.tsx";
import { AudioPreview } from "@design-system/components/audio-preview.tsx";
import { MediaHoverPreview, type HoverTarget } from "./media-hover-preview.tsx";
import { writeMediaDragPayload } from "@models/timeline/media-drag.ts";
import { type Scene, type VideoOverlay, type AudioOverlay } from "@maleo/shared";
import type { MediaAsset } from "@models/timeline/editor-media.ts";
import { MediaCard, MediaGrid } from "@design-system/patterns/media.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";
import { MediaImport } from "./media-import.tsx";
import type { MediaImportControls } from "@hooks/editor/use-media-import.ts";
import { Toolbar, ToolbarGroup, ToolbarAction } from "@design-system/patterns/toolbar.tsx";
import { Select, onSelect } from "@design-system/components/select.tsx";
import {
	MEDIA_SORTS,
	sortProjectMedia,
	pruneMediaSelection,
	mediaFacts,
	type MediaSort,
} from "@models/timeline/media-library.ts";

export interface DisplayItem {
	id: string;
	label: string;
	url?: string;
	thumb?: string;
	seed: number;
	kind: "image" | "video" | "audio";
	source: MediaAsset["source"];
	audioKind?: MediaAsset["audioKind"];
	dur?: number;
	favorite?: boolean;
	/** False for a scene frame, which has no asset record to favourite. */
	assetBacked: boolean;
	/** Whether a clip references this. Drives which section it lands in and
	 *  whether Delete is offered — an asset a clip holds cannot be deleted, and
	 *  one nothing holds can only be removed that way. */
	placed: boolean;
	metadata?: MediaAsset["metadata"];
}

interface AllMediaPanelProps {
	imports?: MediaImportControls;
	mediaAssets: MediaAsset[];
	scenes: Scene[];
	videoOverlays?: VideoOverlay[];
	audioOverlays?: AudioOverlay[];
	onRename?: (id: string, label: string) => void;
	onReplace?: (id: string, file: File) => void;
	onPlaceSelected?: (ids: string[]) => void;
	onRemoveSelected?: (ids: string[]) => void;
	onRevealUsage?: (usage: MediaUsage) => void;
	aspect: number;
	/** The assets the document references. This is the panel's contents, not a
	 *  badge over them. */
	usedAssetIds: Set<string>;
	onInsert: (item: DisplayItem) => void;
	/** Select and seek to a clip that uses this asset. The only answer for a
	 *  placed asset, which cannot be deleted while a clip holds it. */
	onReveal: (id: string) => void;
	/** Drop an asset no clip references. Offered only for those — the two are
	 *  complementary, and which one an operator gets follows from the section. */
	onDelete: (id: string) => void;
	onToggleFavorite: (id: string) => void;
	onClose: () => void;
	embedded?: boolean;
}

/** What the panel lists: every asset the project has admitted, plus the scene
 *  frames that are in use by being scenes at all. Each item carries whether a
 *  clip references it, which splits the list into what the render will consume
 *  and what has been kept but not yet positioned.
 *
 *  Scene frames used to be inherently unattributable — generation set `src` and
 *  admitted nothing, so a frame had no asset to name and no favourite or reveal.
 *  It does now: generation admits, and reconciliation repairs projects saved
 *  before it did. The frames stay a separate pass because they are placed by
 *  being scenes rather than by being in the used set, but they are no longer a
 *  second class of thing.
 *
 *  Exported because this is the panel's whole meaning, and a rule about what a
 *  surface contains is worth checking without mounting the surface. */
export function buildMediaManifestItems({
	mediaAssets,
	scenes,
	usedAssetIds,
}: {
	mediaAssets: MediaAsset[];
	scenes: Scene[];
	usedAssetIds: Set<string>;
}): DisplayItem[] {
	const out: DisplayItem[] = [];
	const seen = new Set<string>();
	const push = (it: DisplayItem): void => {
		const k = it.url ?? it.id;
		if (seen.has(k)) return;
		seen.add(k);
		out.push(it);
	};
	// Scene frames go first so they win the URL dedup below. A scene IS a clip,
	// so its frames are in use by definition. If an admitted asset happens to
	// share a frame's URL, the frame is the honest entry: the file is on the
	// timeline, and letting the asset win would file it as unplaced while it is
	// visibly in use.
	//
	// A frame is now asset-backed whenever its scene carries an identity, which
	// is every frame a writer produced — generation admits, and reconciliation
	// repairs the rest. `assetBacked: false` survives for frames in a project
	// that has not been reconciled yet, where there genuinely is no asset to name.
	// Backing matters because it is what carries favourite, reveal and a drag
	// payload that does not re-admit.
	const frame = (
		id: string,
		label: string,
		url: string,
		seed: number,
		assetId: string | undefined,
	): DisplayItem => ({
		id: assetId ?? id,
		label: mediaAssets.find((asset) => asset.id === assetId)?.label ?? label,
		url,
		seed,
		kind: "image",
		source: "generated",
		assetBacked: Boolean(assetId),
		favorite: assetId ? mediaAssets.find((a) => a.id === assetId)?.favorite : undefined,
		metadata: assetId ? mediaAssets.find((a) => a.id === assetId)?.metadata : undefined,
		placed: true,
	});
	for (const s of scenes) {
		if (s.img && s.src) push(frame(`scene-${s.id}`, s.name, s.src, s.seed ?? s.id, s.mediaAssetId));
		if (s.endSrc)
			push(
				frame(
					`scene-${s.id}-end`,
					`${s.name} (end)`,
					s.endSrc,
					(s.seed ?? s.id) + 1,
					s.endMediaAssetId,
				),
			);
	}
	// Every admitted asset, tagged with whether a clip points at it. One admitted
	// and never placed is still the project's — it is staged, not absent.
	for (const a of mediaAssets) {
		push({
			id: a.id,
			label: a.label,
			url: a.url,
			thumb: a.thumb ?? a.poster,
			seed: 0,
			kind: a.kind,
			source: a.source,
			audioKind: a.audioKind,
			dur: a.dur,
			metadata: a.metadata,
			favorite: a.favorite,
			assetBacked: true,
			placed: usedAssetIds.has(a.id),
		});
	}
	return out;
}

export function AllMediaPanel({
	imports,
	mediaAssets,
	scenes,
	videoOverlays = [],
	audioOverlays = [],
	onRename,
	onReplace,
	onPlaceSelected,
	onRemoveSelected,
	onRevealUsage,
	aspect,
	usedAssetIds,
	onInsert,
	onReveal,
	onDelete,
	onToggleFavorite,
	onClose,
	embedded = false,
}: AllMediaPanelProps): JSX.Element {
	const body = useRef<HTMLDivElement>(null);
	usePendingMediaVersion();
	usePendingUploadsVersion();
	// A pending asset's file chosen again from its card (use-media-while-uploading D5).
	const againInput = useRef<HTMLInputElement>(null),
		againKey = useRef<string | null>(null);
	const [q, setQ] = useState("");
	const [layout, setLayout] = useState<"grid" | "list">("grid");
	const [sort, setSort] = useState<MediaSort>("added");
	const [selected, setSelected] = useState(new Set<string>());
	const [kindFilter, setKindFilter] = useState<"all" | DisplayItem["kind"]>("all");
	const [menu, setMenu] = useState<{ item: DisplayItem; x: number; y: number } | null>(null);
	const [expand, setExpand] = useState<DisplayItem | null>(null);
	// Which cell the cursor is resting on. The rect is captured on enter rather
	// than measured later, because the preview is positioned against where the
	// cell was when the operator pointed at it.
	const [hover, setHover] = useState<HoverTarget | null>(null);

	const items = useMemo(
		() => buildMediaManifestItems({ mediaAssets, scenes, usedAssetIds }),
		[mediaAssets, scenes, usedAssetIds],
	);

	// Search + kind filter, favorites first (stable within each half).
	const filtered = useMemo(
		() =>
			sortProjectMedia(
				items.filter(
					(i) =>
						(kindFilter === "all" || i.kind === kindFilter) &&
						(!q.trim() || i.label.toLowerCase().includes(q.toLowerCase())),
				),
				sort,
			),
		[items, kindFilter, q, sort],
	);
	useEffect(() => {
		setSelected((current) => {
			const next = pruneMediaSelection(
				current,
				filtered.map((item) => item.id),
			);
			return next.size === current.size ? current : next;
		});
	}, [filtered]);
	const selection = (it: DisplayItem) =>
		it.assetBacked
			? {
					label: `Select ${it.label}`,
					checked: selected.has(it.id),
					onCheckedChange: (checked: boolean) =>
						setSelected((current) => {
							const next = new Set(current);
							if (checked) next.add(it.id);
							else next.delete(it.id);
							return next;
						}),
				}
			: undefined;
	// The two halves the panel exists to distinguish: what the render will
	// consume, and what has been kept but not yet positioned.
	const placedItems = filtered.filter((i) => i.placed);
	const stagedItems = filtered.filter((i) => !i.placed);
	const selectedInOrder = [...placedItems, ...stagedItems]
		.filter((item) => selected.has(item.id))
		.map((item) => item.id);

	const KIND_FILTERS: Array<["all" | DisplayItem["kind"], string]> = [
		["all", "All"],
		["image", "Images"],
		["video", "Videos"],
		["audio", "Audio"],
	];

	const act = (fn: () => void): void => {
		fn();
		setMenu(null);
	};
	/* A pending asset's state composes into its own card; its key is the asset id. */
	const upload = (it: DisplayItem) => pendingUploadStateOf(it.url);
	const uploadActions = (it: DisplayItem): JSX.Element | null => {
		const state = upload(it);
		return state && imports ? (
			<PendingUploadActions
				name={it.label}
				state={state}
				handlers={{
					onCancel: () => imports.cancel(it.id),
					onRetry: () => imports.retry(it.id),
					onDelete: () => imports.dismiss(it.id),
					onChooseAgain: () => {
						againKey.current = it.id;
						againInput.current?.click();
					},
				}}
			/>
		) : null;
	};
	const uploadLabel = (it: DisplayItem): string | undefined => {
		const state = upload(it);
		return state && `${it.label}, ${pendingUploadLabel(state)}`;
	};
	const unavailable = (it: DisplayItem): string | undefined => {
		const asset = mediaAssets.find((candidate) => candidate.id === it.id);
		return !it.url ? "Source file is missing" : asset ? mediaUseReason(asset) : undefined;
	};

	const dragPayload =
		(it: DisplayItem) =>
		(e: React.DragEvent<HTMLElement>): void => {
			if (!it.url || unavailable(it)) {
				e.preventDefault();
				return;
			}
			setHover(null); // a preview floating under the cursor during a drag is noise
			writeMediaDragPayload(
				e.dataTransfer,
				{
					url: it.url,
					kind: it.kind,
					label: it.label,
					source: it.source,
					// Only an admitted asset carries an id; a scene frame does not.
					mediaAssetId: it.assetBacked ? it.id : undefined,
					thumb: it.thumb,
					dur: it.dur,
					audioKind: it.audioKind,
				},
				e.currentTarget,
			);
		};

	const audioCell = (it: DisplayItem): JSX.Element => (
		<MediaCard
			key={it.id}
			layout="list"
			aspect={1}
			preview={Ic.mic(ICON.lg)}
			title={it.label}
			meta={upload(it) ? <PendingUploadMeta state={upload(it)!} /> : mediaFacts(it)}
			label={uploadLabel(it)}
			data-upload-state={upload(it)?.phase}
			overlay={upload(it) && <PendingUploadOverlay name={it.label} state={upload(it)!} />}
			selection={selection(it)}
			draggable={!unavailable(it)}
			onDragStart={dragPayload(it)}
			onContextMenu={(event) => {
				event.preventDefault();
				setMenu({ item: it, x: event.clientX, y: event.clientY });
			}}
			actions={
				<Toolbar label={`Audio actions: ${it.label}`}>
					<AudioPreview
						src={unavailable(it) || !it.url ? undefined : assetUrl(it.url)}
						durationSec={it.dur}
						label={it.label}
					/>
					<IconButton size="xs" title={`Media details: ${it.label}`} onClick={() => setExpand(it)}>
						{Ic.expand(ICON.sm)}
					</IconButton>
					<IconButton
						size="xs"
						title={`Add ${it.label} to timeline`}
						disabled={Boolean(unavailable(it))}
						onClick={() => onInsert(it)}
					>
						{Ic.plus(ICON.sm)}
					</IconButton>
					{uploadActions(it)}
				</Toolbar>
			}
		/>
	);

	/* A visual cell is the thumbnail and nothing else: the label rides on it as
	 * an overlay rather than taking a second line, and the detail the small tile
	 * drops comes back on hover (see media-hover-preview.tsx). */
	const visualCell = (it: DisplayItem): JSX.Element => (
		<MediaCard
			key={it.id}
			hint={`${it.label} · drag onto the timeline · right-click for actions`}
			draggable={!unavailable(it)}
			unavailable={unavailable(it)}
			layout={layout}
			selection={selection(it)}
			meta={
				upload(it) ? (
					<PendingUploadMeta state={upload(it)!} />
				) : layout === "list" ? (
					mediaFacts(it)
				) : undefined
			}
			label={uploadLabel(it)}
			data-upload-state={upload(it)?.phase}
			onDragStart={dragPayload(it)}
			onContextMenu={(e) => {
				e.preventDefault();
				setMenu({ item: it, x: e.clientX, y: e.clientY });
			}}
			onMouseEnter={(e) => {
				if (!it.url) return;
				const panel = e.currentTarget.closest(".tl2-panel-body");
				const host = panel
					? panel.getBoundingClientRect()
					: e.currentTarget.getBoundingClientRect();
				setHover({
					url: it.url,
					thumb: it.thumb,
					label: it.label,
					kind: it.kind,
					rect: e.currentTarget.getBoundingClientRect(),
					host: { left: host.left, right: host.right },
				});
			}}
			onMouseLeave={() => setHover(null)}
			aspect={aspect}
			actions={
				<Toolbar label={`Media actions: ${it.label}`}>
					<FrameAction
						title={`Add ${it.label} to timeline`}
						disabled={Boolean(unavailable(it))}
						onClick={() => onInsert(it)}
					>
						{Ic.plus(ICON.xs)}
					</FrameAction>
					<FrameAction title={`Media details: ${it.label}`} onClick={() => setExpand(it)}>
						{Ic.expand(ICON.xs)}
					</FrameAction>
					{uploadActions(it)}
				</Toolbar>
			}
			// A pending card's state needs its status line, which only a caption below carries.
			caption={upload(it) ? "below" : "overlay"}
			title={it.label}
			preview={
				it.kind === "video" && it.url ? (
					// A still here; the hover preview is what plays. Two decoders on one
					// file for one cursor position is waste the small tile cannot show.
					<video
						muted
						playsInline
						preload="metadata"
						poster={it.thumb && assetUrl(it.thumb)}
						src={posterSrc(assetUrl(it.url))}
					/>
				) : (
					<Frame
						generated={Boolean(it.url)}
						src={it.url}
						seed={it.seed}
						aspect={aspect}
						w="100%"
						fit="cover"
					/>
				)
			}
			overlay={
				<>
					{it.kind === "video" && (
						<FrameBadge corner="br">
							{Ic.film(ICON.xs)}
							{it.dur != null && `${Math.round(it.dur)}s`}
						</FrameBadge>
					)}
					{it.favorite && (
						<FrameBadge className="tw:text-[var(--warn)]">{Ic.spark(ICON.xs)}</FrameBadge>
					)}
					{upload(it) && <PendingUploadOverlay name={it.label} state={upload(it)!} />}
				</>
			}
		/>
	);

	const cell = (it: DisplayItem): JSX.Element =>
		it.kind === "audio" ? audioCell(it) : visualCell(it);

	// A section with nothing in it is omitted rather than shown empty — an empty
	// grid under a heading reads as a loading failure, and the count is the point.
	//
	// Audio record rows span the grid without changing displayed sort order.
	const section = (label: string, list: DisplayItem[]): JSX.Element | null =>
		list.length === 0 ? null : (
			<section className="fc-media-sec">
				<h4 className="fc-media-sec-h">
					{label}
					<span>{list.length}</span>
				</h4>
				<MediaGrid
					label={`Project media: ${label}`}
					layout={layout}
					min={72}
					density="compact"
					className="fc-mediagrid"
				>
					{list.map(cell)}
				</MediaGrid>
			</section>
		);
	const searchField = (
		<SearchField
			size="sm"
			className="tw:flex-1 tw:basis-32"
			label="Search media"
			placeholder="Search media…"
			value={q}
			onValueChange={setQ}
		/>
	);

	return (
		<>
			{!embedded && (
				<PanelHeader density="tool" title="All Media" onClose={onClose} closeLabel="Hide panel" />
			)}
			{/* The rect the preview is anchored to goes stale the moment the list
			    moves, so scrolling dismisses rather than repositions. */}
			<div
				ref={body}
				className="tl2-panel-body"
				onScroll={() => setHover(null)}
				onDragOver={(event) => {
					if (imports && Array.from(event.dataTransfer.types).includes("Files")) {
						event.preventDefault();
						event.dataTransfer.dropEffect = imports.readiness?.available ? "copy" : "none";
					}
				}}
				onDrop={(event) => {
					if (imports && event.dataTransfer.files.length) {
						event.preventDefault();
						event.stopPropagation();
						imports.enqueue(Array.from(event.dataTransfer.files));
					}
				}}
			>
				{imports ? (
					<MediaImport controls={imports} layout={layout}>
						{searchField}
					</MediaImport>
				) : (
					searchField
				)}
				<input
					ref={againInput}
					type="file"
					hidden
					aria-label="Choose the file again"
					onChange={(event) => {
						const file = event.currentTarget.files?.[0],
							key = againKey.current;
						event.currentTarget.value = "";
						againKey.current = null;
						if (file && key) imports?.chooseAgain(key, file);
					}}
				/>
				<Toolbar label="Media filters and view">
					<Select
						size="xs"
						width="auto"
						className="tw:flex-1 tw:basis-16"
						aria-label="Filter media by kind"
						value={kindFilter}
						onValueChange={onSelect(
							KIND_FILTERS.map(([kind]) => kind),
							setKindFilter,
						)}
						phoneBreakpoint={860}
						options={[
							...(KIND_FILTERS.map(([kind, label]) => ({ value: kind, label: label })) ?? []),
						]}
					/>
					<Select
						size="xs"
						width="auto"
						className="tw:flex-1 tw:basis-24"
						aria-label="Sort media"
						value={sort}
						onValueChange={onSelect(MEDIA_SORTS, setSort)}
						phoneBreakpoint={860}
						options={[
							...(MEDIA_SORTS.map((value) => ({
								value: value,
								label:
									value === "added"
										? "Added / favorites"
										: value[0]!.toUpperCase() + value.slice(1),
							})) ?? []),
						]}
					/>
					<ToolbarGroup label="Media view">
						<ToolbarAction
							label="Grid view"
							icon={Ic.grid(ICON.sm)}
							on={layout === "grid"}
							onAction={() => setLayout("grid")}
						/>
						<ToolbarAction
							label="List view"
							icon={Ic.list(ICON.sm)}
							on={layout === "list"}
							onAction={() => setLayout("list")}
						/>
					</ToolbarGroup>
				</Toolbar>
				{selected.size > 0 && (
					<Toolbar label="Selected media actions">
						{onPlaceSelected && (
							<ToolbarAction
								label="Place selected media"
								onAction={() => onPlaceSelected(selectedInOrder)}
							>
								Place selected ({selected.size})
							</ToolbarAction>
						)}
						{onRemoveSelected && (
							<ToolbarAction
								label="Remove selected media"
								danger
								disabled={!selectedInOrder.some((id) => !usedAssetIds.has(id))}
								onAction={() => onRemoveSelected(selectedInOrder)}
							>
								Remove unused ({selectedInOrder.filter((id) => !usedAssetIds.has(id)).length})
							</ToolbarAction>
						)}
						<ToolbarAction
							label="Clear selection"
							onAction={() => {
								setSelected(new Set());
								body.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
							}}
						>
							Clear selection ({selected.size})
						</ToolbarAction>
					</Toolbar>
				)}
				{filtered.length === 0 ? (
					<div className="tl2-empty">
						{Ic.image(ICON.xl)}
						<span>
							{items.length === 0
								? "No media yet. Drag from Stock or the Reference Library onto the timeline to place something, or save it here first to decide later."
								: "No files match that search."}
						</span>
					</div>
				) : (
					<>
						{section("In use", placedItems)}
						{section("Ready to place", stagedItems)}
					</>
				)}
			</div>

			{menu &&
				createPortal(
					<>
						<div
							aria-hidden="true"
							className="fc-ctx-scrim"
							onClick={() => setMenu(null)}
							onContextMenu={(e) => {
								e.preventDefault();
								setMenu(null);
							}}
						/>
						<div
							className="fc-ctx"
							style={{
								left: Math.min(menu.x, window.innerWidth - 200),
								top: Math.min(menu.y, window.innerHeight - 240),
							}}
						>
							<button className="fc-ctx-item" onClick={() => act(() => setExpand(menu.item))}>
								{Ic.image(ICON.sm)} Expand
							</button>
							<button
								className="fc-ctx-item"
								disabled={Boolean(unavailable(menu.item))}
								onClick={() => act(() => onInsert(menu.item))}
							>
								{Ic.plus(ICON.sm)} Add to timeline
							</button>
							{menu.item.url && (
								<a
									className="fc-ctx-item"
									href={menu.item.url}
									download
									target="_blank"
									rel="noreferrer"
									onClick={() => setMenu(null)}
								>
									{Ic.upload(ICON.sm)} Download
								</a>
							)}
							<button
								className="fc-ctx-item"
								disabled={!menu.item.assetBacked}
								onClick={() => act(() => onToggleFavorite(menu.item.id))}
							>
								{Ic.spark(ICON.sm)} {menu.item.favorite ? "Unfavorite" : "Favorite"}
							</button>
							<div className="fc-ctx-sep" />
							{/* Reveal and Delete are complementary, not alternatives. A clip holds
						    the asset, so removing it means removing that clip — show the
						    operator which. Nothing holds it, so Delete is the only way out. */}
							<button
								className="fc-ctx-item"
								disabled={!menu.item.assetBacked || !menu.item.placed}
								onClick={() => act(() => onReveal(menu.item.id))}
							>
								{Ic.search(ICON.sm)} Reveal on timeline
							</button>
							<button
								className="fc-ctx-item danger"
								disabled={!menu.item.assetBacked || menu.item.placed}
								title={menu.item.placed ? "A clip uses this — remove the clip instead" : undefined}
								onClick={() => act(() => onDelete(menu.item.id))}
							>
								{Ic.trash(ICON.sm)} Delete
							</button>
						</div>
					</>,
					document.body,
				)}

			{/* Suppressed while a menu or the lightbox is open: both are deliberate,
			    and a preview floating over them is the panel talking over itself. */}
			<MediaHoverPreview target={menu || expand ? null : hover} />

			{expand && (
				<MediaDetails
					item={expand}
					asset={mediaAssets.find((asset) => asset.id === expand.id)}
					onRename={
						expand.assetBacked && onRename ? (name) => onRename(expand.id, name) : undefined
					}
					onReplace={
						expand.assetBacked && onReplace
							? (file) => {
									onReplace(expand.id, file);
									setExpand(null);
								}
							: undefined
					}
					usages={mediaUsages(expand.id, { scenes, videoOverlays, audioOverlays })}
					onReveal={(usage) => {
						setExpand(null);
						onRevealUsage?.(usage);
					}}
					onClose={() => setExpand(null)}
				/>
			)}
		</>
	);
}

export default AllMediaPanel;
