/* The .env key table: what is set, what is pending, and writing it back. */
import { useCallback, useEffect, useState } from "react";
import { fetchGlobalKeys, saveGlobalKeys } from "@api/settings.ts";
import {
	hasPendingEdits,
	pendingKeyUpdates,
	type GlobalKeyView,
} from "@models/settings/status-views.ts";

export interface GlobalKeysModel {
	items: GlobalKeyView[] | null;
	edits: Record<string, string>;
	setEdit: (key: string, value: string) => void;
	resetEdits: () => void;
	dirty: boolean;
	busy: boolean;
	savedAt: number | null;
	error: string | null;
	save: () => Promise<void>;
	deleteKey: (key: string) => Promise<void>;
}

export function useGlobalKeys(): GlobalKeysModel {
	const [items, setItems] = useState<GlobalKeyView[] | null>(null);
	const [edits, setEdits] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState(false);
	const [savedAt, setSavedAt] = useState<number | null>(null);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		try {
			const r = await fetchGlobalKeys<GlobalKeyView>();
			setItems(r.items);
			setEdits({});
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const save = useCallback(async () => {
		const updates = pendingKeyUpdates(edits);
		if (Object.keys(updates).length === 0) return;
		setBusy(true);
		setError(null);
		try {
			await saveGlobalKeys(updates);
			setSavedAt(Date.now());
			await load();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}, [edits, load]);

	// Removal is an explicit empty-string write; a blank input means "unchanged".
	const deleteKey = useCallback(
		async (key: string) => {
			if (!confirm(`Delete ${key} from .env?`)) return;
			setBusy(true);
			setError(null);
			try {
				await saveGlobalKeys({ [key]: "" });
				await load();
			} catch (e) {
				setError(e instanceof Error ? e.message : String(e));
			} finally {
				setBusy(false);
			}
		},
		[load],
	);

	return {
		items,
		edits,
		setEdit: (key, value) => setEdits((cur) => ({ ...cur, [key]: value })),
		resetEdits: () => setEdits({}),
		dirty: hasPendingEdits(edits),
		busy,
		savedAt,
		error,
		save,
		deleteKey,
	};
}
