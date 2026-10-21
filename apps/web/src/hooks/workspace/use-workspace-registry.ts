/* The registry the switcher lists.
 *
 * Loaded once per mount and refreshed after a create, rather than polled: the
 * set of workspaces changes only when an operator adds one, and the counts it
 * carries are decoration on a menu rather than a live figure.
 *
 * `error` is distinct from an empty list on purpose. Most workspaces own
 * nothing, so "no workspaces" and "could not load workspaces" would otherwise
 * render identically — the same confusion the empty states exist to prevent,
 * one level up. */
import { useCallback, useEffect, useState } from "react";
import { createWorkspace, fetchWorkspaces, type WorkspaceSummary } from "@api/workspaces.ts";

export interface WorkspaceRegistry {
	items: WorkspaceSummary[];
	loading: boolean;
	error: string | null;
	reload: () => Promise<void>;
	create: (name: string) => Promise<WorkspaceSummary>;
}

export function useWorkspaceRegistry(): WorkspaceRegistry {
	const [items, setItems] = useState<WorkspaceSummary[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const reload = useCallback(async () => {
		setLoading(true);
		try {
			setItems((await fetchWorkspaces()).items);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : "could not load workspaces");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void reload();
	}, [reload]);

	const create = useCallback(
		async (name: string) => {
			const { item } = await createWorkspace(name);
			await reload();
			return item;
		},
		[reload],
	);

	return { items, loading, error, reload, create };
}
