/* Maleo — the project's aspect ratio, and the one write that changes it.
 *
 * The value is stored twice on purpose: `settings.aspectRatio` is the editor's
 * creative state, and `config.format` is what the render reads. They must move
 * together, which is the whole reason this is one function rather than two
 * setters at the call site. Choosing a ratio also closes the picker. */
import type { Dispatch, SetStateAction } from "react";
import type { Config } from "@maleo/shared";
import type { GlobalSettings } from "@models/presets/creative-settings.ts";
import { VIDEO_ASPECTS } from "@models/timeline/timeline-editor-model.ts";
import type { ElementSourceMap } from "@models/presets/element-sources.ts";
import { recordSettingsEdits } from "@models/presets/element-writes.ts";
import { SETTINGS_ELEMENT_PATHS } from "@models/presets/element-paths.ts";

export interface AspectRatioControl {
	currentAspect: string;
	aspectOptions: typeof VIDEO_ASPECTS;
	setAspectRatio: (format: string) => void;
}

export function useAspectRatio(args: {
	settings: GlobalSettings;
	setSettings: Dispatch<SetStateAction<GlobalSettings>>;
	config: Config;
	setConfig: Dispatch<SetStateAction<Config>>;
	setAspectOpen: (open: boolean) => void;
	setElementSources: Dispatch<SetStateAction<ElementSourceMap>>;
}): AspectRatioControl {
	const { settings, setSettings, config, setConfig, setAspectOpen, setElementSources } = args;

	const setAspectRatio = (format: string): void => {
		setElementSources((sources) =>
			recordSettingsEdits(
				settings,
				{ ...settings, aspectRatio: format },
				SETTINGS_ELEMENT_PATHS,
				sources,
			),
		);
		setSettings((prev) => ({ ...prev, aspectRatio: format }));
		setConfig((prev) => ({ ...prev, format }));
		setAspectOpen(false);
	};

	return {
		currentAspect: settings.aspectRatio || config.format || "9:16",
		aspectOptions: VIDEO_ASPECTS,
		setAspectRatio,
	};
}
