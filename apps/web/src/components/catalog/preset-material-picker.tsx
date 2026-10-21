/* Choosing which reusable material a Project Preset names per group.
 *
 * A preset names materials by IDENTITY, not by copying their text. A preset that
 * embedded the bodies would be a second editor of the same writing, and the two
 * would drift the first time someone fixed a typo in the library.
 *
 * Shared by the preset library editor and the create flow's override controls, so
 * "pick a Visual material" looks and behaves the same in both.
 */
import { useEffect, useState } from "react";
import type { JSX } from "react";
import type { MaterialGroup, MaterialRecord, PresetMaterialSelection } from "@maleo/shared";
import { Ic } from "@design-system/icons/index.tsx";
import { Select } from "@design-system/components/select.tsx";
import {
	MATERIAL_GROUP_COPY,
	MATERIAL_GROUP_ORDER,
	materialSummary,
} from "@models/materials/material-vocabulary.ts";
import { listContentMaterials } from "@api/materials.ts";

/** Load every material once and index it by id. Callers need both the grouped list
 *  (to offer choices) and the lookup (to render a chosen material's name), and
 *  fetching per group would be four requests for one screen. */
export interface MaterialLibrary {
	materials: MaterialRecord[];
	byId: Map<string, MaterialRecord>;
	/* Whether the fetch has SETTLED — not whether it returned rows.
	 *
	 * An empty list and a list that has not arrived are the same value and mean
	 * opposite things. A caller that resolves a preset's material ids against an
	 * unloaded library resolves every one of them to nothing and seeds an empty
	 * project, which is indistinguishable from a preset that names no materials.
	 * `loaded` is what lets a seeder wait instead of guessing.
	 *
	 * A FAILED fetch also settles. Blocking create on a library that will never
	 * arrive would be worse than seeding without it. */
	loaded: boolean;
	reload: () => void;
}

export function useMaterialLibrary(): MaterialLibrary {
	const [materials, setMaterials] = useState<MaterialRecord[]>([]);
	const [loaded, setLoaded] = useState(false);
	const [nonce, setNonce] = useState(0);

	useEffect(() => {
		let alive = true;
		// Materials are optional: a workspace that has authored none still gets a
		// working preset editor, it just has nothing to name.
		void listContentMaterials()
			.then((list) => {
				if (alive) setMaterials(list);
			})
			.catch(() => {
				/* library is optional */
			})
			.finally(() => {
				if (alive) setLoaded(true);
			});
		return () => {
			alive = false;
		};
	}, [nonce]);

	return {
		materials,
		byId: new Map(materials.map((m) => [m.id, m])),
		loaded,
		reload: () => setNonce((n) => n + 1),
	};
}

interface RowProps {
	group: MaterialGroup;
	materials: readonly MaterialRecord[];
	selectedId: string | null;
	disabled?: boolean;
	onSelect: (id: string | null) => void;
}

/** One group's chooser: the chosen material, or a prompt to choose one. */
function MaterialGroupRow({
	group,
	materials,
	selectedId,
	disabled,
	onSelect,
}: RowProps): JSX.Element {
	const copy = MATERIAL_GROUP_COPY[group];
	const options = materials.filter((m) => m.group === group);
	const selected = options.find((m) => m.id === selectedId) ?? null;

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
			<span
				style={{
					fontSize: 12.5,
					fontWeight: 600,
					color: "var(--muted)",
					display: "flex",
					alignItems: "center",
					gap: 6,
				}}
			>
				{Ic[copy.icon](14)} {copy.label}
			</span>
			{options.length === 0 ? (
				/* A dead end otherwise: the sentence named the destination but nothing
				 * navigated there, so the only way forward from "New Project Preset"
				 * was to know the URL. A preset is still Materials + Video Template —
				 * this links to where a material is authored rather than inlining a
				 * second material editor here. */
				<p style={{ fontSize: 12, color: "var(--fg-dim)", margin: 0 }}>
					No {copy.label.toLowerCase()} materials yet.{" "}
					<a className="cv-textbtn" href={`/library/materials?new=${group}`}>
						Create one in Library &gt; Materials
					</a>
				</p>
			) : (
				<>
					<Select
						value={selectedId ?? ""}
						disabled={disabled}
						aria-label={`${copy.label} material`}
						onValueChange={(e) => onSelect(e || null)}
						options={[
							{ value: "", label: "None" },
							...(options.map((material) => ({ value: material.id, label: material.name })) ?? []),
						]}
					/>
					<span style={{ fontSize: 11.5, color: "var(--fg-dim)" }}>
						{selected ? materialSummary(selected.body, selected.assetIds.length) : copy.hint}
					</span>
				</>
			)}
		</div>
	);
}

interface PickerProps {
	materials: readonly MaterialRecord[];
	value: PresetMaterialSelection;
	disabled?: boolean;
	onChange: (next: PresetMaterialSelection) => void;
}

/** All four groups, in display order. */
export function PresetMaterialPicker({
	materials,
	value,
	disabled,
	onChange,
}: PickerProps): JSX.Element {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
			{MATERIAL_GROUP_ORDER.map((group) => (
				<MaterialGroupRow
					key={group}
					group={group}
					materials={materials}
					selectedId={value[group]}
					disabled={disabled}
					onSelect={(id) => onChange({ ...value, [group]: id })}
				/>
			))}
		</div>
	);
}
