/* The setup form: name the project, pick a format, pick a preset, create it.
 *
 * Its own component rather than a branch inside the create page, for the reason
 * the whole split rests on: a hook's mount IS its condition. `usePresetSelection`
 * used to take a `screen` string so it could seed the workspace default only on
 * the setup screen. Nothing here is told which screen is showing — this
 * component only exists once a type has been chosen, so the seed happens then,
 * and the launcher makes no request for a field it is not showing.
 */
import type { JSX } from "react";
import { useEffect, useState } from "react";
import { Setup } from "./launcher.tsx";
import { CreateMaterials, materialValueFor } from "./create-materials.tsx";
import { useCreativeSettings } from "@hooks/editor/use-creative-settings.ts";
import { usePresetSelection } from "@hooks/editor/use-preset-selection.ts";
import {
	EMPTY_PROJECT_SELECTION,
	EMPTY_PROJECT_MATERIALS,
	operatorSource,
	presetVideoTemplateId,
	type MaterialGroup,
	type ProjectMaterials,
	type TimelineTemplate,
} from "@maleo/shared";
import type { Config, ContentType, ProjectSelection, RefImage, RefsState } from "@maleo/shared";
import type { CreateProjectRequest } from "@hooks/editor/use-create-project.ts";
import { SETTINGS_ELEMENT_PATHS } from "@models/presets/element-paths.ts";
import {
	resetMaterialGroupToPreset,
	selectMaterialGroup,
} from "@models/materials/materials-seed.ts";
import { useMaterialLibrary } from "@components/catalog/preset-material-picker.tsx";
import { listTimelineTemplates } from "@api/templates.ts";

export interface ProjectSetupProps {
	type: ContentType;
	/** The reference pool at creation time; its entity ids become the roster. */
	pool: RefImage[];
	refs: RefsState;
	busy: boolean;
	error: string | null;
	onBack: () => void;
	/** Everything the row needs, assembled once the operator submits. */
	onCreate: (request: CreateProjectRequest) => void;
}

export function ProjectSetup({
	type,
	pool,
	refs,
	busy,
	error,
	onBack,
	onCreate,
}: ProjectSetupProps): JSX.Element {
	const [config, setConfig] = useState<Config>({});
	/* The axes a preset applies. Plain state: `projectReferences` lives on
	 * the timeline document in the editor, but there is no document here — the
	 * value is handed to `createProject`, which seeds one with the row. */
	const {
		settings,
		setSettings,
		direction,
		setDirection,
		pacingDevices,
		setPacingDevices,
		elementSources,
		setElementSources,
		activePresetId,
		setActivePresetId,
	} = useCreativeSettings();
	const [projectReferences, setProjectReferences] =
		useState<ProjectSelection>(EMPTY_PROJECT_SELECTION);
	const [materials, setMaterials] = useState<ProjectMaterials>(EMPTY_PROJECT_MATERIALS);
	const [videoTemplateId, setVideoTemplateId] = useState("");
	const [templates, setTemplates] = useState<TimelineTemplate[]>([]);
	const { materials: library, loaded: materialsLoaded } = useMaterialLibrary();

	useEffect(() => {
		let alive = true;
		void listTimelineTemplates()
			.then((list) => {
				if (alive) setTemplates(list);
			})
			.catch(() => {
				/* templates are optional */
			});
		return () => {
			alive = false;
		};
	}, []);

	const { selectedPreset, selectPreset } = usePresetSelection({
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
		materialLibrary: library,
		materialsLoaded,
		materials,
		elementSources,
		setMaterials,
		setVideoTemplateId,
	});

	/* Overriding a group is the operator choosing, so it records as theirs — which
	 * is what makes "Reset to preset" offerable, and what stops a later preset
	 * apply from silently replacing a deliberate choice. */
	const overrideGroup = (group: MaterialGroup, materialId: string | null): void => {
		// A selection, not a hand edit: it records WHICH material, so the badge can
		// tell a faithful copy from one the operator has since changed.
		const next = selectMaterialGroup(
			materials,
			elementSources,
			group,
			materialValueFor(library, materialId),
		);
		setMaterials(next.materials);
		setElementSources(next.sources);
	};

	const resetGroup = (group: MaterialGroup): void => {
		if (!selectedPreset) return;
		const next = resetMaterialGroupToPreset(
			selectedPreset,
			library,
			materials,
			elementSources,
			group,
		);
		setMaterials(next.materials);
		setElementSources(next.sources);
	};

	const submit = (cfg: Config): void => {
		const title = cfg.title?.trim();
		if (!title) return;
		const nextConfig = { ...cfg, title, brief: "" };
		setConfig(nextConfig);
		// The chosen format seeds the global aspect ratio, so the editor opens at
		// the shape the operator picked rather than the settings default.
		const formatChosen = type === "video" && Boolean(nextConfig.format);
		const settingsForCreate = formatChosen
			? { ...settings, aspectRatio: nextConfig.format! }
			: settings;
		/* Picking the format is the operator choosing, not a preset supplying — so the
		 * aspect ratio records as theirs. Leaving it attributed to the preset would let a
		 * later preset apply overwrite the shape they deliberately picked here, which is
		 * exactly the bug this provenance work exists to remove. */
		const sourcesForCreate = formatChosen
			? { ...elementSources, [SETTINGS_ELEMENT_PATHS.aspectRatio]: operatorSource() }
			: elementSources;
		onCreate({
			type,
			config: nextConfig,
			title,
			refs,
			pool,
			settings: settingsForCreate,
			direction,
			projectReferences,
			pacingDevices,
			materials,
			videoTemplateId,
			elementSources: sourcesForCreate,
			activePresetId,
		});
	};

	return (
		<Setup
			type={type}
			onBack={onBack}
			onGenerate={submit}
			busy={busy}
			error={error}
			selectedPreset={selectedPreset}
			onSelectPreset={selectPreset}
			materialsSlot={
				<CreateMaterials
					preset={selectedPreset}
					library={library}
					templates={templates}
					materials={materials}
					sources={elementSources}
					videoTemplateId={videoTemplateId}
					disabled={busy}
					onOverrideGroup={overrideGroup}
					onResetGroup={resetGroup}
					onOverrideTemplate={setVideoTemplateId}
					onResetTemplate={() =>
						setVideoTemplateId(
							selectedPreset ? (presetVideoTemplateId(selectedPreset.bundle) ?? "") : "",
						)
					}
				/>
			}
		/>
	);
}
