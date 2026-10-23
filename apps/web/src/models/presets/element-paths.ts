/* The addressable elements a defaulter can supply, as stable dotted paths.
 *
 * Source records live in ONE sidecar map keyed by these paths, rather than inline
 * beside each value. The values themselves are spread across three persisted blobs
 * with three different writers and lifecycles — `brief_json` (style), the
 * schemaVersion-2 `storyboard_json` (references, pacing), and
 * `editor_state_json` (settings, direction) — so inlining would mean changing all
 * three schemas, including a strict shared wire type, and making every existing
 * reader of e.g. `settings.aspectRatio` unwrap a wrapper object.
 *
 * The cost of a sidecar is that it can drift from the values it describes. Two things
 * hold it: every seeded write goes through one helper that updates value and source
 * together, and a missing key reads as operator-owned, so drift degrades to "shows as
 * yours" rather than "silently overwritten".
 *
 * The `satisfies` clauses below are the anti-drift mechanism. Each map is checked
 * against the keys of the type it describes, so renaming a field in `GlobalSettings`
 * fails typecheck here instead of leaving an orphaned path string that quietly
 * addresses nothing.
 */
import type { GlobalSettings } from "./creative-settings.ts";
import type { PresetTargets } from "./preset-apply.ts";

/** Per-field paths for the settings axis. Keyed by field so a rename cannot leave a
 *  stale string behind: the `satisfies` requires every key to exist on
 *  `GlobalSettings`, and `Record<keyof GlobalSettings, ...>` requires every field to
 *  appear. */
export const SETTINGS_ELEMENT_PATHS = {
	aspectRatio: "settings.aspectRatio",
	timelineTemplateId: "settings.timelineTemplateId",
	globalStyleRefId: "settings.globalStyleRefId",
	voiceProvider: "settings.voiceProvider",
	voice: "settings.voice",
	language: "settings.language",
	brandAccent: "settings.brandAccent",
	brandFont: "settings.brandFont",
	brandLogoUrl: "settings.brandLogoUrl",
	backgroundFill: "settings.backgroundFill",
	renderBackend: "settings.renderBackend",
} as const satisfies Record<keyof GlobalSettings, `settings.${string}`>;

/* The object-valued axes carry ONE source each rather than one per leaf.
 *
 * Style is the deliberate case: its ~11 knobs are authored and applied as a single
 * unit, and the preset schema is explicit that a preset is the only place a style is
 * defined — per-knob provenance would assert knobs are independently ownable, which
 * contradicts that. The others follow the same rule because they are edited as one
 * control group. If operators ever ask for partial seeding ("keep my camera
 * intensity, take the rest"), this is the decision to revisit. */
export const AXIS_ELEMENT_PATHS = {
	config: "style",
	projectReferences: "projectReferences",
	settings: "settings",
	pacingDevices: "pacingDevices",
} as const satisfies Record<keyof PresetTargets, string>;

export type SettingsElementPath =
	(typeof SETTINGS_ELEMENT_PATHS)[keyof typeof SETTINGS_ELEMENT_PATHS];
export type AxisElementPath = (typeof AXIS_ELEMENT_PATHS)[keyof typeof AXIS_ELEMENT_PATHS];
export type ElementPath = SettingsElementPath | AxisElementPath;

/** Every path a source map may be keyed by. Order is stable for readable diffs. */
export const ALL_ELEMENT_PATHS: readonly ElementPath[] = [
	...Object.values(AXIS_ELEMENT_PATHS),
	...Object.values(SETTINGS_ELEMENT_PATHS),
];
