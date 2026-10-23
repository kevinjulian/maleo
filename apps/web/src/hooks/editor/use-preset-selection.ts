/* Choosing a content preset on the setup screen.
 *
 * Snapshot semantics, deliberately: applying a preset overrides all five axes
 * by value, and removing one resets them to defaults rather than restoring
 * whatever was there before. A preset is a starting point, not a layer.
 *
 * The workspace default is preselected once, so the creation card shows it and
 * its bundle seeds the project. The ref guard is what makes it once: without it
 * a re-render would re-seed and stamp on an edit the operator just made.
 *
 * Split out of `create-content.tsx`.
 */
import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { applyPresetSourced } from "@models/presets/preset-apply-sourced.ts";
import { getDefaultContentPreset } from "@api/presets.ts";
import {
	EMPTY_PROJECT_SELECTION,
	EMPTY_CREATIVE_DIRECTION,
	EMPTY_PROJECT_MATERIALS,
	type ContentPreset,
	type MaterialRecord,
	type ProjectMaterials,
} from "@maleo/shared";
import { DEFAULT_PACING_DEVICES } from "@models/presets/generation-defaults.ts";
import { DEFAULT_SETTINGS } from "@models/presets/creative-settings.ts";
import { clearedMaterialsSeed, seedMaterialsFromPreset } from "@models/materials/materials-seed.ts";
import type { Config, PacingDevices, CreativeDirection } from "@maleo/shared";
import type { GlobalSettings } from "@models/presets/creative-settings.ts";
import type { DocumentWriters } from "@stores/document-writers.ts";
import type { ElementSourceMap } from "@models/presets/element-sources.ts";
import type { selectDerivedArrays } from "@stores/timeline-document-store.ts";

type Derived = ReturnType<typeof selectDerivedArrays>;

export interface PresetSelectionInput {
	config: Config;
	settings: GlobalSettings;
	pacingDevices: PacingDevices;
	projectReferences: NonNullable<Derived["projectReferences"]>;
	setConfig: Dispatch<SetStateAction<Config>>;
	setSettings: Dispatch<SetStateAction<GlobalSettings>>;
	setPacingDevices: Dispatch<SetStateAction<PacingDevices>>;
	setDirection: Dispatch<SetStateAction<CreativeDirection>>;
	setProjectReferences: DocumentWriters["setProjectReferences"];
	setElementSources: Dispatch<SetStateAction<ElementSourceMap>>;
	setActivePresetId: Dispatch<SetStateAction<string>>;
	/* Materials the preset can name. Resolution happens HERE rather than in the
	 * bundle because a preset names material ids and a project stores their
	 * resolved value — a project created three weeks ago must not change what it
	 * generated from when someone edits the library row. */
	materialLibrary: readonly MaterialRecord[];
	/* Whether the material library fetch has SETTLED. An unloaded library and an
	 * empty one are the same value and mean opposite things: resolving a preset's
	 * material ids against an unloaded library resolves every one to nothing, which
	 * seeds an empty project and looks exactly like a preset that names no
	 * materials. The seed waits on this rather than guessing. */
	materialsLoaded: boolean;
	/** The project's materials so far, so a late re-seed can fill only what is
	 *  still unset rather than replacing what the operator has already chosen. */
	materials: ProjectMaterials;
	elementSources: ElementSourceMap;
	setMaterials: Dispatch<SetStateAction<ProjectMaterials>>;
	setVideoTemplateId: Dispatch<SetStateAction<string>>;
}

export interface PresetSelection {
	selectedPreset: ContentPreset | null;
	setSelectedPreset: Dispatch<SetStateAction<ContentPreset | null>>;
	selectPreset: (preset: ContentPreset | null) => void;
}

export function usePresetSelection({
	config,
	settings,
	pacingDevices,
	projectReferences,
	setConfig,
	setSettings,
	setPacingDevices,
	setDirection,
	setProjectReferences,
	setElementSources,
	setActivePresetId,
	materialLibrary,
	materialsLoaded,
	materials,
	elementSources,
	setMaterials,
	setVideoTemplateId,
}: PresetSelectionInput): PresetSelection {
	const [selectedPreset, setSelectedPreset] = useState<ContentPreset | null>(null);
	// Apply a chosen preset (or reset when removed) into the new-project state.
	// Snapshot semantics: applying overrides all five axes by value; removing
	// resets them to defaults. Only the create form mounts this.
	const applyPreset = (preset: ContentPreset | null): void => {
		if (preset) {
			/* Snapshot semantics on the create form, as documented above: picking a preset
			 * here IS the operator saying "start from this", so it claims every axis rather
			 * than filling around earlier edits. That keeps today's behaviour exactly, and
			 * records the preset as the source of what it supplied — which is what lets the
			 * editor's later apply tell inherited from chosen.
			 *
			 * The editor's Change-preset path is the opposite, deliberately: there the
			 * project already has history worth protecting. */
			const next = applyPresetSourced(
				{ config, projectReferences, settings, pacingDevices },
				{},
				preset.bundle,
				{ id: preset.id, name: preset.name, description: preset.description },
				{ overwriteOperatorEdits: true },
			);
			setConfig(next.targets.config);
			setProjectReferences(next.targets.projectReferences);
			setSettings(next.targets.settings);
			setPacingDevices(next.targets.pacingDevices);
			/* Materials and Video Template are what the preset actually IS, so they are
			 * seeded from the same act of picking it. `overwriteOperatorEdits` matches the
			 * snapshot semantics above: picking a preset on the create form claims every
			 * group, and the operator overrides afterwards if they want to. */
			const seed = seedMaterialsFromPreset(
				preset,
				materialLibrary,
				EMPTY_PROJECT_MATERIALS,
				next.sources,
				{ overwriteOperatorEdits: true },
			);
			setMaterials(seed.materials);
			setVideoTemplateId(seed.videoTemplateId);
			setElementSources(seed.sources);
			setActivePresetId(preset.id);
			setDirection(preset.bundle.direction ?? EMPTY_CREATIVE_DIRECTION);
		} else {
			setConfig((c) => ({ ...c, style: undefined }));
			setProjectReferences(EMPTY_PROJECT_SELECTION);
			setSettings(DEFAULT_SETTINGS);
			setPacingDevices(DEFAULT_PACING_DEVICES);
			// Removing the preset resets the axes, so nothing supplies them any more.
			const cleared = clearedMaterialsSeed({});
			setMaterials(cleared.materials);
			setVideoTemplateId(cleared.videoTemplateId);
			setElementSources(cleared.sources);
			setActivePresetId("");
			setDirection(EMPTY_CREATIVE_DIRECTION);
		}
	};
	const selectPreset = (preset: ContentPreset | null): void => {
		setSelectedPreset(preset);
		applyPreset(preset);
	};

	/* Preselect the workspace default preset once, so the creation card shows it
	 * and its bundle seeds the project. This used to ask `screen !== "setup" ||
	 * projectId` — the create form and the editor were one component, so the hook
	 * had to be told which screen was showing and whether a project existed. Only
	 * the form page mounts it now, so both conditions are implied. The ref stays:
	 * it is what makes the seed happen once rather than on every render. */
	const presetSeededRef = useRef(false);
	useEffect(() => {
		/* Wait for the material library. A preset names materials by id, so seeding
		 * before those ids can resolve produces a project with the preset's NAME and
		 * none of its content — the failure is silent, because an unresolved id and a
		 * preset that names nothing seed identically. `loaded` settles on failure too,
		 * so a library that never arrives degrades to seeding without it rather than
		 * blocking create forever. */
		if (!materialsLoaded || presetSeededRef.current) return;
		presetSeededRef.current = true;
		void getDefaultContentPreset()
			.then((preset) => {
				if (preset) selectPreset(preset);
			})
			.catch(() => {
				/* preset preselect is best-effort; never block create */
			});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [materialsLoaded]);

	/* Re-resolve after a late library.
	 *
	 * The gate above covers the default preset, but an operator can pick one from
	 * the modal before the library settles — the preset list is a separate fetch and
	 * can win the race. Re-seeding then fills the groups that resolved to nothing.
	 *
	 * It runs at most once, and WITHOUT `overwriteOperatorEdits`, so a group the
	 * operator has already touched keeps their value: `seedMaterialsFromPreset` only
	 * fills groups that are empty with no recorded source, which is exactly the state
	 * an unresolved id leaves behind. */
	const reseededRef = useRef(false);
	useEffect(() => {
		if (!materialsLoaded || reseededRef.current || !selectedPreset) return;
		reseededRef.current = true;
		const seed = seedMaterialsFromPreset(
			selectedPreset,
			materialLibrary,
			materials,
			elementSources,
		);
		setMaterials(seed.materials);
		setElementSources(seed.sources);
		// Only fill a template the earlier pass could not supply; never overwrite one
		// the operator picked while the library was still in flight.
		setVideoTemplateId((id) => id || seed.videoTemplateId);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [materialsLoaded, selectedPreset]);

	return { selectedPreset, setSelectedPreset, selectPreset };
}
