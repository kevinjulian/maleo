/* The gallery: every image the ACTIVE workspace's work produced, newest first.
 *
 * Cross-PROJECT, within one workspace. It had a workspace filter, which was the
 * one way left to see another tenant's images while believing the app was
 * scoped; the active workspace answers that question now and there is no
 * per-surface override. The stated cost is that two workspaces can no longer be
 * compared side by side.
 *
 * Not a prompt list. The surface this replaces read prompt_library — one row per
 * PROMPT, lab-only, and blind to the clip, reference and agent images that were
 * never recorded at all. It also reported `{items.length} images` while counting
 * prompts. This reads the ledger, so a count of images is a count of images.
 *
 * Filters live in the URL so a narrowed view is shareable, which is half the point
 * of the gallery being its own route rather than a drawer.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { deleteImage, fetchImageFacets, fetchImages, starImage } from "@api/image-gen.ts";
import { useActiveWorkspace } from "@hooks/workspace/use-active-workspace.ts";
import type { LedgerImage } from "@models/image-lab/image-job.ts";
import { Page, PageHeader } from "@design-system/components/page.tsx";
import { SearchField } from "@design-system/components/search-field.tsx";
import { Select } from "@design-system/components/select.tsx";
import {
	EmptyState,
	ErrorState,
	LoadingState,
	collectionPhase,
} from "@design-system/patterns/collection.tsx";
import { Button } from "@design-system/components/button.tsx";
import { FrameAction, FrameActions, FrameBadge } from "@design-system/components/frame.tsx";
import {
	GALLERY_PAGE_SIZE,
	SOURCE_FILTERS,
	attributionOf,
	type GalleryFilters,
	type SourceFilter,
} from "@models/images/gallery-filters.ts";
import "./images-gallery.css";
import { Toolbar, ToolbarGroup } from "@design-system/patterns/toolbar.tsx";
import { ChipButton } from "@design-system/components/chip.tsx";
import { MediaCard, MediaGrid } from "@design-system/patterns/media.tsx";
import { Chip } from "@design-system/components/chip.tsx";

interface ImagesGalleryProps {
	filters: GalleryFilters;
	onFilters: (next: GalleryFilters) => void;
	onOpenProject?: (projectId: string) => void;
	onOpenLab?: () => void;
}

export function ImagesGallery({
	filters,
	onFilters,
	onOpenProject,
	onOpenLab,
}: ImagesGalleryProps): JSX.Element {
	const workspace = useActiveWorkspace();
	const [items, setItems] = useState<LedgerImage[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [page, setPage] = useState(0);
	/* Recovered images can point at files the service no longer has — the backfill
	 * restores the RECORD of a generation, which outlives its bytes. Those 502 on
	 * fetch, so the tile says the image is gone rather than rendering a broken
	 * <img> with its whole prompt as alt text. */
	const [missing, setMissing] = useState<ReadonlySet<string>>(new Set());
	/* Project options come from the images that exist, not from a registry: a
	 * project with no images is not a useful choice. There is no workspace facet
	 * — the gallery shows one workspace and offers no way to leave it. */
	const [facets, setFacets] = useState<{ projects: Array<{ id: string; title: string }> }>({
		projects: [],
	});
	const markMissing = useCallback((id: string) => {
		setMissing((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
	}, []);

	// A filter change is a new result set, not a new page of the old one.
	useEffect(() => {
		setPage(0);
	}, [filters.source, filters.project, filters.search, workspace]);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await fetchImages<LedgerImage>({
				limit: GALLERY_PAGE_SIZE,
				offset: page * GALLERY_PAGE_SIZE,
				source: filters.source === "all" ? undefined : filters.source,
				project: filters.project || undefined,
				// The active workspace, explicitly. Image reads share a route family
				// with the generation calls, which must NOT carry it, so the api
				// client does not add it here the way it does for /api/operations.
				workspace,
				search: filters.search || undefined,
			});
			setItems(res.items);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setItems([]);
		}
		setLoading(false);
	}, [filters.source, filters.project, filters.search, page, workspace]);

	useEffect(() => {
		void load();
	}, [load]);
	const phase = collectionPhase({ count: items.length, loading, failed: error !== null });

	useEffect(() => {
		let alive = true;
		void fetchImageFacets(workspace)
			.then((f) => {
				if (alive) setFacets(f);
			})
			.catch(() => {
				/* the select just stays at "all projects" */
			});
		return () => {
			alive = false;
		};
	}, [workspace]);

	const selectedItem = useMemo(
		() => items.find((i) => i.id === selected) ?? null,
		[items, selected],
	);

	const setSource = (source: SourceFilter): void => onFilters({ ...filters, source });

	const toggleStar = async (id: string): Promise<void> => {
		await starImage(id);
		setItems((prev) => prev.map((i) => (i.id === id ? { ...i, starred: i.starred ? 0 : 1 } : i)));
	};

	/* Hides the image. The ledger row survives — it is the artifact side of a
	 * metered, billed generation, and tidying a gallery must not make that spend
	 * unattributable. */
	const hide = async (id: string): Promise<void> => {
		await deleteImage(id);
		setItems((prev) => prev.filter((i) => i.id !== id));
		if (selected === id) setSelected(null);
	};

	const atLastPage = items.length < GALLERY_PAGE_SIZE;

	return (
		<Page>
			<PageHeader
				title="Images"
				lead={`Every image generated across ${workspace}'s projects.`}
				action={
					<>
						<Chip>
							{items.length} {items.length === 1 ? "image" : "images"}
						</Chip>
						{onOpenLab && (
							<Button type="button" variant="primary" onClick={onOpenLab}>
								{Ic.spark(ICON.md)} Generate
							</Button>
						)}
					</>
				}
			/>

			<Toolbar label="Search and filter images" className="collection-toolbar">
				<SearchField
					label="Search image prompts"
					placeholder="Search prompts"
					value={filters.search}
					onValueChange={(search) => onFilters({ ...filters, search })}
				/>
				{/* Project is a select rather than chips: the list grows without bound,
				    and a chip row of every project would push the grid off the screen. */}
				<Select
					width="auto"
					size="md"
					aria-label="Filter images by project"
					value={filters.project}
					onValueChange={(e) => onFilters({ ...filters, project: e })}
					options={[
						{ value: "", label: "All projects" },
						...(facets.projects.map((p) => ({ value: p.id, label: p.title })) ?? []),
					]}
				/>
				<ToolbarGroup label="Filter images by source" className="chip-row">
					{SOURCE_FILTERS.map((f) => (
						<ChipButton
							key={f.value}
							variant="inline"
							on={filters.source === f.value}
							onClick={() => setSource(f.value)}
						>
							{f.label}
						</ChipButton>
					))}
				</ToolbarGroup>
			</Toolbar>

			{phase === "loading" ? (
				<LoadingState label="Loading images…" />
			) : phase === "failed" ? (
				<ErrorState
					title="Could not load images"
					message="The server did not answer as expected."
					onRetry={() => void load()}
					retrying={loading}
				/>
			) : phase === "empty" ? (
				/* Names the workspace it is empty for. Most workspaces own nothing,
				   so a correct empty gallery is the ordinary case. */
				<EmptyState
					title={`No images in ${workspace} yet`}
					label={
						filters.search || filters.project || filters.source !== "all"
							? "Nothing in this workspace matches these filters."
							: "Generated images appear here automatically. Switch workspace to see another's."
					}
				/>
			) : (
				<MediaGrid label="Generated images">
					{items.map((item) => (
						<MediaCard
							key={item.id}
							preview={
								<img
									src={item.asset_url ?? ""}
									alt=""
									loading="lazy"
									onError={() => markMissing(item.id)}
								/>
							}
							unavailable={missing.has(item.id) ? "Image unavailable" : undefined}
							/* Where it came from — the question a gallery of every project's
							   output has to answer on the tile itself. */
							caption="overlay"
							title={attributionOf(item)}
							label={`Image, ${attributionOf(item)}`}
							overlay={
								item.starred ? (
									<FrameBadge corner="tr" className="tw:text-[var(--warn)]">
										{Ic.zap(ICON.xs)}
									</FrameBadge>
								) : null
							}
							selected={item.id === selected}
							onActivate={() => setSelected(item.id === selected ? null : item.id)}
						/>
					))}
				</MediaGrid>
			)}

			{(page > 0 || !atLastPage) && (
				<div className="gal-pager">
					<Button
						type="button"
						variant="secondary"
						size="sm"
						disabled={page === 0 || loading}
						onClick={() => setPage((p) => p - 1)}
					>
						Prev
					</Button>
					<span className="gal-pager-at">Page {page + 1}</span>
					<Button
						type="button"
						variant="secondary"
						size="sm"
						disabled={atLastPage || loading}
						onClick={() => setPage((p) => p + 1)}
					>
						Next
					</Button>
				</div>
			)}

			{selectedItem && (
				<aside className="gal-detail" aria-label="Image detail">
					{missing.has(selectedItem.id) ? (
						<div className="gal-detail-gone">
							{Ic.image(ICON.xl)}
							<em>Image unavailable — the file is no longer stored</em>
						</div>
					) : (
						<img
							src={selectedItem.asset_url ?? ""}
							alt=""
							onError={() => markMissing(selectedItem.id)}
						/>
					)}
					<div className="gal-detail-body">
						{/* A recovered row has no prompt because the generation was never
						    recorded. Say so rather than rendering an empty box. */}
						<p className="gal-detail-prompt">
							{selectedItem.prompt ?? (
								<em>Prompt not recorded — recovered from an earlier project</em>
							)}
						</p>
						<dl className="gal-detail-meta">
							<dt>From</dt>
							<dd>{attributionOf(selectedItem)}</dd>
							<dt>Made</dt>
							<dd>
								{new Date(selectedItem.created_at).toLocaleDateString()}
								{selectedItem.backfilled ? " (approximate)" : ""}
							</dd>
						</dl>
						<div className="gal-detail-actions">
							{selectedItem.project_id && onOpenProject && (
								<Button
									type="button"
									variant="primary"
									size="sm"
									onClick={() => onOpenProject(selectedItem.project_id!)}
								>
									Open project
								</Button>
							)}
							<Button
								type="button"
								variant="secondary"
								size="sm"
								onClick={() => void toggleStar(selectedItem.id)}
							>
								{selectedItem.starred ? "Unstar" : "Star"}
							</Button>
							<Button
								type="button"
								variant="secondary"
								size="sm"
								onClick={() => void hide(selectedItem.id)}
							>
								Remove
							</Button>
						</div>
					</div>
					<FrameActions>
						<FrameAction aria-label="Close detail" onClick={() => setSelected(null)}>
							{Ic.x(ICON.sm)}
						</FrameAction>
					</FrameActions>
				</aside>
			)}
		</Page>
	);
}
