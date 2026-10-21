import { Textarea } from "@design-system/components/input.tsx";
/* The editor's Project Materials drawer.
 *
 * Replaces the Project Refs popover, which showed one of the four things that
 * steer a generation and named it after the storage it lived in. This shows all
 * four — Story, Visual, Voice, Rules — under the names an operator would use.
 *
 * COMPACT FIRST. The drawer opens on a scan view: one row per group, each with a
 * summary and where its value came from. Prompt inputs appear only after a group
 * is opened. The surfaces this replaces already showed every textarea and every
 * asset at once, which is why nobody could find anything in them.
 *
 * Editing here is PROJECT-LOCAL. A group backed by a reusable material does not
 * write back unless the operator explicitly saves it as one, because a project is
 * where you try things and a library row is what other projects depend on.
 */
import { useEffect, useState } from "react";
import type { Dispatch, JSX, SetStateAction } from "react";
import { WRITER_STYLES, oneOf, type RefImage, type WriterStyle } from "@maleo/shared";
import {
	MATERIAL_GROUPS,
	materialRecordFromValue,
	roleOf,
	type ContentPreset,
	type MaterialGroup,
	type MaterialGroupValue,
	type MaterialRecord,
	type ProjectMaterials,
	type ReferenceUse,
	type Role,
} from "@maleo/shared";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { Select } from "@design-system/components/select.tsx";
import {
	MATERIAL_GROUP_COPY,
	MATERIAL_GROUP_ORDER,
	materialSummary,
} from "@models/materials/material-vocabulary.ts";
import {
	canResetToPreset,
	isModifiedFromMaterial,
	materialOrigin,
	materialOriginLabel,
	materialSourceFor,
	overrideMaterialGroup,
	resetMaterialGroupToPreset,
	selectMaterialGroup,
} from "@models/materials/materials-seed.ts";
import { materialValueFor } from "@components/editor/create-materials.tsx";
import { MaterialAssets, toggleAsset } from "@components/catalog/material-assets.tsx";
import type { ElementSourceMap } from "@models/presets/element-sources.ts";
import { createContentMaterial, updateContentMaterial } from "@api/materials.ts";
import { fetchWriterStyle, saveWriterStyle, type WriterStyleView } from "@api/settings.ts";
import { Chip } from "@design-system/components/chip.tsx";

export interface ProjectMaterialsDrawerProps {
	materials: ProjectMaterials;
	setMaterials: Dispatch<SetStateAction<ProjectMaterials>>;
	sources: ElementSourceMap;
	setSources: Dispatch<SetStateAction<ElementSourceMap>>;
	/** The preset the project is on, for reset-to-preset. Null when on none. */
	preset: ContentPreset | null;
	/** Reusable materials, for "replace source" and save-as-reusable. */
	library: readonly MaterialRecord[];
	/** The reference pool: the workspace library plus this project's roster. What
	 *  a material's `assetIds` are chosen from. */
	pool: readonly RefImage[];
	onLibraryChanged: () => void;
	/** Duration / aspect / platform, shown read-only in Rules. Project settings own
	 *  them; a second writer here is how the two disagree. */
	settingsSummary: string;
	/** Which group to open on mount. Regenerate flows pass "visual" so the material
	 *  behind the image is reachable before the operator regenerates it. */
	initialGroup?: MaterialGroup | null;
	/** The workspace whose narration writer style the Story group edits. Null when
	 *  no workspace is in context, which hides the picker rather than guessing. */
	workspace?: string | null;
	onClose: () => void;
}

export function ProjectMaterialsDrawer(props: ProjectMaterialsDrawerProps): JSX.Element {
	const { materials, sources, preset, library, pool, settingsSummary } = props;
	const [openGroup, setOpenGroup] = useState<MaterialGroup | null>(props.initialGroup ?? null);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const workspace = props.workspace ?? null;
	const [writerStyle, setWriterStyle] = useState<WriterStyleView | null>(null);

	/* The writer style is WORKSPACE config, not project material: it is fetched
	 * from and written to the workspace, and never copied into the project's Story
	 * body. Editing it here changes it for every project in the workspace, which is
	 * the point of a channel-level voice — the row below says so. */
	useEffect(() => {
		if (!workspace) {
			setWriterStyle(null);
			return;
		}
		let live = true;
		fetchWriterStyle(workspace)
			.then((view) => {
				if (live) setWriterStyle(view);
			})
			.catch(() => {
				if (live) setWriterStyle(null);
			});
		return () => {
			live = false;
		};
	}, [workspace]);

	const chooseWriterStyle = (key: WriterStyle | null): void => {
		if (!workspace || !writerStyle) return;
		const previous = writerStyle.selected;
		setWriterStyle({ ...writerStyle, selected: key });
		saveWriterStyle(workspace, key).catch((err: unknown) => {
			// Roll back rather than leave the picker showing a value the workspace
			// does not hold; a silently-wrong voice is worse than a visible failure.
			setWriterStyle((view) => (view ? { ...view, selected: previous } : view));
			setError(err instanceof Error ? err.message : "Could not save the writer style.");
		});
	};

	/** A hand edit: the group diverges from whatever supplied it. */
	const writeGroup = (group: MaterialGroup, value: MaterialGroupValue): void => {
		const next = overrideMaterialGroup(materials, sources, group, value);
		props.setMaterials(next.materials);
		props.setSources(next.sources);
	};

	/** Picking a reusable material — faithful to the library row, so it records
	 *  WHICH one and the badge can distinguish it from an edited copy. */
	const selectGroupSource = (group: MaterialGroup, materialId: string | null): void => {
		const next = selectMaterialGroup(
			materials,
			sources,
			group,
			materialValueFor(library, materialId),
		);
		props.setMaterials(next.materials);
		props.setSources(next.sources);
	};

	const resetGroup = (group: MaterialGroup): void => {
		if (!preset) return;
		const next = resetMaterialGroupToPreset(preset, library, materials, sources, group);
		props.setMaterials(next.materials);
		props.setSources(next.sources);
	};

	const roleForRef = (id: string): Role | null => {
		const ref = pool.find((item) => item.id === id);
		return roleOf(ref?.role) ?? roleOf(ref?.tags?.[0]);
	};

	const toggleGroupAsset = (group: MaterialGroup, value: MaterialGroupValue, id: string): void => {
		const assetIds = toggleAsset(value.assetIds, id);
		if (group !== "visual") {
			writeGroup(group, { ...value, assetIds });
			return;
		}
		const kept = new Set(assetIds);
		const referenceSettings = (value.referenceSettings ?? []).filter((setting) =>
			kept.has(setting.entityId),
		);
		if (assetIds.includes(id) && !value.assetIds.includes(id)) {
			referenceSettings.push({
				entityId: id,
				role: roleForRef(id),
				referenceUse: null,
				selectionHint: "",
				state: "user-set",
				locked: false,
			});
		}
		writeGroup(group, { ...value, assetIds, referenceSettings });
	};

	const selectVisualReference = (
		value: MaterialGroupValue,
		id: string,
		input: { referenceUse: ReferenceUse; selectionHint: string },
	): void => {
		const assetIds = value.assetIds.includes(id) ? value.assetIds : [...value.assetIds, id];
		const existing = (value.referenceSettings ?? []).find((setting) => setting.entityId === id);
		const rest = (value.referenceSettings ?? []).filter((setting) => setting.entityId !== id);
		writeGroup("visual", {
			...value,
			assetIds,
			referenceSettings: [
				...rest,
				{
					entityId: id,
					role: existing?.role ?? roleForRef(id),
					referenceUse: input.referenceUse,
					selectionHint: input.selectionHint,
					state: existing?.state ?? "user-set",
					locked: existing?.locked ?? false,
				},
			],
		});
	};

	const setVisualReferenceUse = (
		value: MaterialGroupValue,
		id: string,
		use: ReferenceUse,
	): void => {
		const existing = (value.referenceSettings ?? []).find((setting) => setting.entityId === id);
		const rest = (value.referenceSettings ?? []).filter((setting) => setting.entityId !== id);
		writeGroup("visual", {
			...value,
			referenceSettings: [
				...rest,
				{
					entityId: id,
					role: existing?.role ?? roleForRef(id),
					referenceUse: use,
					selectionHint: existing?.selectionHint ?? "",
					state: existing?.state ?? "user-set",
					locked: existing?.locked ?? false,
				},
			],
		});
	};

	const setVisualSelectionHint = (
		value: MaterialGroupValue,
		id: string,
		selectionHint: string,
	): void => {
		const existing = (value.referenceSettings ?? []).find((setting) => setting.entityId === id);
		const rest = (value.referenceSettings ?? []).filter((setting) => setting.entityId !== id);
		writeGroup("visual", {
			...value,
			referenceSettings: [
				...rest,
				{
					entityId: id,
					role: existing?.role ?? roleForRef(id),
					referenceUse: existing?.referenceUse ?? null,
					selectionHint,
					state: existing?.state ?? "user-set",
					locked: existing?.locked ?? false,
				},
			],
		});
	};

	/* Save-as-reusable. When the group already points at a material this UPDATES
	 * that row; otherwise it creates one.
	 *
	 * The project keeps its own value — saving publishes the text, it does not hand
	 * ownership away — but the group is now FAITHFUL to the row it just wrote, so
	 * this records a selection rather than an edit. Recording an override instead
	 * left the badge reading "Modified from material" and still offering "Revert to
	 * material" immediately after a successful save, which invited an operator to
	 * revert away the thing they had just published.
	 *
	 * The value written is the one that was SAVED, not the server's echo: they hold
	 * the same body and assets, and using the local value keeps a slow response
	 * from blanking a field mid-edit. */
	const saveAsReusable = async (group: MaterialGroup): Promise<void> => {
		const value = materials[group];
		const existing = value.materialId
			? library.find((record) => record.id === value.materialId)
			: null;
		const name = window.prompt(
			"Name this material",
			existing?.name ?? MATERIAL_GROUP_COPY[group].label,
		);
		if (!name?.trim()) return;
		setSaving(true);
		setError(null);
		try {
			const input = materialRecordFromValue(value, group, name, existing?.description ?? "");
			const saved = existing
				? await updateContentMaterial(existing.id, input)
				: await createContentMaterial(input);
			const next = selectMaterialGroup(materials, sources, group, {
				...value,
				materialId: saved.id,
			});
			props.setMaterials(next.materials);
			props.setSources(next.sources);
			props.onLibraryChanged();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="tl2-materials" role="dialog" aria-label="Project Materials">
			<div className="tl2-materials-head">
				<span className="tl2-materials-title">{Ic.spark(ICON.sm)} Project Materials</span>
				<button type="button" className="tl2-materials-x" title="Close" onClick={props.onClose}>
					{Ic.x(ICON.sm)}
				</button>
			</div>

			{error && <p className="tl2-materials-err">{error}</p>}

			<div className="tl2-materials-rows">
				{MATERIAL_GROUP_ORDER.map((group) => {
					const copy = MATERIAL_GROUP_COPY[group];
					const value = materials[group];
					const origin = materialOrigin(value, materialSourceFor(sources, group));
					const open = openGroup === group;
					const options = library.filter((record) => record.group === group);
					return (
						<section key={group} className={`tl2-materials-row${open ? " on" : ""}`}>
							<button
								type="button"
								className="tl2-materials-row-btn"
								aria-expanded={open}
								onClick={() => setOpenGroup(open ? null : group)}
							>
								<span className="tl2-materials-row-name">
									{Ic[copy.icon](14)} {copy.label}
								</span>
								<Chip>{materialOriginLabel(origin)}</Chip>
								<span className="tl2-materials-row-sum">
									{materialSummary(value.body, value.assetIds.length)}
								</span>
								{open ? Ic.chevD(ICON.sm) : Ic.chevR(ICON.sm)}
							</button>

							{open && (
								<div className="tl2-materials-detail">
									{/* Rules shows what project settings already decide, read-only.
									    Editing duration or platform in two places is how they drift. */}
									{group === "rules" && (
										<p className="tl2-materials-settings">From settings: {settingsSummary}</p>
									)}

									<Textarea
										className="tl2-materials-body"
										aria-label={`${copy.label} material`}
										value={value.body}
										placeholder={copy.placeholder}
										onChange={(e) => writeGroup(group, { ...value, body: e.target.value })}
									/>

									{/* The narration writer style lives inside Story: it governs how the
									    narration is written, the way the style guide inside Visual governs
									    how frames look. It is workspace config, so the row says where it
									    applies — an operator changing it here changes every project in
									    the workspace, and should not discover that later. */}
									{group === "story" && workspace && writerStyle && (
										<div className="tl2-materials-bible">
											<div className="tl2-materials-bible-head">
												<span>Writer style</span>
												<Chip>Workspace · {workspace}</Chip>
											</div>
											{/* The empty option is a real, reachable choice ("narrate as before"),
											    so `onSelect` — which drops anything outside the set — is not the
											    right helper here. `oneOf` still keeps the cast out of it. */}
											<Select
												aria-label="Narration writer style"
												value={writerStyle.selected ?? ""}
												onValueChange={(e) => chooseWriterStyle(oneOf(e, WRITER_STYLES) ?? null)}
												phoneBreakpoint={860}
												options={[
													{ value: "", label: "No writer style" },
													...(writerStyle.options.map((option) => ({
														value: option.key,
														label: option.label,
													})) ?? []),
												]}
											/>
											<p className="tl2-materials-settings">
												{writerStyle.options.find((option) => option.key === writerStyle.selected)
													?.sentenceRhythm ?? "Narration is written however the planner chooses."}
											</p>
										</div>
									)}

									{group === "visual" && (
										<MaterialAssets
											group={group}
											selected={value.assetIds}
											pool={pool}
											onToggle={(id) => toggleGroupAsset(group, value, id)}
											onSelectReference={(id, input) => selectVisualReference(value, id, input)}
											referenceSettings={value.referenceSettings ?? []}
											onReferenceUseChange={(id, use) => setVisualReferenceUse(value, id, use)}
											onSelectionHintChange={(id, hint) => setVisualSelectionHint(value, id, hint)}
										/>
									)}

									{/* The style bible lives inside Visual: it is generated FROM visual
									    materials, and once edited by hand it locks so the next
									    regeneration cannot silently discard the edit. */}
									{group === "visual" && (
										<div className="tl2-materials-bible">
											<div className="tl2-materials-bible-head">
												<span>Style guide</span>
												{materials.styleBible.locked && <Chip>Edited — kept on regenerate</Chip>}
											</div>
											<Textarea
												className="tl2-materials-body"
												aria-label="Style guide"
												value={materials.styleBible.body}
												placeholder="Generated from Visual materials. Edit to lock it."
												onChange={(e) =>
													props.setMaterials((m) => ({
														...m,
														styleBible: { body: e.target.value, locked: true },
													}))
												}
											/>
											{materials.styleBible.locked && (
												<button
													type="button"
													className="cv-textbtn"
													onClick={() =>
														props.setMaterials((m) => ({
															...m,
															styleBible: { ...m.styleBible, locked: false },
														}))
													}
												>
													Allow regeneration to replace this
												</button>
											)}
										</div>
									)}

									<div className="tl2-materials-actions">
										<label className="tl2-materials-source">
											<span>Source</span>
											<Select
												width="auto"
												aria-label={`${copy.label} source`}
												value={value.materialId ?? ""}
												disabled={options.length === 0}
												onValueChange={(e) => selectGroupSource(group, e || null)}
												phoneBreakpoint={860}
												options={[
													{
														value: "",
														label:
															options.length === 0 ? "No materials in library" : "Project only",
													},
													...(options.map((record) => ({ value: record.id, label: record.name })) ??
														[]),
												]}
											/>
										</label>
										<button
											type="button"
											className="cv-textbtn"
											disabled={saving}
											onClick={() => void saveAsReusable(group)}
										>
											{value.materialId ? "Save back to material" : "Save as reusable"}
										</button>
										{/* Diverged from the material it came from: offer the way back.
										    Without this the only route to the original is remembering
										    which row it was and re-picking it from the dropdown. */}
										{isModifiedFromMaterial(value, materialSourceFor(sources, group)) && (
											<button
												type="button"
												className="cv-textbtn"
												onClick={() => selectGroupSource(group, value.materialId)}
											>
												Revert to material
											</button>
										)}
										{canResetToPreset(preset, sources, group) && (
											<button
												type="button"
												className="cv-textbtn"
												onClick={() => resetGroup(group)}
											>
												Reset to preset
											</button>
										)}
									</div>
								</div>
							)}
						</section>
					);
				})}
			</div>
		</div>
	);
}

/** How many groups carry content — the count on the drawer's button. */
export function filledMaterialCount(materials: ProjectMaterials): number {
	return MATERIAL_GROUPS.filter(
		(group) => materials[group].body.trim() || materials[group].assetIds.length > 0,
	).length;
}
