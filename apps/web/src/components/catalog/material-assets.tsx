import { Select } from "@design-system/components/select.tsx";
import { Input } from "@design-system/components/input.tsx";
/* The references attached to a material, and the pool to add them from.
 *
 * Shared by the two surfaces that author a material: the Library editor, where a
 * reusable material is written, and the editor drawer, where a project's copy is
 * tuned. It lives here rather than in either one because a picker that existed on
 * only one of them is the bug this replaces — the Library used to tell operators
 * to "attach assets in the project drawer", which meant building a reusable brand
 * material required opening an unrelated project first.
 *
 * The pool differs by surface (workspace library vs. the project's roster) and is
 * passed in, so neither caller has to know how the other resolves references.
 */
import { useState } from "react";
import type { JSX } from "react";
import {
	defaultReferenceUseForRole,
	isReferenceUse,
	roleOf,
	ROLES,
	type MaterialGroup,
	type ReferenceUse,
	type Role,
	type VisualMaterialReference,
} from "@maleo/shared";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { SearchField } from "@design-system/components/search-field.tsx";
import { Button } from "@design-system/components/button.tsx";
import { MATERIAL_GROUP_COPY } from "@models/materials/material-vocabulary.ts";
import type { RefImage } from "@maleo/shared";
import "./material-assets.css";
import { Chip } from "@design-system/components/chip.tsx";
import { Modal } from "@design-system/components/modal.tsx";

/* Add or remove one reference from a group.
 *
 * Order is preserved on add (append) because `routedAssetIds` hands the provider
 * its references in exactly this order, and a set that reordered on every toggle
 * would make the same selection produce a different prompt. */
export function toggleAsset(selected: readonly string[], id: string): string[] {
	return selected.includes(id) ? selected.filter((existing) => existing !== id) : [...selected, id];
}

export function defaultSelectionHint(input: string, ref: RefImage | undefined): string {
	return input.trim() || ref?.description?.trim() || "";
}

export interface MaterialAssetsProps {
	group: MaterialGroup;
	selected: readonly string[];
	pool: readonly RefImage[];
	onToggle: (id: string) => void;
	onSelectReference?: (
		id: string,
		input: { referenceUse: ReferenceUse; selectionHint: string },
	) => void;
	referenceSettings?: readonly VisualMaterialReference[];
	onReferenceUseChange?: (id: string, use: ReferenceUse) => void;
	onSelectionHintChange?: (id: string, hint: string) => void;
	/** Shown when the pool is empty, so each surface can point somewhere useful. */
	emptyPoolLabel?: string;
}

const ROLE_LABELS = {
	style: "Style",
	character: "Characters",
	location: "Locations",
	product: "Products",
	prop: "Props",
} satisfies Record<Role, string>;

function roleForRef(ref: RefImage): Role {
	return roleOf(ref.role) ?? roleOf(ref.tags?.[0]) ?? "style";
}

export function MaterialAssets({
	group,
	selected,
	pool,
	onToggle,
	onSelectReference,
	referenceSettings,
	onReferenceUseChange,
	onSelectionHintChange,
	emptyPoolLabel,
}: MaterialAssetsProps): JSX.Element {
	const [panel, setPanel] = useState<null | { kind: "add" } | { kind: "edit"; id: string }>(null);
	const [createRole, setCreateRole] = useState<Role>("character");
	const [createUse, setCreateUse] = useState<ReferenceUse>("exact");
	const [createHint, setCreateHint] = useState("");
	const [createQuery, setCreateQuery] = useState("");
	const [pendingRefId, setPendingRefId] = useState<string | null>(null);
	const [editUse, setEditUse] = useState<ReferenceUse>("exact");
	const [editHint, setEditHint] = useState("");
	const chosen = selected
		.map((id) => pool.find((ref) => ref.id === id))
		.filter((ref): ref is RefImage => Boolean(ref));
	// An id with nothing behind it is shown as a count, not dropped: silently
	// hiding it would make a material look emptier than what generation receives.
	const missing = selected.length - chosen.length;
	const settingFor = (id: string): VisualMaterialReference | undefined =>
		referenceSettings?.find((setting) => setting.entityId === id);
	const referenceUseFor = (ref: RefImage): ReferenceUse => {
		const setting = settingFor(ref.id);
		if (setting?.referenceUse) return setting.referenceUse;
		const role = setting?.role ?? roleForRef(ref);
		return role ? defaultReferenceUseForRole(role) : "exact";
	};
	const renderField = (label: string, input: JSX.Element): JSX.Element => (
		<label className="tl2-materials-field">
			<span>{label}</span>
			{input}
		</label>
	);
	const openAdd = (): void => {
		setCreateQuery("");
		setPendingRefId(null);
		setPanel({ kind: "add" });
	};
	const openEdit = (ref: RefImage): void => {
		setEditUse(referenceUseFor(ref));
		setEditHint(settingFor(ref.id)?.selectionHint ?? "");
		setPanel({ kind: "edit", id: ref.id });
	};
	const saveAdd = (): void => {
		if (!pendingRefId) return;
		const ref = pool.find((item) => item.id === pendingRefId);
		const selectionHint = defaultSelectionHint(createHint, ref);
		if (onSelectReference)
			onSelectReference(pendingRefId, { referenceUse: createUse, selectionHint });
		else {
			if (!selected.includes(pendingRefId)) onToggle(pendingRefId);
			onReferenceUseChange?.(pendingRefId, createUse);
			if (selectionHint) onSelectionHintChange?.(pendingRefId, selectionHint);
		}
		closePanel();
	};
	const saveEdit = (): void => {
		if (!panelRef) return;
		onReferenceUseChange?.(panelRef.id, editUse);
		onSelectionHintChange?.(panelRef.id, editHint);
		closePanel();
	};
	const filteredPool = pool
		.filter((ref) => roleForRef(ref) === createRole)
		.filter((ref) => {
			const q = createQuery.trim().toLowerCase();
			if (!q) return true;
			return `${ref.label} ${ref.description ?? ""} ${(ref.tags ?? []).join(" ")}`
				.toLowerCase()
				.includes(q);
		});
	const renderPoolItem = (ref: RefImage): JSX.Element => (
		<button
			key={ref.id}
			type="button"
			className={`tl2-materials-select-card${pendingRefId === ref.id ? " on" : ""}${selected.includes(ref.id) ? " attached" : ""}`}
			aria-pressed={pendingRefId === ref.id}
			onClick={() => setPendingRefId(ref.id)}
		>
			{ref.imageUrl ? (
				<img src={ref.imageUrl} alt="" />
			) : (
				<span className="tl2-ref-chip-empty">{ref.label.slice(0, 1).toUpperCase()}</span>
			)}
			<span>
				<strong>{ref.label}</strong>
				<small>{ref.description?.trim() || "Always available"}</small>
			</span>
			{pendingRefId === ref.id && Ic.check(ICON.sm)}
		</button>
	);
	const panelRef = panel?.kind === "edit" ? chosen.find((ref) => ref.id === panel.id) : null;
	const renderReferenceCard = (ref: RefImage): JSX.Element => {
		const setting = settingFor(ref.id);
		const role = setting?.role ?? roleForRef(ref);
		const hint = setting?.selectionHint?.trim() || "Always available";
		const state = setting?.locked ? "Locked" : (setting?.state ?? "user-set");
		return (
			<button
				key={ref.id}
				type="button"
				className="tl2-materials-ref-card"
				aria-label={`Edit ${ref.label} reference`}
				onClick={() => openEdit(ref)}
			>
				{ref.imageUrl ? (
					<img src={ref.imageUrl} alt="" />
				) : (
					<span className="tl2-ref-chip-empty">{ref.label.slice(0, 1).toUpperCase()}</span>
				)}
				<span className="tl2-materials-ref-card-copy">
					<strong>{ref.label}</strong>
					<small>{hint}</small>
					<span>
						<b>{ROLE_LABELS[role]}</b>
						<i>{referenceUseFor(ref)}</i>
						<em>{state}</em>
					</span>
				</span>
			</button>
		);
	};
	const closePanel = (): void => setPanel(null);

	return (
		<div className="tl2-materials-assets">
			<div className="tl2-materials-assets-head">
				<span>References</span>
				<span>
					{chosen.length}
					{missing > 0 ? ` + ${missing} unresolved` : ""}
				</span>
			</div>

			<button
				type="button"
				className="tl2-materials-add-card"
				aria-label={`Add ${MATERIAL_GROUP_COPY[group].label} reference`}
				onClick={openAdd}
			>
				<span>{Ic.plus(ICON.md)}</span>
				<strong>Add reference</strong>
				<small>
					{pool.length === 0
						? (emptyPoolLabel ?? "No references in library")
						: "Select from library"}
				</small>
			</button>

			{chosen.length === 0 && missing === 0 ? (
				<p className="tl2-materials-assets-empty">None attached.</p>
			) : (
				<div className="tl2-materials-ref-cards">
					{chosen.map(renderReferenceCard)}
					{missing > 0 && <Chip>{missing} unresolved</Chip>}
				</div>
			)}

			{panel && (
				<Modal
					title={panel.kind === "add" ? "Add reference" : (panelRef?.label ?? "Reference")}
					sub={panel.kind === "add" ? undefined : "Edit reference"}
					onClose={closePanel}
					width={560}
					dock
					bodyClassName="tl2-materials-sheet-body"
				>
					<>
						{panel.kind === "edit" && panelRef && (
							<div className="tl2-materials-edit">
								{panelRef.imageUrl ? (
									<img src={panelRef.imageUrl} alt="" />
								) : (
									<span className="tl2-ref-chip-empty">
										{panelRef.label.slice(0, 1).toUpperCase()}
									</span>
								)}
								{renderField(
									"Reference type",
									<Input
										className="tl2-materials-create-input"
										value={ROLE_LABELS[settingFor(panelRef.id)?.role ?? roleForRef(panelRef)]}
										aria-label={`${panelRef.label} reference type`}
										readOnly
									/>,
								)}
								{renderField(
									"User set type",
									<Input
										className="tl2-materials-create-input"
										value={
											settingFor(panelRef.id)?.locked
												? "Locked"
												: (settingFor(panelRef.id)?.state ?? "user-set")
										}
										aria-label={`${panelRef.label} user set type`}
										readOnly
									/>,
								)}
								{renderField(
									"Input scenario",
									<Input
										className="tl2-materials-create-input"
										aria-label={`${panelRef.label} selection hint`}
										value={editHint}
										placeholder="Use when scene mentions..."
										disabled={!onSelectionHintChange}
										onChange={(e) => setEditHint(e.target.value)}
									/>,
								)}
								{renderField(
									"Reference use",
									<Select
										aria-label={`${panelRef.label} reference use`}
										value={editUse}
										disabled={!onReferenceUseChange}
										onValueChange={(e) => {
											if (isReferenceUse(e)) setEditUse(e);
										}}
										options={[
											{ value: "exact", label: "Exact" },
											{ value: "style", label: "Style" },
											{ value: "inspiration", label: "Inspiration" },
											{ value: "direct_place", label: "Direct place" },
										]}
									/>,
								)}
								<div className="cv-modal-actions">
									<Button
										variant="ghost"
										size="sm"
										style={{ color: "var(--err)" }}
										onClick={() => {
											onToggle(panelRef.id);
											closePanel();
										}}
									>
										{Ic.trash(ICON.sm)} Delete
									</Button>
									<span style={{ flex: 1 }} />
									<Button variant="ghost" size="sm" onClick={closePanel}>
										Cancel
									</Button>
									<Button variant="primary" size="sm" onClick={saveEdit}>
										Save
									</Button>
								</div>
							</div>
						)}

						{panel.kind === "add" && (
							<div className="tl2-materials-create">
								{renderField(
									"Reference type",
									<Select
										aria-label="New reference kind"
										value={createRole}
										onValueChange={(e) => {
											const role = roleOf(e);
											if (!role) return;
											setCreateRole(role);
											setCreateUse(defaultReferenceUseForRole(role));
											setPendingRefId(null);
										}}
										options={[
											...(ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] })) ?? []),
										]}
									/>,
								)}
								<div className="tl2-materials-field">
									<span>Select reference</span>
									<SearchField
										size="sm"
										label="Search references"
										placeholder={`Search ${ROLE_LABELS[createRole].toLowerCase()}...`}
										value={createQuery}
										onValueChange={setCreateQuery}
									/>
									{pool.length === 0 ? (
										<p className="tl2-materials-assets-empty">
											{emptyPoolLabel ?? "No references in library"}
										</p>
									) : (
										<div
											className="tl2-materials-pool"
											role="listbox"
											aria-label="Reference library"
										>
											{filteredPool.map(renderPoolItem)}
											{filteredPool.length === 0 && (
												<p className="tl2-materials-assets-empty">
													No {ROLE_LABELS[createRole].toLowerCase()} references
													{createQuery.trim() ? ` for "${createQuery.trim()}"` : ""}.
												</p>
											)}
										</div>
									)}
								</div>
								{renderField(
									"Input scenario",
									<Input
										className="tl2-materials-create-input"
										value={createHint}
										placeholder="Defaults to selected reference scenario"
										aria-label="New reference selection hint"
										onChange={(e) => setCreateHint(e.target.value)}
									/>,
								)}
								{renderField(
									"Reference use",
									<Select
										aria-label="New reference use"
										value={createUse}
										onValueChange={(e) => {
											if (isReferenceUse(e)) setCreateUse(e);
										}}
										options={[
											{ value: "exact", label: "Exact" },
											{ value: "style", label: "Style" },
											{ value: "inspiration", label: "Inspiration" },
											{ value: "direct_place", label: "Direct place" },
										]}
									/>,
								)}
								<div className="cv-modal-actions">
									<span style={{ flex: 1 }} />
									<Button variant="ghost" size="sm" onClick={closePanel}>
										Cancel
									</Button>
									<Button variant="primary" size="sm" disabled={!pendingRefId} onClick={saveAdd}>
										Save
									</Button>
								</div>
							</div>
						)}
					</>
				</Modal>
			)}
		</div>
	);
}
