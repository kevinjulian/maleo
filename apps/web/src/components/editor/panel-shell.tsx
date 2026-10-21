/* Provenance plumbing the Style and Project Settings panels share: what the host says
 * about where values came from, the group header's source summary, and the default
 * actions (hand back, write back) an inline property offers.
 */
import { useState } from "react";
import { type ElementSource } from "@maleo/shared";
import type { PanelGroupDef } from "./panel-groups.ts";
import {
	actionTarget,
	rowActions,
	summariseGroupSource,
	type GroupSource,
	type RowAction,
} from "./panel-rows.ts";

/** What the host tells a panel about where values came from and what can be done with
 *  them. Absent handlers mean the surface has no provenance to show — the create form —
 *  and every control still works, it just says nothing about its source. */
export interface PanelProvenance {
	sourceOf?: (path: string) => ElementSource | undefined;
	defaulterName?: (id: string | null) => string | undefined;
	onOpenDefaulter?: (id: string) => void;
	/** Hand elements back to the cascade. Takes paths so one row and a whole group are
	 *  the same call. */
	onResetSection?: (paths: readonly string[]) => void;
	/** Write the project's values into the default that would otherwise supply them. */
	onPushSection?: (paths: readonly string[]) => void;
	/** The default a hand-back returns to, when the project is on one AND it carries a
	 *  value for the element in question — see `targetSupplies`. */
	revertTargetName?: string;
	/** That default's id, which the blast-radius detail asks usage about. */
	revertTargetId?: string;
	/** Whether that default is a shipped fixture, which decides whether a write-back
	 *  edits it or copies it. A fixture is read-only, so the write forks first. */
	revertTargetIsFixture?: boolean;
	/** Does the active default actually carry a value for this element?
	 *
	 *  Being on a default is not the same as that default having an opinion about every
	 *  element: bundles are partial, and the shipped ones carry very little. Where it has
	 *  none, a hand-back restores the shipped value, so the action has to say that instead
	 *  of naming a default that supplies nothing. Absent means "assume it supplies",
	 *  which is the pre-existing behaviour for surfaces that cannot answer. */
	targetSupplies?: (path: string) => boolean;
}

/** Summarise a group's source, or null where the group covers nothing addressable or the
 *  surface tracks no provenance. */
export function groupSourceFor(
	provenance: PanelProvenance,
	group: PanelGroupDef,
): GroupSource | null {
	const { sourceOf, defaulterName } = provenance;
	if (!group.paths.length || !sourceOf || !defaulterName) return null;
	return summariseGroupSource(group.paths, sourceOf, defaulterName);
}

/** Which element's detail is open, and what the open element can do.
 *
 *  Row-level and group-level actions are the same call with a different path list, which
 *  is why the host only ever exposed the list form: one row is a list of one. */
export interface ProvenanceActions {
	openKey: string | null;
	open: (key: string | null) => void;
	/** The default a hand-back returns to for this element, or undefined where it would
	 *  fall back to the shipped value. */
	handBackTargetFor: (path?: string) => string | undefined;
	/** The default a write-back lands in. Always the active one: a push ADDS the field to
	 *  its bundle, so it does not matter whether that bundle carried it before. */
	writeBackTargetName?: string;
	/** That default ships in code, so a write-back copies it. */
	builtinTarget: boolean;
	/** Preset id whose blast radius the detail states, when the write edits it in place. */
	usagePresetId?: string;
	actionsFor: (changed: boolean, path?: string) => RowAction[];
	runAction: (paths: readonly string[]) => (action: RowAction) => void;
}

export function useProvenanceActions(provenance: PanelProvenance): ProvenanceActions {
	const [openKey, setOpenKey] = useState<string | null>(null);
	/* Supplied by the caller, which holds the preset row. A shipped preset used to be
	   recognisable from its id; fixtures are ordinary rows now, so only the row knows. */
	const builtinTarget = provenance.revertTargetIsFixture ?? false;
	/* Naming the active default is only honest where it carries a value for THIS element.
	   The shipped presets carry two settings fields between them, so most elements on a
	   built-in would otherwise offer "Use default" against a bundle with no opinion, and
	   the write would reset to shipped code instead. */
	const handBackTargetFor = (path?: string): string | undefined => {
		if (!provenance.revertTargetName) return undefined;
		if (!provenance.targetSupplies) return provenance.revertTargetName;
		return path && provenance.targetSupplies(path) ? provenance.revertTargetName : undefined;
	};
	return {
		openKey,
		open: setOpenKey,
		handBackTargetFor,
		writeBackTargetName: provenance.revertTargetName,
		builtinTarget,
		usagePresetId: builtinTarget ? undefined : provenance.revertTargetId,
		actionsFor: (changed, path) =>
			rowActions({
				changed,
				sourceName: handBackTargetFor(path),
				builtinSource: builtinTarget,
				canHandBack: Boolean(provenance.onResetSection),
				canWriteBack: Boolean(provenance.onPushSection),
			}),
		runAction: (paths) => (action) => {
			const target = actionTarget(action);
			if (target === "hand-back") provenance.onResetSection?.(paths);
			if (target === "write-back") provenance.onPushSection?.(paths);
		},
	};
}
