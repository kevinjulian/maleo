/* Maleo — load a saved content project by id on mount / id change. Owns only
 * the fetch + parse + lifecycle guard; the caller supplies `apply` to fan the
 * parsed shape out into its own setters. Split out of CreateContent to keep the
 * container free of fetch bodies. */
import { useEffect, useRef } from "react";
import { get } from "@api/client.ts";
import { errMsg } from "@models/core/cc-helpers.ts";
import {
	parseLoadedProject,
	type LoadedProjectDetail,
	type ParsedProject,
} from "@models/storyboard/parse-loaded-project.ts";

export function useProjectLoad(input: {
	initialProjectId: string | undefined;
	onStart: () => void;
	apply: (parsed: ParsedProject) => void;
	persistIdentityRepair?: (parsed: ParsedProject) => Promise<void>;
	onError: (message: string) => void;
}): void {
	const { initialProjectId } = input;
	// Latest-value refs so the effect keeps a single [initialProjectId] dependency
	// (matching the original) without going stale on the caller's closures.
	const startRef = useRef(input.onStart);
	const applyRef = useRef(input.apply);
	const errorRef = useRef(input.onError);
	const repairRef = useRef(input.persistIdentityRepair);
	startRef.current = input.onStart;
	applyRef.current = input.apply;
	errorRef.current = input.onError;
	repairRef.current = input.persistIdentityRepair;
	useEffect(() => {
		if (!initialProjectId) return;
		let alive = true;
		startRef.current();
		void get<LoadedProjectDetail>(`/api/operations/projects/${initialProjectId}`)
			.then(async (detail) => {
				if (!alive) return;
				const parsed = parseLoadedProject(detail);
				if (parsed.entityKeysRepaired && repairRef.current) await repairRef.current(parsed);
				if (alive) applyRef.current(parsed);
			})
			.catch((err) => {
				if (!alive) return;
				errorRef.current(`Could not load content: ${errMsg(err)}`);
			});
		return () => {
			alive = false;
		};
	}, [initialProjectId]);
}
