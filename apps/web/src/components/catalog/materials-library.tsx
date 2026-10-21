import { Input, Textarea } from "@design-system/components/input.tsx";
/* Maleo — Library > Materials
 *
 * Reusable generation context, outside a project. A material is the writing an
 * operator does once — the brief, the look, the narrator, the constraints — and
 * previously had nowhere to live: it was typed into one project's reference panel
 * and creative-direction fields, so reusing it meant retyping it.
 *
 * A record belongs to ONE group, because groups route to different generation
 * stages. That is why the list is grouped rather than flat, and why the group is
 * chosen at create time rather than being a tag.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, JSX } from "react";
import {
	isFixtureRow,
	MATERIAL_GROUPS,
	roleOf,
	type MaterialGroup,
	type MaterialRecord,
	type ReferenceUse,
	type Role,
	type VisualMaterialReference,
	oneOf,
} from "@maleo/shared";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { Button } from "@design-system/components/button.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";
import {
	MATERIAL_GROUP_COPY,
	MATERIAL_GROUP_ORDER,
	materialSummary,
} from "@models/materials/material-vocabulary.ts";
import {
	createContentMaterial,
	deleteContentMaterial,
	listContentMaterials,
	updateContentMaterial,
} from "@api/materials.ts";
import { fetchContentCatalogue } from "@api/workspace-catalogue.ts";
import { MaterialAssets, toggleAsset } from "./material-assets.tsx";
import type { RefImage } from "@maleo/shared";
import { LibraryHeader } from "./library-chrome.tsx";
import {
	EmptyState,
	ErrorState,
	LoadingState,
	collectionPhase,
} from "@design-system/patterns/collection.tsx";
import { PageTitle } from "@design-system/components/page.tsx";
import { LibraryToolbar } from "./library-toolbar.tsx";
import { useActiveWorkspace } from "@hooks/workspace/use-active-workspace.ts";
import "./materials-library.css";

const H2: CSSProperties = { fontSize: 13.5, fontWeight: 700, margin: "0 0 8px" };

/* Story, Visual, Voice and Rules as toolbar chips. Built from the same ordered
 * list and copy the sections render from, so a group cannot exist as a heading
 * without existing as a filter. */
const MATERIAL_GROUP_CHIPS = MATERIAL_GROUP_ORDER.map((group) => ({
	id: group,
	label: MATERIAL_GROUP_COPY[group].label,
}));

interface EditorProps {
	initial: MaterialRecord | null;
	defaultGroup: MaterialGroup;
	onCancel: () => void;
	onSaved: () => void;
}

function MaterialEditor({ initial, defaultGroup, onCancel, onSaved }: EditorProps): JSX.Element {
	/* Editing a shipped material produces a copy, so it opens under a distinct name
	 * rather than silently creating a second "Animated Systems Explainer — Story". */
	const [name, setName] = useState(
		initial ? (isFixtureRow(initial) ? `${initial.name} (copy)` : initial.name) : "",
	);
	const [description, setDescription] = useState(initial?.description ?? "");
	const [group, setGroup] = useState<MaterialGroup>(initial?.group ?? defaultGroup);
	const [body, setBody] = useState(initial?.body ?? "");
	const [assetIds, setAssetIds] = useState<string[]>(initial?.assetIds ?? []);
	const [referenceSettings, setReferenceSettings] = useState<VisualMaterialReference[]>(
		initial?.referenceSettings ?? [],
	);
	const [groupMenuOpen, setGroupMenuOpen] = useState(false);
	const [pool, setPool] = useState<RefImage[]>([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const copy = MATERIAL_GROUP_COPY[group];

	/* The workspace reference library — the same pool the editor drawer offers,
	 * minus a project's own roster, because a reusable material is not scoped to
	 * one project. Fetched here so a brand material with a logo can be built
	 * without opening a project first, which is what this surface used to require. */
	useEffect(() => {
		let alive = true;
		void fetchContentCatalogue()
			.then((catalogue) => {
				if (!alive || !catalogue) return;
				setPool([
					...catalogue.images,
					...catalogue.products.map((product): RefImage => ({
						id: product.id,
						label: product.label,
						seed: product.seed,
						imageUrl: product.src,
						role: "product",
					})),
				]);
			})
			.catch(() => {
				/* the picker degrades to "none available" */
			});
		return () => {
			alive = false;
		};
	}, []);

	const save = async (): Promise<void> => {
		const trimmed = name.trim();
		if (!trimmed || busy) return;
		setBusy(true);
		setError(null);
		const input = {
			name: trimmed,
			description: description.trim(),
			group,
			body: body.trim(),
			assetIds,
			referenceSettings,
		};
		try {
			/* A shipped material is read-only, so editing one creates the operator's own
			 * copy instead. The server refuses a write to a fixture with a 409 naming the
			 * fork route rather than trusting every UI path to remember this. */
			if (initial && !isFixtureRow(initial)) await updateContentMaterial(initial.id, input);
			else await createContentMaterial(input);
			onSaved();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setBusy(false);
		}
	};

	const roleForRef = (id: string): Role | null => {
		const ref = pool.find((item) => item.id === id);
		return roleOf(ref?.role) ?? roleOf(ref?.tags?.[0]);
	};

	const updateVisualSetting = (
		id: string,
		patch: Partial<Pick<VisualMaterialReference, "referenceUse" | "selectionHint">>,
	): void => {
		setReferenceSettings((current) => {
			const existing = current.find((setting) => setting.entityId === id);
			const rest = current.filter((setting) => setting.entityId !== id);
			return [
				...rest,
				{
					entityId: id,
					role: existing?.role ?? roleForRef(id),
					referenceUse: patch.referenceUse ?? existing?.referenceUse ?? null,
					selectionHint: patch.selectionHint ?? existing?.selectionHint ?? "",
					state: existing?.state ?? "user-set",
					locked: existing?.locked ?? false,
				},
			];
		});
	};

	const toggleReference = (id: string): void => {
		const next = toggleAsset(assetIds, id);
		const kept = new Set(next);
		const adding = next.includes(id) && !assetIds.includes(id);
		setAssetIds(next);
		setReferenceSettings((settings) => {
			const pruned = settings.filter((setting) => kept.has(setting.entityId));
			if (adding) {
				pruned.push({
					entityId: id,
					role: roleForRef(id),
					referenceUse: null,
					selectionHint: "",
					state: "user-set",
					locked: false,
				});
			}
			return pruned;
		});
	};

	const selectReference = (
		id: string,
		input: { referenceUse: ReferenceUse; selectionHint: string },
	): void => {
		setAssetIds((current) => (current.includes(id) ? current : [...current, id]));
		setReferenceSettings((current) => {
			const existing = current.find((setting) => setting.entityId === id);
			const rest = current.filter((setting) => setting.entityId !== id);
			return [
				...rest,
				{
					entityId: id,
					role: existing?.role ?? roleForRef(id),
					referenceUse: input.referenceUse,
					selectionHint: input.selectionHint,
					state: existing?.state ?? "user-set",
					locked: existing?.locked ?? false,
				},
			];
		});
	};

	return (
		<div className="pg">
			<div className="cat-head">
				<Button variant="ghost" size="sm" onClick={onCancel}>
					{Ic.chevronLeft(ICON.md)} Back
				</Button>
				<PageTitle level="sub">{initial ? "Edit material" : "New material"}</PageTitle>
			</div>

			<div className="form">
				<label className="cat-field">
					<span className="cat-field-label">Name</span>
					<Input
						className="cat-input"
						value={name}
						placeholder="Material name"
						disabled={busy}
						onChange={(e) => setName(e.target.value)}
					/>
				</label>

				<div className="cat-field">
					<span className="cat-field-label">Group</span>
					<div className="tl2-materials-group-select">
						<button
							type="button"
							className="tl2-materials-group-card"
							aria-expanded={groupMenuOpen}
							disabled={busy}
							onClick={() => setGroupMenuOpen((open) => !open)}
						>
							<span className="tl2-materials-group-card-icon">{Ic[copy.icon](15)}</span>
							<span>
								<strong>{copy.label}</strong>
								<small>{copy.hint}</small>
							</span>
							{groupMenuOpen ? Ic.chevD(ICON.sm) : Ic.chevR(ICON.sm)}
						</button>
						{groupMenuOpen && (
							<div className="tl2-materials-group-menu" role="listbox" aria-label="Material group">
								{MATERIAL_GROUP_ORDER.map((g) => {
									const groupCopy = MATERIAL_GROUP_COPY[g];
									return (
										<button
											key={g}
											type="button"
											className={g === group ? "on" : ""}
											role="option"
											aria-selected={g === group}
											disabled={busy}
											onClick={() => {
												setGroup(g);
												setGroupMenuOpen(false);
											}}
										>
											<span className="tl2-materials-group-card-icon">
												{Ic[groupCopy.icon](14)}
											</span>
											<span>
												<strong>{groupCopy.label}</strong>
												<small>{groupCopy.hint}</small>
											</span>
										</button>
									);
								})}
							</div>
						)}
					</div>
				</div>

				<label className="cat-field">
					<span className="cat-field-label">Description</span>
					<Input
						className="cat-input"
						value={description}
						placeholder="When to reach for this"
						disabled={busy}
						onChange={(e) => setDescription(e.target.value)}
					/>
				</label>

				<label className="cat-field">
					<span className="cat-field-label">{copy.label} material</span>
					<Textarea
						className="ml-body"
						value={body}
						placeholder={copy.placeholder}
						disabled={busy}
						onChange={(e) => setBody(e.target.value)}
					/>
				</label>

				{group === "visual" && (
					<MaterialAssets
						group={group}
						selected={assetIds}
						pool={pool}
						onToggle={toggleReference}
						onSelectReference={selectReference}
						referenceSettings={referenceSettings}
						onReferenceUseChange={(id, referenceUse: ReferenceUse) =>
							updateVisualSetting(id, { referenceUse })
						}
						onSelectionHintChange={(id, selectionHint) =>
							updateVisualSetting(id, { selectionHint })
						}
						emptyPoolLabel="No references in the workspace library"
					/>
				)}

				{error && <p className="ml-err-flush">{error}</p>}
				<div className="cat-actions">
					<Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
						Cancel
					</Button>
					<Button
						variant="primary"
						size="sm"
						loading={busy}
						disabled={!name.trim()}
						onClick={() => void save()}
					>
						Save material
					</Button>
				</div>
			</div>
		</div>
	);
}

export function MaterialsLibrary({
	initialEditId,
	initialNewGroup,
}: {
	initialEditId?: string;
	initialNewGroup?: string;
}): JSX.Element {
	const workspace = useActiveWorkspace();
	const [items, setItems] = useState<MaterialRecord[]>([]);
	const [query, setQuery] = useState("");
	const [group, setGroup] = useState<MaterialGroup | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [editing, setEditing] = useState<{
		material: MaterialRecord | null;
		group: MaterialGroup;
	} | null>(null);
	const [openedInitialEditId, setOpenedInitialEditId] = useState("");

	const load = useCallback(async (): Promise<void> => {
		setLoading(true);
		try {
			setItems(await listContentMaterials());
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);
	const phase = collectionPhase({ count: items.length, loading, failed: error !== null });

	/* Arriving from "Create one in Library > Materials" opens the create form for
	 * the group the caller needed, rather than a list the operator has to navigate.
	 * An unrecognised group is ignored: a bad link should land on the list, not on a
	 * form for a group that does not exist. */
	const [openedInitialNew, setOpenedInitialNew] = useState(false);
	useEffect(() => {
		if (!initialNewGroup || openedInitialNew) return;
		const group = oneOf(initialNewGroup, MATERIAL_GROUPS);
		if (!group) return;
		setOpenedInitialNew(true);
		setEditing({ material: null, group });
	}, [initialNewGroup, openedInitialNew]);

	useEffect(() => {
		if (!initialEditId || loading || openedInitialEditId === initialEditId) return;
		const material = items.find((item) => item.id === initialEditId);
		if (!material) return;
		setOpenedInitialEditId(initialEditId);
		setEditing({ material, group: material.group });
	}, [initialEditId, items, loading, openedInitialEditId]);

	const remove = async (id: string): Promise<void> => {
		try {
			await deleteContentMaterial(id);
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	const matched = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return items;
		return items.filter((item) =>
			`${item.name} ${item.description} ${item.body}`.toLowerCase().includes(q),
		);
	}, [items, query]);

	/* The filter chooses which SECTIONS render, and a rendered section stays put
	 * even when nothing in it matches — it keeps its create action, so an operator
	 * can see the whole material model and add to the empty part of it. Hiding a
	 * group because it happens to be empty is what made the four groups look like
	 * however many the workspace had filled in. */
	const shownGroups = useMemo(
		() => (group === null ? MATERIAL_GROUP_ORDER : MATERIAL_GROUP_ORDER.filter((g) => g === group)),
		[group],
	);

	const byGroup = useMemo(() => {
		const map = new Map<MaterialGroup, MaterialRecord[]>(MATERIAL_GROUPS.map((g) => [g, []]));
		for (const item of matched) map.get(item.group)?.push(item);
		return map;
	}, [matched]);

	if (editing) {
		return (
			<MaterialEditor
				initial={editing.material}
				defaultGroup={editing.group}
				onCancel={() => setEditing(null)}
				onSaved={() => {
					setEditing(null);
					void load();
				}}
			/>
		);
	}

	return (
		<div className="pg">
			<LibraryHeader
				type="materials"
				count={items.length}
				/* Creates into the group being looked at. With Visual filtered, "New
				   material" opening a Story form is the page ignoring what it was just
				   told; with no filter, Story is the first group and stays the default. */
				action={
					<Button
						variant="primary"
						size="sm"
						onClick={() => setEditing({ material: null, group: group ?? "story" })}
					>
						{Ic.plus(ICON.md)} New material
					</Button>
				}
			/>
			<LibraryToolbar
				query={query}
				onQuery={setQuery}
				placeholder="Search materials"
				groups={MATERIAL_GROUP_CHIPS}
				group={group}
				onGroup={setGroup}
				groupLabel="Filter by material group"
			/>

			{phase === "ready" && error && (
				<ErrorState
					inline
					title="That did not work."
					message={error}
					onRetry={() => void load()}
					retrying={loading}
				/>
			)}
			{phase === "loading" ? (
				<LoadingState label="Loading materials…" />
			) : phase === "failed" ? (
				<ErrorState
					title="Could not load materials"
					message="The server did not answer as expected."
					onRetry={() => void load()}
					retrying={loading}
				/>
			) : phase === "empty" ? (
				/* Names the workspace it is empty for. Materials are workspace-scoped,
				   so most workspaces have none and a correct empty library is the
				   ordinary case. */
				<EmptyState
					label={`No materials in ${workspace} yet. Create one to reuse a brief, a look, a narrator, or a set of rules across this workspace's projects — or switch workspace to see another's.`}
				/>
			) : (
				<div className="ml-grid">
					{/* `minmax(0, 720px)`, not `max-width: 720px`. A grid track is `auto` by
					    default, and `auto` floors at its content's min-content width — here a
					    row whose summary line is `white-space: nowrap` — so the track refused
					    to go below 484px and the page rendered 180px wider than a 320px
					    viewport. The app clips horizontal overflow, so those 180px were
					    unreachable rather than scrollable. */}
					{shownGroups.map((group) => {
						const copy = MATERIAL_GROUP_COPY[group];
						const rows = byGroup.get(group) ?? [];
						return (
							<section key={group}>
								<h2 style={H2}>
									{Ic[copy.icon](14)} {copy.label}
								</h2>
								<p className="ml-lead">{copy.hint}</p>
								{rows.length === 0 ? (
									<button
										type="button"
										className="cv-preset-empty ml-full"
										onClick={() => setEditing({ material: null, group })}
									>
										<span>
											No {copy.label.toLowerCase()} materials
											{query.trim() ? " match this search" : ""}
										</span>
										<span className="cv-preset-empty-cta">
											New {copy.label.toLowerCase()} material
										</span>
									</button>
								) : (
									<div className="collection-rows">
										{rows.map((material) => (
											<div key={material.id} className="collection-card collection-card-row">
												<div className="cat-row-main">
													<div className="cat-row-name">
														{material.name}
														{isFixtureRow(material) && <span className="ml-badge">built-in</span>}
													</div>
													{material.description && (
														<div className="ml-row-sub">{material.description}</div>
													)}
													<div className="ml-row-path">
														{materialSummary(material.body, material.assetIds.length)}
													</div>
												</div>
												{/* A shipped material is read-only, so it offers the copy the edit would
												    produce rather than an Edit the server answers with a 409, and no Delete
												    at all — the row is not the operator's to remove. */}
												{isFixtureRow(material) ? (
													<IconButton
														size="sm"
														title="Copy to a material you can edit"
														onClick={() => setEditing({ material, group })}
													>
														{Ic.copy(ICON.sm)}
													</IconButton>
												) : (
													<>
														<IconButton
															size="sm"
															title="Edit"
															onClick={() => setEditing({ material, group })}
														>
															{Ic.pen(ICON.sm)}
														</IconButton>
														<IconButton
															size="sm"
															danger
															title="Delete"
															onClick={() => void remove(material.id)}
														>
															{Ic.trash(ICON.sm)}
														</IconButton>
													</>
												)}
											</div>
										))}
									</div>
								)}
							</section>
						);
					})}
				</div>
			)}
		</div>
	);
}
