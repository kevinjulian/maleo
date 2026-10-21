import { useCallback, useEffect, useRef, useState } from "react";
import { fetchVideoJobs, retryVideoRender, type VideoJobsPage } from "@api/video-jobs.ts";
import { isJobActive } from "@models/video/render-job.ts";
import {
	EXPORT_PAGE_SIZE,
	exportFilters,
	exportQuery,
	type ExportFilters,
} from "@models/video/export-filters.ts";
import { useActiveWorkspace } from "@hooks/workspace/use-active-workspace.ts";

export function useVideoRender() {
	const workspace = useActiveWorkspace();
	const [filters, setFilters] = useState(() => exportFilters(window.location.search));
	const [page, setPage] = useState<{ key: string; data: VideoJobsPage } | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [revision, setRevision] = useState(0);
	const previousWorkspace = useRef(workspace);
	const query = exportQuery(filters, workspace).toString();
	const currentQuery = useRef(query);
	currentQuery.current = query;
	const refresh = useCallback(() => {
		setActionError(null);
		setRevision((v) => v + 1);
	}, []);
	const applyFilters = (patch: Partial<ExportFilters>) => {
		const next = { ...filters, offset: 0, ...patch };
		setFilters(next);
		window.history.replaceState(window.history.state, "", `/video?${exportQuery(next, workspace)}`);
	};
	useEffect(() => {
		const back = () => setFilters(exportFilters(window.location.search));
		window.addEventListener("popstate", back);
		return () => window.removeEventListener("popstate", back);
	}, []);
	useEffect(() => {
		if (previousWorkspace.current !== workspace) {
			previousWorkspace.current = workspace;
			setFilters((f) => {
				const next = { ...f, offset: 0, project: "" };
				window.history.replaceState(
					window.history.state,
					"",
					`/video?${exportQuery(next, workspace)}`,
				);
				return next;
			});
		}
	}, [workspace]);
	useEffect(() => {
		setActionError(null);
		let alive = true;
		let busy = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const load = async () => {
			if (busy) return;
			busy = true;
			if (timer) clearTimeout(timer);
			setLoading(true);
			try {
				const result = await fetchVideoJobs(
					new URLSearchParams(`${query}&limit=${EXPORT_PAGE_SIZE}`),
				);
				if (!alive) return;
				setPage({ key: query, data: result });
				setError(null);
				if (result.items.some(isJobActive)) timer = setTimeout(() => void load(), 2000);
			} catch (err) {
				if (!alive) return;
				setError(err instanceof Error ? err.message : String(err));
				timer = setTimeout(() => void load(), 4000);
			} finally {
				busy = false;
				if (alive) setLoading(false);
			}
		};
		void load();
		const focus = () => void load();
		window.addEventListener("focus", focus);
		return () => {
			alive = false;
			if (timer) clearTimeout(timer);
			window.removeEventListener("focus", focus);
		};
	}, [query, revision]);
	const retryJob = async (id: string, refreshImages = false) => {
		const started = query;
		try {
			await retryVideoRender(id, refreshImages ? "force=1&refresh_images=1" : "force=1");
			if (currentQuery.current === started) refresh();
		} catch (err) {
			if (currentQuery.current === started)
				setActionError(
					`Could not retry export. ${err instanceof Error ? err.message : String(err)}`,
				);
		}
	};
	const data = page?.key === query ? page.data : null;
	return {
		workspace,
		filters,
		applyFilters,
		jobs: data?.items ?? [],
		total: data?.total ?? 0,
		projects: data?.projects ?? [],
		hasMore: data?.has_more ?? false,
		nextOffset: data?.next_offset,
		loading,
		error: actionError ?? error,
		retryJob,
		refresh,
	};
}
