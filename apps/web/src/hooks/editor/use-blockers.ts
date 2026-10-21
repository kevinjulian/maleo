/* The project's open blockers, kept current.
 *
 * Re-read whenever a run settles, because that is when a blocker most often
 * appears or clears — and on demand after an answer, because answering is the
 * other thing that changes the set. Never derived from the chat log: reading it
 * from the log is what let a fixed blocker's siblings fall into history. */
import { useCallback, useEffect, useState } from "react";
import {
	getProjectBlockers,
	resolveProjectBlockers,
	type BlockerAnswer,
	type BlockerResolution,
	type BlockerState,
} from "@api/blockers.ts";

export interface Blockers extends BlockerState {
	resolve: (answers: BlockerAnswer[]) => Promise<BlockerResolution | null>;
	refresh: () => void;
}

const EMPTY: BlockerState = { blockers: [], acknowledged: [], batch: null };

export function useBlockers(projectId: string | null, busy: boolean): Blockers {
	const [state, setState] = useState<BlockerState>(EMPTY);

	const refresh = useCallback(() => {
		if (!projectId) {
			setState(EMPTY);
			return;
		}
		void getProjectBlockers(projectId)
			.then((next) => setState(next ?? EMPTY))
			.catch(() => {
				/* a failed read leaves the last known set */
			});
	}, [projectId]);

	// On mount, and every time a run stops being busy — the moment a delivery
	// check or a direction failure has just been written.
	useEffect(() => {
		if (!busy) refresh();
	}, [busy, refresh]);

	const resolve = useCallback(
		async (answers: BlockerAnswer[]): Promise<BlockerResolution | null> => {
			if (!projectId) return null;
			try {
				const result = await resolveProjectBlockers(projectId, answers);
				setState((prev) => ({ ...prev, blockers: result.blockers, batch: null }));
				refresh();
				return result;
			} catch {
				refresh();
				return null;
			}
		},
		[projectId, refresh],
	);

	return { ...state, resolve, refresh };
}
