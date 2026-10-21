/* The project's creative choices, as one value.
 *
 * Seven pieces of state that are only ever read and written together: the global
 * settings (aspect, style ref, voice, background fill), the creative direction,
 * the A/B hook takes, the retention devices, and the infographic panel style.
 * They are what a preset writes, what the timeline's Style and Project panels
 * edit, and what a reload has to restore — so they hydrate in one call rather
 * than five, and reach the editor as one prop rather than ten.
 *
 * Where each is persisted is NOT uniform, and this hook does not hide that:
 * settings, direction and hook takes live in `editor_state_json`; pacing devices
 * and the infographic style live in `storyboard_json`. `use-content-persistence.ts`
 * still decides that split — this hook only owns the values.
 *
 * Provenance belongs here for the same reason the rest does: a preset writes it, a
 * reload has to restore it, and it is read and written with the values it describes.
 * It also has to survive a round-trip even before anything mutates it, because the
 * editor-state save replaces its blob wholesale — a save that omitted the sources
 * would delete them from disk.
 */
import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { CreativeDirection, InfographicStyle, PacingDevices } from "@maleo/shared";
import { EMPTY_CREATIVE_DIRECTION } from "@maleo/shared";
import type { HookVariant } from "@models/content/content-types.ts";
import {
	DEFAULT_INFOGRAPHIC_STYLE,
	DEFAULT_PACING_DEVICES,
} from "@models/presets/generation-defaults.ts";
import { DEFAULT_SETTINGS, type GlobalSettings } from "@models/presets/creative-settings.ts";
import type { ElementSourceMap, RenderOverrides } from "@models/presets/element-sources.ts";

/** The values a loaded project restores. */
export interface CreativeSettingsValues {
	settings: GlobalSettings;
	direction: CreativeDirection;
	hookVariants: HookVariant[];
	pacingDevices: PacingDevices;
	infographicStyle: InfographicStyle;
	/** Which layer supplied each element. Empty for a project that predates
	 *  provenance, which reads as operator-owned everywhere. */
	elementSources: ElementSourceMap;
	/** This project's own values for render-scope elements. */
	renderOverrides: RenderOverrides;
	/** The preset the project is on, or "" for none. */
	activePresetId: string;
}

export interface CreativeSettings extends CreativeSettingsValues {
	setSettings: Dispatch<SetStateAction<GlobalSettings>>;
	setDirection: Dispatch<SetStateAction<CreativeDirection>>;
	setHookVariants: Dispatch<SetStateAction<HookVariant[]>>;
	setPacingDevices: Dispatch<SetStateAction<PacingDevices>>;
	setInfographicStyle: Dispatch<SetStateAction<InfographicStyle>>;
	setElementSources: Dispatch<SetStateAction<ElementSourceMap>>;
	setRenderOverrides: Dispatch<SetStateAction<RenderOverrides>>;
	setActivePresetId: Dispatch<SetStateAction<string>>;
	/** Restore all of them from a loaded project, in one call. */
	hydrate: (next: CreativeSettingsValues) => void;
}

export function useCreativeSettings(): CreativeSettings {
	const [settings, setSettings] = useState<GlobalSettings>(DEFAULT_SETTINGS);
	const [direction, setDirection] = useState<CreativeDirection>(EMPTY_CREATIVE_DIRECTION);
	const [hookVariants, setHookVariants] = useState<HookVariant[]>([]);
	const [pacingDevices, setPacingDevices] = useState<PacingDevices>(DEFAULT_PACING_DEVICES);
	const [infographicStyle, setInfographicStyle] =
		useState<InfographicStyle>(DEFAULT_INFOGRAPHIC_STYLE);
	const [elementSources, setElementSources] = useState<ElementSourceMap>({});
	const [renderOverrides, setRenderOverrides] = useState<RenderOverrides>({});
	const [activePresetId, setActivePresetId] = useState<string>("");

	return {
		settings,
		setSettings,
		direction,
		setDirection,
		hookVariants,
		setHookVariants,
		pacingDevices,
		setPacingDevices,
		infographicStyle,
		setInfographicStyle,
		elementSources,
		setElementSources,
		renderOverrides,
		setRenderOverrides,
		activePresetId,
		setActivePresetId,
		hydrate: (next: CreativeSettingsValues): void => {
			setSettings(next.settings);
			setDirection(next.direction);
			setHookVariants(next.hookVariants);
			setPacingDevices(next.pacingDevices);
			setInfographicStyle(next.infographicStyle);
			setElementSources(next.elementSources);
			setRenderOverrides(next.renderOverrides);
			setActivePresetId(next.activePresetId);
		},
	};
}
