/* The provenance model behind the panels: what a group header says about where its
 * values came from, and which default actions an element offers.
 *
 * A group names its default ONCE in the header. When its inherited elements disagree
 * about their supplier the header says "Multiple defaults" rather than picking one.
 */
import { isOverridden, type ElementSource } from "@maleo/shared";
import { PANEL_COPY } from "./panel-copy.ts";

/** What supplies a group's inherited elements, and how much of it the project owns. */
export interface GroupSource {
	/** `inherited` — one known default supplies every inherited element.
	 *  `multiple` — inherited elements disagree, so rows carry their own source.
	 *  `none` — nothing in the group is inherited, so no default speaks for it. */
	kind: "inherited" | "multiple" | "none";
	/** The header's source chip. Empty for `none`, which renders no chip at all. */
	label: string;
	/** Set only when one default supplies the group AND it resolves, so it is openable.
	 *  An id whose record has since been deleted deliberately leaves this unset: naming
	 *  a default the operator cannot open is the one thing the library rule forbids. */
	defaulterId?: string;
	/** How many of the group's elements the project owns. */
	changed: number;
	/** How many elements the group covers. */
	total: number;
}

/** The actions an element offers, in the order the detail view lists them. */
export type RowAction =
	| "change"
	| "use-default"
	| "reset-to-shipped"
	| "update-default"
	| "save-as-custom-default";

/** Summarise what supplies a group, for its header.
 *
 *  Returns null when the group covers nothing addressable — Providers holds workspace
 *  pickers no default supplies — so the caller renders no chip rather than an empty one. */
export function summariseGroupSource(
	paths: readonly string[],
	sourceOf: (path: string) => ElementSource | undefined,
	defaulterName: (id: string | null) => string | undefined,
): GroupSource | null {
	if (!paths.length) return null;

	const sources = paths.map((path) => sourceOf(path));
	const changed = sources.filter((source) => isOverridden(source)).length;
	const total = paths.length;

	// Nothing is inherited, so there is no supplier to name. The changed count is the
	// whole story and the header renders only that.
	if (changed === total) return { kind: "none", label: "", changed, total };

	const inheritedIds = new Set(
		sources.filter((source) => !isOverridden(source)).map((source) => source?.defaulterId ?? null),
	);
	if (inheritedIds.size > 1)
		return { kind: "multiple", label: PANEL_COPY.multipleDefaults, changed, total };

	const only = [...inheritedIds][0] ?? null;
	const name = only ? defaulterName(only) : undefined;
	// An id that no longer resolves gets the generic word rather than an invented name,
	// and stays unopenable, because there is nothing left to open.
	if (!name) return { kind: "inherited", label: PANEL_COPY.inherited, changed, total };
	return { kind: "inherited", label: name, defaulterId: only ?? undefined, changed, total };
}

/** What a row lets the operator do.
 *
 *  Change is always offered — an inherited element is editable, that is the point of a
 *  default. The rest depend on there being something to give back or write into, and on
 *  the host having wired the handler at all. */
export function rowActions(input: {
	changed: boolean;
	/** The default this element goes back to, when one is known. */
	sourceName?: string;
	/** That default ships in code, so a write-back has to fork it into a copy. */
	builtinSource?: boolean;
	canHandBack?: boolean;
	canWriteBack?: boolean;
}): RowAction[] {
	const actions: RowAction[] = ["change"];
	if (!input.changed) return actions;
	if (input.canHandBack) actions.push(input.sourceName ? "use-default" : "reset-to-shipped");
	if (input.canWriteBack)
		actions.push(input.builtinSource ? "save-as-custom-default" : "update-default");
	return actions;
}

/** Which write an action performs.
 *
 *  The two hand-back labels are one act with two promises, and the two write-back labels
 *  are one act with two outcomes — the fork happens inside the push planner, not here. So
 *  four labels collapse to two calls, and this is where that collapse is stated once
 *  rather than in each panel's switch. */
export function actionTarget(action: RowAction): "hand-back" | "write-back" | "none" {
	if (action === "use-default" || action === "reset-to-shipped") return "hand-back";
	if (action === "update-default" || action === "save-as-custom-default") return "write-back";
	return "none";
}

/** The visible word for an action. */
export function actionLabel(action: RowAction): string {
	switch (action) {
		case "change":
			return PANEL_COPY.change;
		case "use-default":
			return PANEL_COPY.useDefault;
		case "reset-to-shipped":
			return PANEL_COPY.resetToShipped;
		case "update-default":
			return PANEL_COPY.updateDefault;
		case "save-as-custom-default":
			return PANEL_COPY.saveAsCustomDefault;
	}
}
