/* Maleo — Content-First Create · pure content-preset seeding + override.
 *
 * A preset bundles five project axes: style direction, project references
 * (generation lock), settings (GlobalSettings — spans the Style + Settings
 * menus), pacing devices, and data-callout (infographic) style.
 *
 * Two operations:
 *  - seedFromPreset: fill only UNSET axes (creation-time, non-destructive).
 *  - applyPresetOverride: replace ALL axes (editor Change-preset, destructive,
 *    warning-gated).
 *
 * Extracted so the rules are unit-testable without rendering the wizard. */
import {
	keysOf,
	normalizeProjectSelection,
	type ContentPresetBundle,
	type ProjectSelection,
	type StyleKnobs,
} from "@maleo/shared";
import type { Config, PacingDevices, InfographicStyle } from "@maleo/shared";
import { DEFAULT_PACING_DEVICES, DEFAULT_INFOGRAPHIC_STYLE } from "./generation-defaults.ts";
import { DEFAULT_SETTINGS, presetSettings, type GlobalSettings } from "./creative-settings.ts";

export interface PresetTargets {
	config: Config;
	projectReferences: ProjectSelection;
	settings: GlobalSettings;
	pacingDevices: PacingDevices;
	infographicStyle: InfographicStyle;
}

/** The bundle's knobs, or null when it seeds no style. There is nothing to
 *  validate against: a style is whatever the preset says it is. */
function resolveStyle(bundle: ContentPresetBundle): StyleKnobs | null {
	return bundle.style ?? null;
}

/** Seed the style knobs when the project has none yet. */
export function seedConfigStyle(
	config: Config,
	bundle: ContentPresetBundle,
	meta?: { name?: string; description?: string },
): Config {
	const style = resolveStyle(bundle);
	return !config.style && style
		? { ...config, style, styleName: meta?.name, styleDescription: meta?.description }
		: config;
}

/** True when the project reference lock is still empty (nothing selected). */
function projectRefsEmpty(sel: ProjectSelection): boolean {
	return !sel.prompt?.trim() && sel.entityIds.length === 0;
}

/** Seed project references when the operator has not selected any yet. A bundle
 *  saved before the flattening still carries the four-bucket shape, so it is
 *  normalised on read rather than trusted. */
export function seedProjectRefs(
	current: ProjectSelection,
	bundle: ContentPresetBundle,
): ProjectSelection {
	const preset = normalizeProjectSelection(bundle.projectRefs);
	const hasContent = Boolean(preset.prompt.trim()) || preset.entityIds.length > 0;
	return projectRefsEmpty(current) && hasContent ? preset : current;
}

/** Per-field settings seed: take the preset's value only where the current
 *  value still equals the default (i.e. the operator left it untouched). */
/* Generic in ONE key, which is the whole trick.
 *
 * The loop that calls this hands over `keyof GlobalSettings`, and inside a loop
 * body `next[key] = presetSettings[key]` does not type-check: the compiler sees
 * a value that could belong to any field written to a slot accepting only one.
 * That is why this was an assertion. Here `K` is a single parameter, so both
 * sides are `GlobalSettings[K]` and the pairing survives — no assertion needed. */
function seedUntouchedField<K extends keyof GlobalSettings>(
	next: GlobalSettings,
	current: GlobalSettings,
	presetSettings: Partial<GlobalSettings>,
	key: K,
): void {
	const presetValue = presetSettings[key];
	if (presetValue === undefined) return;
	// Only seed a field the operator has not moved off its shipped default.
	if (current[key] === DEFAULT_SETTINGS[key]) next[key] = presetValue;
}

export function seedSettings(
	current: GlobalSettings,
	presetSettings: Partial<GlobalSettings>,
): GlobalSettings {
	const next: GlobalSettings = { ...current };
	for (const key of keysOf(DEFAULT_SETTINGS))
		seedUntouchedField(next, current, presetSettings, key);
	return next;
}

/** Seed pacing devices when still at the default (no retention overlays set). */
function seedPacing(current: PacingDevices, bundle: ContentPresetBundle): PacingDevices {
	const preset = bundle.pacingDevices;
	const isDefault = JSON.stringify(current) === JSON.stringify(DEFAULT_PACING_DEVICES);
	return isDefault && Object.keys(preset).length > 0
		? { ...DEFAULT_PACING_DEVICES, ...preset }
		: current;
}

/** Seed data-callout style when still at the default. */
function seedInfographic(current: InfographicStyle, bundle: ContentPresetBundle): InfographicStyle {
	const preset = bundle.infographicStyle;
	const isDefault = JSON.stringify(current) === JSON.stringify(DEFAULT_INFOGRAPHIC_STYLE);
	return isDefault && Object.keys(preset).length > 0
		? { ...DEFAULT_INFOGRAPHIC_STYLE, ...preset }
		: current;
}

/** Seed every unset axis from a preset bundle (non-destructive). */
export function seedFromPreset(
	targets: PresetTargets,
	bundle: ContentPresetBundle,
	meta?: { name?: string; description?: string },
): PresetTargets {
	return {
		config: seedConfigStyle(targets.config, bundle, meta),
		projectReferences: seedProjectRefs(targets.projectReferences, bundle),
		settings: seedSettings(targets.settings, presetSettings(bundle.settings)),
		pacingDevices: seedPacing(targets.pacingDevices, bundle),
		infographicStyle: seedInfographic(targets.infographicStyle, bundle),
	};
}

/** Destructive apply for the editor's Change-preset flow: replace ALL axes with
 *  the preset's bundle regardless of current values. Gated behind an override
 *  warning in the UI. An unknown style id clears the style. */
export function applyPresetOverride(
	targets: PresetTargets,
	bundle: ContentPresetBundle,
	meta?: { name?: string; description?: string },
): PresetTargets {
	return {
		config: {
			...targets.config,
			style: resolveStyle(bundle),
			styleName: meta?.name,
			styleDescription: meta?.description,
		},
		projectReferences: normalizeProjectSelection(bundle.projectRefs),
		settings: { ...targets.settings, ...presetSettings(bundle.settings) },
		pacingDevices: { ...DEFAULT_PACING_DEVICES, ...bundle.pacingDevices },
		infographicStyle: { ...DEFAULT_INFOGRAPHIC_STYLE, ...bundle.infographicStyle },
	};
}
