/* The one place a seedable element's value and its source change together.
 *
 * The sidecar's weakness is drift: the source map is keyed by path, so a write that
 * updates a value without updating its source leaves the map describing something
 * that is no longer true. Two things hold it — a missing source reads as
 * operator-owned, so drift degrades to "shows as yours" rather than "silently
 * overwritten", and every seeded write goes through here.
 *
 * "Through here" is the load-bearing part. These functions take the current value and
 * the current map and return BOTH, so a caller cannot take one and forget the other:
 * the types make the pair the unit of change.
 */
import {
	keysOf,
	entriesOf,
	defaulterSource,
	operatorSource,
	seedableFrom,
	type ElementLayer,
	type ElementSource,
} from "@maleo/shared";
import {
	withSource,
	withSources,
	type ElementSourceMap,
	type RenderOverrides,
} from "./element-sources.ts";
import type { GlobalSettings } from "./creative-settings.ts";
import type { PacingDevices, TemplateParamValue } from "@maleo/shared";

/** A value and the source map that describes it, moving together. */
export interface ElementWrite<T> {
	value: T;
	sources: ElementSourceMap;
}

/** Record a person's edit: take their value, mark the element theirs.
 *
 *  Always applies. An operator edit is never conditional on what supplied the value
 *  before — that is what makes `operator` the top layer. */
export function writeOperatorValue<T>(
	path: string,
	next: T,
	sources: ElementSourceMap,
): ElementWrite<T> {
	return { value: next, sources: withSource(sources, path, operatorSource()) };
}

/** Seed from a defaulter, but only where the element is not the operator's.
 *
 *  Returns the CURRENT value unchanged when the element is not seedable, so a caller
 *  can apply the result unconditionally rather than branching — the branch is here,
 *  once, instead of at every axis. */
export function seedElementValue<T>(
	path: string,
	current: T,
	incoming: T,
	sources: ElementSourceMap,
	layer: ElementLayer,
	defaulterId: string | null,
): ElementWrite<T> {
	if (!seedableFrom(sources[path], layer)) return { value: current, sources };
	return {
		value: incoming,
		sources: withSource(sources, path, defaulterSource(layer, defaulterId)),
	};
}

/** Force a defaulter's value over an operator's, for the explicitly opted-in apply.
 *
 *  Separate from `seedElementValue` on purpose: overwriting someone's edit is a
 *  different act from filling something they never set, and the two should not be one
 *  function with a boolean. A reader of a call site can tell which is happening. */
export function overwriteElementValue<T>(
	path: string,
	incoming: T,
	sources: ElementSourceMap,
	layer: ElementLayer,
	defaulterId: string | null,
): ElementWrite<T> {
	return {
		value: incoming,
		sources: withSource(sources, path, defaulterSource(layer, defaulterId)),
	};
}

/** Revert an element to what a defaulter supplies: take the supplied value and record
 *  that defaulter as its source.
 *
 *  The source is RECORDED, not removed. Removing it looks like the tidy answer — let
 *  resolution decide who supplies it next — but an absent source reads as
 *  operator-owned, so removing it would leave the element unseedable: the exact
 *  opposite of reverting. The caller knows which layer is handing the value over and
 *  has to say so. */
export function revertElementValue<T>(
	path: string,
	supplied: T,
	supplier: ElementSource,
	sources: ElementSourceMap,
): ElementWrite<T> {
	return { value: supplied, sources: withSource(sources, path, supplier) };
}

/** A render-scope element and the overrides that describe it, moving together. */
export interface RenderWrite {
	overrides: RenderOverrides;
}

/** Record a person's edit to a render-scope element: it becomes a project override,
 *  leaving the shared template untouched. */
export function writeRenderOverride(
	field: string,
	value: TemplateParamValue,
	overrides: RenderOverrides,
): RenderWrite {
	return { overrides: { ...overrides, [field]: value } };
}

/** Drop a render-scope override so the element inherits from the template again.
 *
 *  This is also what a successful push-up does locally: once the value lives on the
 *  template, keeping an identical override would report the element as diverged from
 *  a row it now agrees with. */
export function clearRenderOverride(field: string, overrides: RenderOverrides): RenderWrite {
	if (!(field in overrides)) return { overrides };
	const next = { ...overrides };
	delete next[field];
	return { overrides: next };
}

/** Record operator ownership for whichever settings fields actually changed.
 *
 *  Wrapped around the panels' `setSettings` rather than pushed into every control:
 *  the controls are many and spread across two panels, and a control that forgot to
 *  record would leave its element attributed to a preset — so the next apply would
 *  overwrite an edit the confirmation had just promised to keep. Diffing the whole
 *  object at the one place the change passes through cannot forget a field.
 *
 *  Only CHANGED fields are claimed. Re-rendering a panel, or setting a field to the
 *  value it already had, is not an edit and must not silently take ownership of
 *  everything beside it. */
export function recordSettingsEdits<T extends object>(
	previous: T,
	next: T,
	paths: Readonly<Record<keyof T, string>>,
	sources: ElementSourceMap,
): ElementSourceMap {
	const changed: Array<readonly [string, ReturnType<typeof operatorSource>]> = [];
	for (const key of keysOf(paths)) {
		if (previous[key] !== next[key]) changed.push([paths[key], operatorSource()]);
	}
	return withSources(sources, changed);
}

/** Record operator ownership of a whole axis, for the object-valued ones the panels
 *  edit as a single control group. */
export function recordAxisEdit(path: string, sources: ElementSourceMap): ElementSourceMap {
	return withSource(sources, path, operatorSource());
}

/* Handing a section's elements back to whatever supplies them.
 *
 * With an active preset recorded on the project this is a real REVERT: the element goes
 * back to the value that preset supplies, attributed to it. Without one — a project that
 * never had a preset, or one predating the active-preset field — it falls back to the
 * shipped default, which is a reset rather than a revert. The UI names the two
 * differently because they are different promises.
 *
 * Either way the point is the same: the element stops being the operator's, which is
 * what makes it seedable again.
 */
export interface SectionReset {
	settings: GlobalSettings;
	pacingDevices: PacingDevices;
	sources: ElementSourceMap;
}

/** What a supplier carries, for the one question both the reset and the panel ask. */
export interface ResetSupplier {
	id: string;
	settings?: Partial<GlobalSettings>;
	pacingDevices?: Partial<PacingDevices>;
}

/** Does this supplier actually carry a value for this element?
 *
 *  A preset's bundle is PARTIAL — the shipped ones carry two settings fields between them
 *  — so being on a preset does not mean it has an opinion about every element. Where it
 *  has none, a hand-back restores the shipped default and records code-default, which is a
 *  different promise from reverting to a named preset.
 *
 *  The reset below and the panel's action label both read this, deliberately. When they
 *  each decided for themselves, the panel offered "Use default" against a preset that
 *  supplied nothing and the write quietly reset to shipped code instead. */
export function supplierSuppliesPath(input: {
	path: string;
	settingsPaths: Readonly<Record<keyof GlobalSettings, string>>;
	axisPaths: { pacingDevices: string };
	supplier: ResetSupplier | null | undefined;
}): boolean {
	const { supplier } = input;
	if (!supplier) return false;
	const field = entriesOf(input.settingsPaths).find(([, path]) => path === input.path)?.[0];
	if (field) return supplier.settings?.[field] !== undefined;
	if (input.path === input.axisPaths.pacingDevices)
		return Boolean(supplier.pacingDevices && Object.keys(supplier.pacingDevices).length);
	return false;
}

/* Writing through a computed key.
 *
 * `settings[field] = value` does not type-check when `field` is the whole
 * `keyof GlobalSettings` union: the compiler sees a value that could belong to
 * any field being written to a slot that accepts only one, which is genuinely
 * unsound in general. That is what the assertions here used to paper over.
 *
 * It is only unsound because the LOOP erases the correlation. Inside a function
 * generic in one key, `source[key]` and `target[key]` are both
 * `GlobalSettings[K]` and the assignment needs no assertion at all — the
 * compiler carries the pairing the loop threw away. */
function restoreSettingsField<K extends keyof GlobalSettings>(
	target: GlobalSettings,
	key: K,
	source: Partial<GlobalSettings>,
): void {
	const value = source[key];
	if (value !== undefined) target[key] = value;
}

export function resetSectionToDefaults(input: {
	paths: readonly string[];
	settings: GlobalSettings;
	pacingDevices: PacingDevices;
	sources: ElementSourceMap;
	settingsPaths: Readonly<Record<keyof GlobalSettings, string>>;
	axisPaths: { pacingDevices: string };
	defaults: {
		settings: GlobalSettings;
		pacingDevices: PacingDevices;
	};
	/** The preset the project is currently on, when it has one. Its values are what a
	 *  revert goes back to; absent, the shipped defaults are. */
	supplier?: {
		id: string;
		settings?: Partial<GlobalSettings>;
		pacingDevices?: Partial<PacingDevices>;
	} | null;
}): SectionReset {
	const settings: GlobalSettings = { ...input.settings };
	let pacingDevices = input.pacingDevices;
	let sources = input.sources;

	const fieldForPath = new Map<string, keyof GlobalSettings>(
		entriesOf(input.settingsPaths).map(([field, path]) => [path, field]),
	);

	const supplier = input.supplier ?? null;
	// A supplier only supplies what its bundle actually carries. Where it says nothing
	// about an element, the shipped default is the honest fallback and the source has to
	// say code-default rather than naming a preset that had no opinion.
	const suppliedSource = (from: boolean) =>
		from && supplier
			? { layer: "project-preset" as const, defaulterId: supplier.id }
			: { layer: "code-default" as const, defaulterId: null };

	for (const path of input.paths) {
		const field = fieldForPath.get(path);
		// One predicate, shared with the panel, so the word the operator read and the write
		// they got cannot disagree.
		const fromSupplier = supplierSuppliesPath({
			path,
			settingsPaths: input.settingsPaths,
			axisPaths: input.axisPaths,
			supplier,
		});
		if (field) {
			restoreSettingsField(
				settings,
				field,
				fromSupplier && supplier?.settings ? supplier.settings : input.defaults.settings,
			);
		} else if (path === input.axisPaths.pacingDevices) {
			pacingDevices = fromSupplier
				? { ...input.defaults.pacingDevices, ...supplier!.pacingDevices }
				: input.defaults.pacingDevices;
		} else {
			// A path this reset does not know how to restore: leave the value alone rather
			// than rewriting a source for something whose value did not change.
			continue;
		}
		// RECORD a source rather than dropping the entry. An absent source reads as
		// operator-owned, so dropping it would leave the element unseedable — the opposite
		// of what handing it back is for.
		sources = withSource(sources, path, suppliedSource(fromSupplier));
	}

	return { settings, pacingDevices, sources };
}

/* Folding a document's persisted presentation over the editor's settings, with
 * provenance kept honest.
 *
 * This runs on EVERY load, not only a version restore: the storyboard carries the
 * presentation it rendered with, and those fields win over the editor state so a
 * restored version opens as it rendered. In the normal case the two agree and nothing
 * changes, so nothing is recorded — the recording is self-limiting by construction.
 *
 * Where they DISAGREE the document wins, and the element is recorded as the operator's.
 * Two reasons. A version restore is an operator act, so attributing the restored value
 * to them is true. And leaving the old source in place would be strictly worse: the map
 * would describe a value the fold has just replaced, so a later preset apply would
 * overwrite what a restore had just brought back, and the section tag would name a
 * defaulter that did not supply the value on screen.
 */
/** Settings and the provenance that goes with them, kept together so a write
 *  can never update one without the other. */
export interface SettingsWithSources {
	settings: GlobalSettings;
	sources: ElementSourceMap;
}

export function foldPresentationOverSettings(input: {
	settings: GlobalSettings;
	fold: (settings: GlobalSettings) => GlobalSettings;
	sources: ElementSourceMap;
	settingsPaths: Readonly<Record<keyof GlobalSettings, string>>;
}): SettingsWithSources {
	// The fold rule itself lives with the settings type; passed in rather than
	// reimplemented, so the values and the provenance cannot disagree about what changed.
	const settings = input.fold(input.settings);
	return {
		settings,
		sources: recordSettingsEdits(input.settings, settings, input.settingsPaths, input.sources),
	};
}
