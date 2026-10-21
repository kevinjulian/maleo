/* Every clip synthesized in this workspace.
 *
 * Structurally the images gallery's twin — same filter chrome, same paging, same
 * star and hide — but a ROW list rather than a tile grid. An image tile is
 * identified by looking at it; a clip has to be identified by reading it, and
 * then heard. So the row leads with the spoken text and carries the voice,
 * provider and duration beside a play control.
 *
 * Playing a clip is not a synthesis. It plays the stored artifact through the
 * same shared audio element the voice previews use, which is what keeps "only one
 * clip plays at a time" true across every surface rather than within each one.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { Button } from "@design-system/components/button.tsx";
import { SearchField } from "@design-system/components/search-field.tsx";
import { Select } from "@design-system/components/select.tsx";
import {
	EmptyState,
	ErrorState,
	LoadingState,
	collectionPhase,
} from "@design-system/patterns/collection.tsx";
import { Page, PageHeader } from "@design-system/components/page.tsx";
import { useActiveWorkspace } from "@hooks/workspace/use-active-workspace.ts";
import { useVoiceSample } from "@hooks/timeline/use-voice-sample.ts";
import {
	deleteClip,
	fetchClipFacets,
	fetchClips,
	starClip,
	type LedgerClip,
	type SpeechSource,
} from "@api/speech.ts";
import {
	clipAttributionOf,
	formatClipDuration,
	SPEECH_PAGE_SIZE,
	SPEECH_SOURCE_FILTERS,
	type SpeechFilters,
} from "@models/speech/gallery-filters.ts";
import "@components/images/images-gallery.css";
import "./speech-gallery.css";
import { Toolbar, ToolbarGroup } from "@design-system/patterns/toolbar.tsx";
import { ChipButton } from "@design-system/components/chip.tsx";
import { Chip } from "@design-system/components/chip.tsx";

export interface SpeechGalleryProps {
	filters: SpeechFilters;
	onFilters: (next: SpeechFilters) => void;
	onOpenLab?: () => void;
}

export function SpeechGallery({ filters, onFilters, onOpenLab }: SpeechGalleryProps): JSX.Element {
	const workspace = useActiveWorkspace();
	const sample = useVoiceSample();
	const [items, setItems] = useState<LedgerClip[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [page, setPage] = useState(0);
	/* Filter options come from the clips that exist, not from a registry: a
	 * project with no clips is not a useful choice, and a source speech cannot be
	 * produced by is a control that always returns nothing. */
	const [facets, setFacets] = useState<{
		projects: Array<{ id: string; title: string }>;
		sources: SpeechSource[];
	}>({
		projects: [],
		sources: [],
	});

	// A filter change is a new result set, not a new page of the old one.
	useEffect(() => {
		setPage(0);
	}, [filters.source, filters.project, filters.search, workspace]);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await fetchClips({
				limit: SPEECH_PAGE_SIZE,
				offset: page * SPEECH_PAGE_SIZE,
				source: filters.source === "all" ? undefined : filters.source,
				project: filters.project || undefined,
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
		void fetchClipFacets(workspace)
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

	/* Only the sources this workspace has actually produced, in the fixed display
	 * order. "All" is always offered — it is not a source, it is the absence of
	 * the filter. */
	const sourceFilters = useMemo(
		() =>
			SPEECH_SOURCE_FILTERS.filter(
				(f) => f.value === "all" || facets.sources.some((s) => s === f.value),
			),
		[facets.sources],
	);

	const toggleStar = async (id: string): Promise<void> => {
		await starClip(id);
		setItems((prev) => prev.map((i) => (i.id === id ? { ...i, starred: i.starred ? 0 : 1 } : i)));
	};

	/* Hides the clip. The ledger row survives — it is the artifact side of a
	 * metered, billed synthesis, and tidying a gallery must not make that spend
	 * unattributable. */
	const hide = async (id: string): Promise<void> => {
		await deleteClip(id);
		setItems((prev) => prev.filter((i) => i.id !== id));
	};

	const atLastPage = items.length < SPEECH_PAGE_SIZE;

	return (
		<Page>
			<PageHeader
				title="Speech"
				lead={`Every clip synthesized across ${workspace}'s projects.`}
				action={
					<>
						<Chip>
							{items.length} {items.length === 1 ? "clip" : "clips"}
						</Chip>
						{onOpenLab && (
							<Button type="button" variant="primary" onClick={onOpenLab}>
								{Ic.spark(ICON.md)} Synthesize
							</Button>
						)}
					</>
				}
			/>

			<Toolbar label="Search and filter clips" className="collection-toolbar">
				<SearchField
					label="Search spoken text"
					placeholder="Search spoken text"
					value={filters.search}
					onValueChange={(search) => onFilters({ ...filters, search })}
				/>
				<Select
					width="auto"
					size="md"
					aria-label="Filter clips by project"
					value={filters.project}
					onValueChange={(e) => onFilters({ ...filters, project: e })}
					options={[
						{ value: "", label: "All projects" },
						...(facets.projects.map((p) => ({ value: p.id, label: p.title })) ?? []),
					]}
				/>
				<ToolbarGroup label="Filter clips by source" className="chip-row">
					{sourceFilters.map((f) => (
						<ChipButton
							key={f.value}
							variant="inline"
							on={filters.source === f.value}
							onClick={() => onFilters({ ...filters, source: f.value })}
						>
							{f.label}
						</ChipButton>
					))}
				</ToolbarGroup>
			</Toolbar>

			{phase === "loading" ? (
				<LoadingState label="Loading clips…" />
			) : phase === "failed" ? (
				<ErrorState
					title="Could not load speech"
					message="The server did not answer as expected."
					onRetry={() => void load()}
					retrying={loading}
				/>
			) : phase === "empty" ? (
				/* Names the workspace it is empty for. Most workspaces own nothing,
				   so a correct empty gallery is the ordinary case. */
				<EmptyState
					title={`No speech in ${workspace} yet`}
					label={
						filters.search || filters.project || filters.source !== "all"
							? "Nothing in this workspace matches these filters."
							: "Synthesized clips appear here automatically. Switch workspace to see another's."
					}
				/>
			) : (
				<ul className="spk-list">
					{items.map((clip) => (
						<li key={clip.id} className="spk-row">
							<button
								type="button"
								className="spk-play"
								disabled={!clip.asset_url}
								aria-label={`${sample.isPlaying(clip.id) ? "Stop" : "Play"} clip`}
								onClick={() => clip.asset_url && sample.play(clip.id, clip.asset_url)}
							>
								{sample.isPlaying(clip.id) ? Ic.x(ICON.sm) : Ic.play(ICON.sm)}
							</button>

							<div className="spk-body">
								<p className="spk-text">{clip.prompt || "—"}</p>
								<div className="spk-meta">
									{/* Where it came from — the question a gallery spanning every
									    project has to answer on the row itself. */}
									<span>{clipAttributionOf(clip)}</span>
									{clip.voice ? <span className="spk-dot">{clip.voice}</span> : null}
									{clip.provider ? <span className="spk-dot">{clip.provider}</span> : null}
									<span className="spk-dot spk-dur">{formatClipDuration(clip.duration_sec)}</span>
								</div>
							</div>

							<div className="spk-actions">
								<button
									type="button"
									className={`spk-act${clip.starred ? " on" : ""}`}
									aria-label={clip.starred ? "Unstar clip" : "Star clip"}
									aria-pressed={Boolean(clip.starred)}
									onClick={() => void toggleStar(clip.id)}
								>
									{Ic.zap(ICON.sm)}
								</button>
								<button
									type="button"
									className="spk-act"
									aria-label="Hide clip"
									onClick={() => void hide(clip.id)}
								>
									{Ic.trash(ICON.sm)}
								</button>
							</div>
						</li>
					))}
				</ul>
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
		</Page>
	);
}
