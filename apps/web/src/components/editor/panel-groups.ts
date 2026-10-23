/* The settings panel's product-domain groups, and the elements each one covers.
 *
 * These are UI domains, not provenance scopes. Provenance still appears inside a group
 * — the header names the default that supplied it — but the grouping answers "where is
 * the kind of value I care about?" first, because that is the question an operator asks
 * before they ask which default supplied it.
 *
 * The taxonomy lives here rather than inline in the panel so a group's membership is one
 * declaration instead of a `paths=` prop repeated at every call site. A group's `paths`
 * is what the header summarises and what its group-level actions act on; a group that
 * covers nothing addressable — Creative direction is stored on the project alone —
 * declares none and gets no header source.
 */
import { AXIS_ELEMENT_PATHS, SETTINGS_ELEMENT_PATHS } from "@models/presets/element-paths.ts";

export type PanelGroupId = "direction" | "style-reference" | "brand" | "output" | "audio";

export interface PanelGroupDef {
	id: PanelGroupId;
	title: string;
	/** Element paths the group covers. Empty means nothing addressable lives here. */
	paths: readonly string[];
}

/** Free-text creative direction. Stored on the project, not supplied by any default. */
export const DIRECTION_GROUP: PanelGroupDef = {
	id: "direction",
	title: "Creative direction",
	paths: [],
};

/** The global style lock: one reference image whose look applies to every generation. */
export const STYLE_REFERENCE_GROUP: PanelGroupDef = {
	id: "style-reference",
	title: "Style reference",
	paths: [SETTINGS_ELEMENT_PATHS.globalStyleRefId],
};

/* Accent, watermark, canvas and the retention overlays. The overlays sit here because
 * chapter pills and the progress bar are drawn in the brand's accent and read as the
 * reel's identity, not as a separate device. Caption font is not here: captions own it. */
export const BRAND_GROUP: PanelGroupDef = {
	id: "brand",
	title: "Brand",
	paths: [
		SETTINGS_ELEMENT_PATHS.brandAccent,
		SETTINGS_ELEMENT_PATHS.brandLogoUrl,
		SETTINGS_ELEMENT_PATHS.backgroundFill,
		AXIS_ELEMENT_PATHS.pacingDevices,
	],
};

/** What a render is cut to and produced by. */
export const OUTPUT_GROUP: PanelGroupDef = {
	id: "output",
	title: "Output",
	paths: [SETTINGS_ELEMENT_PATHS.aspectRatio, SETTINGS_ELEMENT_PATHS.renderBackend],
};

/** Who narrates and in what language. */
export const AUDIO_GROUP: PanelGroupDef = {
	id: "audio",
	title: "Audio",
	paths: [
		SETTINGS_ELEMENT_PATHS.voiceProvider,
		SETTINGS_ELEMENT_PATHS.voice,
		SETTINGS_ELEMENT_PATHS.language,
	],
};

/** Groups the Style rail renders, in order. */
export const STYLE_PANEL_GROUPS: readonly PanelGroupDef[] = [
	DIRECTION_GROUP,
	STYLE_REFERENCE_GROUP,
	BRAND_GROUP,
];

/** Groups the Project Settings rail renders, in order. */
export const SETTINGS_PANEL_GROUPS: readonly PanelGroupDef[] = [OUTPUT_GROUP, AUDIO_GROUP];

/** Every group, for tests and for anything that needs the whole taxonomy. */
export const ALL_PANEL_GROUPS: readonly PanelGroupDef[] = [
	...STYLE_PANEL_GROUPS,
	...SETTINGS_PANEL_GROUPS,
];
