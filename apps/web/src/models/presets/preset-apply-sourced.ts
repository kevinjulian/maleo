/* Seeding a preset by RECORDED SOURCE instead of by guessing from the value.
 *
 * This lives beside `preset-apply.ts` rather than replacing it, so the two can be run
 * on the same fixtures and their disagreements inspected. Swapping the callers is a
 * separate step; until then nothing here is reachable from the app.
 *
 * The old rules decide "did the operator touch this?" by comparing the current value
 * against the code default — per field for settings, and by `JSON.stringify` over the
 * whole object for pacing. Both readings are wrong in a way that
 * loses work:
 *
 *   - a value deliberately set to something that happens to equal the default reads as
 *     untouched, and gets overwritten;
 *   - one touched field in an object-valued axis makes the entire axis read as
 *     touched, so its untouched siblings never get seeded.
 *
 * These rules read the recorded layer instead, which is a fact rather than an
 * inference, and record what they supplied so the next read does not have to infer
 * either.
 */
import {
	entriesOf,
	normalizeProjectSelection,
	type ContentPresetBundle,
	type ProjectSelection,
	type StyleKnobs,
} from "@maleo/shared";
import type { PacingDevices } from "@maleo/shared";
import { DEFAULT_PACING_DEVICES } from "./generation-defaults.ts";
import { presetSettings, type GlobalSettings } from "./creative-settings.ts";
import { AXIS_ELEMENT_PATHS, SETTINGS_ELEMENT_PATHS } from "./element-paths.ts";
import { seedElementValue, overwriteElementValue } from "./element-writes.ts";
import type { ElementSourceMap } from "./element-sources.ts";
import type { PresetTargets } from "./preset-apply.ts";

/** The layer a content preset supplies at. */
const PRESET_LAYER = "project-preset" as const;

export interface SourcedSeedResult {
	targets: PresetTargets;
	sources: ElementSourceMap;
}

export interface PresetMeta {
	/** The preset's id, recorded so a surface can name and open it. */
	id: string;
	name?: string;
	description?: string;
}

/** Seed every axis a preset bundles, filling only what the operator does not own. */
/* Both of these are generic in ONE key so the compiler keeps the pairing the
 * loop erases. `seedElementValue` and `claim` are already generic in the value
 * type, so with `K` fixed they return `GlobalSettings[K]` and the write needs no
 * assertion — the four casts these replace were covering nothing but the loop
 * boundary. */
function seedSourcedField<K extends keyof GlobalSettings>(
	settings: GlobalSettings,
	field: K,
	path: string,
	incomingSettings: Partial<GlobalSettings>,
	sources: ElementSourceMap,
	defaulterId: string,
): ElementSourceMap {
	const incoming = incomingSettings[field];
	if (incoming === undefined) return sources;
	const write = seedElementValue(
		path,
		settings[field],
		incoming,
		sources,
		PRESET_LAYER,
		defaulterId,
	);
	settings[field] = write.value;
	return write.sources;
}

function claimField<K extends keyof GlobalSettings>(
	settings: GlobalSettings,
	field: K,
	path: string,
	incomingSettings: Partial<GlobalSettings>,
	claim: <T>(path: string, value: T) => T,
): void {
	const incoming = incomingSettings[field];
	if (incoming === undefined) return;
	settings[field] = claim(path, incoming);
}

export function seedFromPresetSourced(
	targets: PresetTargets,
	sources: ElementSourceMap,
	bundle: ContentPresetBundle,
	meta: PresetMeta,
): SourcedSeedResult {
	let nextSources = sources;
	const next: PresetTargets = { ...targets };

	// Style: ONE source for the whole knob object. The knobs are authored and applied
	// as a unit, and the preset schema is explicit that a preset is the only place a
	// style is defined — per-knob provenance would contradict that.
	const style = bundle.style ?? null;
	if (style) {
		const write = seedElementValue<StyleKnobs | null>(
			AXIS_ELEMENT_PATHS.config,
			targets.config.style ?? null,
			style,
			nextSources,
			PRESET_LAYER,
			meta.id,
		);
		nextSources = write.sources;
		next.config =
			write.value === (targets.config.style ?? null)
				? targets.config
				: {
						...targets.config,
						style: write.value,
						styleName: meta.name,
						styleDescription: meta.description,
					};
	}

	// Project references: the generation lock. A bundle saved before the flattening
	// still carries the four-bucket shape, so it is normalised rather than trusted.
	const incomingRefs = normalizeProjectSelection(bundle.projectRefs);
	if (incomingRefs.prompt.trim() || incomingRefs.entityIds.length) {
		const write = seedElementValue<ProjectSelection>(
			AXIS_ELEMENT_PATHS.projectReferences,
			targets.projectReferences,
			incomingRefs,
			nextSources,
			PRESET_LAYER,
			meta.id,
		);
		nextSources = write.sources;
		next.projectReferences = write.value;
	}

	// Settings: PER FIELD. This is where the whole-axis freeze used to live — one
	// touched field cannot stop its neighbours being seeded when each carries its own
	// source.
	const incomingSettings = presetSettings(bundle.settings);
	const settings: GlobalSettings = { ...targets.settings };
	for (const [field, path] of entriesOf(SETTINGS_ELEMENT_PATHS)) {
		nextSources = seedSourcedField(settings, field, path, incomingSettings, nextSources, meta.id);
	}
	next.settings = settings;

	// Pacing devices: one source, because it is edited as one control group. Unlike the
	// old rules, a partially-edited axis still receives the fields the operator has not claimed — the merge is over the CURRENT value, so
	// nothing they set is discarded.
	const incomingPacing = bundle.pacingDevices;
	if (Object.keys(incomingPacing).length) {
		const write = seedElementValue<PacingDevices>(
			AXIS_ELEMENT_PATHS.pacingDevices,
			targets.pacingDevices,
			{ ...DEFAULT_PACING_DEVICES, ...incomingPacing },
			nextSources,
			PRESET_LAYER,
			meta.id,
		);
		nextSources = write.sources;
		next.pacingDevices = write.value;
	}

	return { targets: next, sources: nextSources };
}

/** Apply a preset over a project, replacing INHERITED elements only.
 *
 *  The old `applyPresetOverride` replaced every axis unconditionally, because it had
 *  no way to know which values were the operator's. With sources recorded it does, so
 *  a preset swap stops being destructive. `overwriteOperatorEdits` is the explicit
 *  opt-in for the old behaviour, and is never the default. */
export function applyPresetSourced(
	targets: PresetTargets,
	sources: ElementSourceMap,
	bundle: ContentPresetBundle,
	meta: PresetMeta,
	options?: { overwriteOperatorEdits?: boolean },
): SourcedSeedResult {
	if (!options?.overwriteOperatorEdits)
		return seedFromPresetSourced(targets, sources, bundle, meta);

	let nextSources = sources;
	const claim = <T>(path: string, value: T): T => {
		const write = overwriteElementValue(path, value, nextSources, PRESET_LAYER, meta.id);
		nextSources = write.sources;
		return write.value;
	};

	const style = bundle.style ?? null;
	const next: PresetTargets = {
		config: {
			...targets.config,
			style: claim(AXIS_ELEMENT_PATHS.config, style),
			styleName: meta.name,
			styleDescription: meta.description,
		},
		projectReferences: claim(
			AXIS_ELEMENT_PATHS.projectReferences,
			normalizeProjectSelection(bundle.projectRefs),
		),
		settings: { ...targets.settings },
		pacingDevices: claim(AXIS_ELEMENT_PATHS.pacingDevices, {
			...DEFAULT_PACING_DEVICES,
			...bundle.pacingDevices,
		}),
	};

	const incomingSettings = presetSettings(bundle.settings);
	for (const [field, path] of entriesOf(SETTINGS_ELEMENT_PATHS)) {
		claimField(next.settings, field, path, incomingSettings, claim);
	}

	return { targets: next, sources: nextSources };
}

/** What an apply WOULD do, for the confirmation that precedes it: how many inherited
 *  values get replaced, and which elements the operator owns and would keep.
 *
 *  Derived from the same rule the apply uses, rather than a second implementation that
 *  can disagree with it — the dialog and the act must not describe different outcomes. */
/** What applying a preset would do, by element path: which the preset takes
 *  over and which the project keeps. Both sorted, so the preview is stable. */
export interface PresetApplyPreview {
	replaced: string[];
	kept: string[];
}

export function describePresetApply(
	targets: PresetTargets,
	sources: ElementSourceMap,
	bundle: ContentPresetBundle,
	meta: PresetMeta,
): PresetApplyPreview {
	const seeded = seedFromPresetSourced(targets, sources, bundle, meta);
	const forced = applyPresetSourced(targets, sources, bundle, meta, {
		overwriteOperatorEdits: true,
	});

	const replaced: string[] = [];
	const kept: string[] = [];
	for (const path of Object.keys(forced.sources)) {
		if (seeded.sources[path]?.defaulterId === meta.id) replaced.push(path);
		else kept.push(path);
	}
	return { replaced: replaced.sort(), kept: kept.sort() };
}
