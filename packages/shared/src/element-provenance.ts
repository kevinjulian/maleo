/* Where an element's value came from.
 *
 * Internally the platform has one mechanism at several scopes: a DEFAULTER supplies
 * values, an ELEMENT receives them. Content presets, timeline templates, clip
 * templates and motion presets are all defaulters; "defaulter" is an internal term
 * and does not appear in the UI, which names the specific record instead.
 *
 * Provenance used to be inferred rather than stored. Seeding decided "the operator
 * left this untouched" by comparing the current value against the code default, so a
 * deliberate choice that happened to equal that default was silently overwritten;
 * and for object-valued axes it compared the whole object, so touching one field
 * froze the entire axis against future seeding. Neither could answer the question
 * the editor actually needs answered: which defaulter supplied this?
 *
 * So the layer is recorded, and everything else is derived from it.
 */

/** The layers, weakest first. Order IS the ranking — `outranks` reads this array,
 *  so there is no second place where precedence is written down. */
export const ELEMENT_LAYERS = [
	/** Shipped constants: the value a field has when nothing has been chosen. */
	"code-default",
	/** The workspace's default preset. */
	"workspace-default",
	/** The preset selected for this project. */
	"project-preset",
	/** The render-scope defaulter (a timeline template) the project points at. */
	"render-template",
	/** A person chose this. Always wins. */
	"operator",
] as const;

export type ElementLayer = (typeof ELEMENT_LAYERS)[number];

export const OPERATOR_LAYER: ElementLayer = "operator";

/** What is stored per element. `overridden` is deliberately absent: it is
 *  `layer === "operator"`, and two fields that must agree is exactly the failure
 *  this replaces. */
export interface ElementSource {
	layer: ElementLayer;
	/** Which defaulter supplied it. Null for operator edits and code defaults —
	 *  neither has a record to point at. */
	defaulterId: string | null;
}

function rankOf(layer: ElementLayer): number {
	return ELEMENT_LAYERS.indexOf(layer);
}

/** True when `layer` is stronger than `other`. The one precedence comparison. */
export function outranks(layer: ElementLayer, other: ElementLayer): boolean {
	return rankOf(layer) > rankOf(other);
}

/** An element is overridden when a person set it.
 *
 *  An ABSENT source counts as operator-owned. Projects persisted before provenance
 *  existed carry no sources, and the two failure directions are not symmetric:
 *  treating them as inherited lets the first preset applied after the upgrade wipe
 *  work that was already done, while treating them as owned only means they
 *  re-inherit less until someone reverts — visible, and recoverable. */
export function isOverridden(source: ElementSource | null | undefined): boolean {
	return !source || source.layer === OPERATOR_LAYER;
}

/** Whether a defaulter at `seedingLayer` may fill this element.
 *
 *  Equal layers ARE seedable, so re-applying the same defaulter refreshes what it
 *  supplied rather than silently doing nothing. Operator-owned elements never are;
 *  overwriting those is a separate, explicitly opted-in operation. */
export function seedableFrom(
	source: ElementSource | null | undefined,
	seedingLayer: ElementLayer,
): boolean {
	if (isOverridden(source)) return false;
	return !outranks(source!.layer, seedingLayer);
}

/** The source to record when a person edits an element. */
export function operatorSource(): ElementSource {
	return { layer: OPERATOR_LAYER, defaulterId: null };
}

/** The source to record when a defaulter supplies an element. */
export function defaulterSource(layer: ElementLayer, defaulterId: string | null): ElementSource {
	return { layer, defaulterId };
}
