/* Materials and Video Template on the create form.
 *
 * Picking a Project Preset auto-selects both. Each can then be overridden
 * INDEPENDENTLY — changing the look must not cost you the pacing — and each
 * override can be reset back to what the preset supplies.
 *
 * Overriding here records the operator as the source rather than editing the
 * preset. A create form that wrote back would mean every project started from a
 * preset that the previous project had quietly rewritten.
 */
import type { JSX } from "react";
import {
	EMPTY_MATERIAL_GROUP,
	materialValueFromRecord,
	type ContentPreset,
	type MaterialGroup,
	type MaterialRecord,
	type ProjectMaterials,
	type TimelineTemplate,
} from "@maleo/shared";
import { Ic } from "@design-system/icons/index.tsx";
import { ML } from "@design-system/components/field-label.tsx";
import { Select } from "@design-system/components/select.tsx";
import {
	MATERIAL_GROUP_COPY,
	MATERIAL_GROUP_ORDER,
	materialSummary,
} from "@models/materials/material-vocabulary.ts";
import {
	canResetToPreset,
	materialOrigin,
	materialOriginLabel,
	materialSourceFor,
} from "@models/materials/materials-seed.ts";
import type { ElementSourceMap } from "@models/presets/element-sources.ts";
import { Field } from "@design-system/components/field.tsx";
import { Chip } from "@design-system/components/chip.tsx";

export interface CreateMaterialsProps {
	preset: ContentPreset | null;
	library: readonly MaterialRecord[];
	templates: readonly TimelineTemplate[];
	materials: ProjectMaterials;
	sources: ElementSourceMap;
	videoTemplateId: string;
	disabled?: boolean;
	onOverrideGroup: (group: MaterialGroup, materialId: string | null) => void;
	onResetGroup: (group: MaterialGroup) => void;
	onOverrideTemplate: (id: string) => void;
	onResetTemplate: () => void;
}

/** The Video Template the preset names, so "reset" knows whether it has a target. */
function presetTemplateId(preset: ContentPreset | null): string {
	return (
		preset?.bundle.videoTemplateId ??
		(typeof preset?.bundle.settings?.timelineTemplateId === "string"
			? preset.bundle.settings.timelineTemplateId
			: "")
	);
}

export function CreateMaterials(props: CreateMaterialsProps): JSX.Element {
	const { preset, library, templates, materials, sources, videoTemplateId, disabled } = props;
	const templateFromPreset = presetTemplateId(preset);
	const templateOverridden = Boolean(templateFromPreset) && templateFromPreset !== videoTemplateId;

	return (
		<>
			<Field as="div">
				<div className="cv-field-head">
					<ML flush>Materials</ML>
					<span className="cv-field-tag">What this project generates from</span>
				</div>
				<div className="cv-materials-rows">
					{MATERIAL_GROUP_ORDER.map((group) => {
						const copy = MATERIAL_GROUP_COPY[group];
						const value = materials[group];
						const origin = materialOrigin(value, materialSourceFor(sources, group));
						const options = library.filter((record) => record.group === group);
						const resettable = canResetToPreset(preset, sources, group);
						return (
							<div key={group} className="cv-materials-row">
								<div className="cv-materials-row-head">
									<span className="cv-materials-row-name">
										{Ic[copy.icon](14)} {copy.label}
									</span>
									<Chip>{materialOriginLabel(origin)}</Chip>
									{resettable && (
										<button
											type="button"
											className="cv-textbtn"
											disabled={disabled}
											onClick={() => props.onResetGroup(group)}
										>
											Reset to preset
										</button>
									)}
								</div>
								<Select
									aria-label={`${copy.label} material`}
									value={value.materialId ?? ""}
									disabled={disabled || options.length === 0}
									onValueChange={(e) => props.onOverrideGroup(group, e || null)}
									phoneBreakpoint={860}
									options={[
										{ value: "", label: options.length === 0 ? "No materials in library" : "None" },
										...(options.map((record) => ({ value: record.id, label: record.name })) ?? []),
									]}
								/>
								<span className="cv-materials-row-sum">
									{value.body.trim() || value.assetIds.length > 0
										? materialSummary(value.body, value.assetIds.length)
										: copy.hint}
								</span>
							</div>
						);
					})}
				</div>
			</Field>

			<Field as="div">
				<div className="cv-field-head">
					<ML flush>Video Template</ML>
					{templateOverridden && (
						<button
							type="button"
							className="cv-textbtn"
							disabled={disabled}
							onClick={props.onResetTemplate}
						>
							Reset to preset
						</button>
					)}
				</div>
				<Select
					aria-label="Video Template"
					value={videoTemplateId}
					disabled={disabled || templates.length === 0}
					onValueChange={(e) => props.onOverrideTemplate(e)}
					phoneBreakpoint={860}
					options={[
						{ value: "", label: templates.length === 0 ? "No video templates in library" : "None" },
						...(templates.map((template) => ({ value: template.id, label: template.name })) ?? []),
					]}
				/>
			</Field>
		</>
	);
}

/** The value a group takes when the operator picks a material, or clears one. */
export function materialValueFor(library: readonly MaterialRecord[], materialId: string | null) {
	if (!materialId) return EMPTY_MATERIAL_GROUP;
	const record = library.find((item) => item.id === materialId);
	return record ? materialValueFromRecord(record) : EMPTY_MATERIAL_GROUP;
}
