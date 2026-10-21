/* ONE reference library, mounted everywhere references are browsed or edited.
 *
 * It replaces three components that showed the same data with different powers:
 * `ReferenceLibraryPanel` (search, usage counts, products, CRUD), `ReferencesPanel`
 * (list + create, no search, no usage), and `RefCatalogue` (scene picking, no
 * usage, its own product tab). Which operations you had depended on where you
 * opened it, which is the defect this consolidation fixes — `mode` now changes
 * layout only, never the available operations.
 *
 * Scope tiers (see tiers.ts): workspace library -> project selection -> scene cast,
 * each selecting from the one above. The tier badge is not decoration: casting an
 * entity the project has not selected produces nothing at generation time, so the
 * picker offers project selections and routes everything else through an explicit
 * add-from-library step. */
import { useState } from "react";
import type { JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { PanelHeader } from "@design-system/patterns/panel-header.tsx";
import { SearchField } from "@design-system/components/search-field.tsx";
import { Frame, FrameBadge } from "@design-system/components/frame.tsx";
import { MediaCard, MediaGrid } from "@design-system/patterns/media.tsx";
import { NoteModal } from "@components/editor/modals.tsx";
import type { NotePayload, NoteModalInitial } from "@components/editor/modals.tsx";
import {
	getKind,
	referenceDisplayRole,
	referenceTags,
	roleOfRef,
	REF_KIND_ORDER,
} from "@models/references/reference-vocabulary.ts";
import type {
	ContentType,
	Note,
	ProjectSelection,
	RefImage,
	RefsState,
	CatalogueProduct,
} from "@maleo/shared";
import { persistGlobalImage, persistNoteRef } from "@api/reference-writes.ts";
import { fmtPrice, isProductRef, type SetRefs } from "@models/references/ref-transforms.ts";
import { attachProjectReferenceEntity, deleteProjectNote } from "@api/references.ts";
import { writeMediaDragPayload } from "@models/timeline/media-drag.ts";
import { EntityEditor, type EntityDraft } from "./entity-editor.tsx";
import { applyEntityDraft } from "@models/references/entity-write.ts";
import { unresolvedSelections, upsertPool } from "@models/references/pool.ts";
import { TIER_LABEL, tierOf, usageMap, scenesStrandedBy } from "@models/references/tiers.ts";
import type { ReferenceTier } from "@models/references/tiers.ts";
import { Button } from "@design-system/components/button.tsx";
import { DeleteConfirm } from "./library-delete-confirm.tsx";
import { NoteRow } from "./library-note-row.tsx";

// Re-exported so this module stays the import site its consumers and tests use.
export { DeleteConfirm, NoteRow };

export type ReferenceLibraryMode = "rail" | "panel" | "picker";

type LibCategory = "images" | "products" | "notes";
const LIB_CATEGORIES: Array<{
	key: LibCategory;
	label: string;
	icon: (s?: number) => JSX.Element;
}> = [
	{ key: "images", label: "References", icon: Ic.image },
	{ key: "products", label: "Products", icon: Ic.box },
	{ key: "notes", label: "Notes", icon: Ic.type },
];

export interface ReferenceLibraryProps {
	/** Layout only. Every mode exposes the same operations. */
	mode: ReferenceLibraryMode;
	type: ContentType;
	refs: RefsState;
	setRefs: SetRefs;
	/** The reference pool: workspace library + this project's roster. */
	pool?: RefImage[];
	setPool?: (fn: (entries: RefImage[]) => RefImage[]) => void;
	products?: CatalogueProduct[];
	projectId?: string | null;
	/** Tier 2 — what this project selected. */
	projectSelection: ProjectSelection;
	onToggleProjectSelection: (id: string) => void;
	/** Tier 3 — the scene in context, when there is one. */
	sceneRefIds?: string[];
	onToggleSceneRef?: (id: string) => void;
	/** A note attached to this scene specifically, beside the ones applied to
	 *  every scene by their default flag. */
	sceneNoteIds?: string[];
	onToggleSceneNote?: (id: string) => void;
	/** Every scene's cast, so usage counts span both tiers. */
	sceneCasts?: string[][];
	primaryEntityId?: string | null;
	onSetPrimary?: (id: string, next: boolean) => void;
	onDeleteRef: (id: string) => Promise<boolean>;
	onClose: () => void;
	/** Present on the surfaces that sit beside a timeline. An entity's image can
	 *  then be dragged onto it — which places the image and nothing else. It does
	 *  NOT attach the entity or change the generation selection; that stays the
	 *  select action's job, because a drag is too cheap a gesture to steer what
	 *  every clip generates against. */
	draggableToTimeline?: boolean;
}

export function ReferenceLibrary({
	mode,
	refs,
	setRefs,
	pool = [],
	setPool,
	products: initialProducts = [],
	projectId,
	projectSelection,
	onToggleProjectSelection,
	sceneRefIds,
	onToggleSceneRef,
	sceneNoteIds,
	onToggleSceneNote,
	sceneCasts = [],
	primaryEntityId,
	onSetPrimary,
	onDeleteRef,
	onClose,
	draggableToTimeline = false,
}: ReferenceLibraryProps): JSX.Element {
	const [cat, setCat] = useState<LibCategory>("images");
	const [tag, setTag] = useState("all");
	const [roleFilter, setRoleFilter] = useState("all");
	const [q, setQ] = useState("");
	const [editor, setEditor] = useState<{ initial?: RefImage } | null>(null);
	const [noteModal, setNoteModal] = useState<NoteModalInitial | null>(null);
	const [confirm, setConfirm] = useState<{
		id: string;
		label: string;
		count: number;
		scenes: number;
		kind: "reference" | "note";
	} | null>(null);
	const [deleting, setDeleting] = useState(false);
	const [delErr, setDelErr] = useState<string | null>(null);

	/* Selected ids with no roster row behind them. Generation blocks on exactly
	 * this set, so the library names it rather than showing a selection that
	 * looks applied and renders nothing. */
	const unresolved = unresolvedSelections(pool, projectSelection.entityIds);
	const attachUnresolved = (id: string, entityId: string): void => {
		void attachProjectReferenceEntity(id, entityId)
			.then(() => {
				setPool?.((entries) =>
					entries.map((r) => (r.id === entityId ? { ...r, inRoster: true } : r)),
				);
			})
			.catch(() => {
				/* non-fatal: the generation preflight still reports it */
			});
	};

	const tierInput = { projectEntityIds: projectSelection.entityIds, sceneRefIds };
	const usage = usageMap({ projectEntityIds: projectSelection.entityIds, sceneCasts });
	const usedCount = (id: string): number => usage.get(id) ?? 0;
	const tier = (id: string): ReferenceTier => tierOf(id, tierInput);

	const images = pool.filter((r) => !isProductRef(r));
	const productRefs = pool.filter(isProductRef);
	const catImages = cat === "products" ? productRefs : images;

	const catalogueIds = new Set(initialProducts.map((p) => p.id));
	const savedProducts: CatalogueProduct[] = productRefs
		.filter((r) => !catalogueIds.has(r.id))
		.map((r) => ({
			id: r.id,
			label: r.label,
			kind: "product",
			src: r.imageUrl ?? "",
			note: r.description ?? "",
			price: null,
			url: r.prompt ?? "",
			seed: r.seed ?? 0,
			category_path: (r.tags ?? []).filter((t) => t !== "product").join(" / ") || null,
		}));
	const productList = [...initialProducts, ...savedProducts];

	/* Notes carry operator-authored tags; references do not — their tags are the
	 * role, and the reference list is already grouped by role, so a role chip row
	 * would filter by the same axis it is grouped on. */
	const tagChips = cat === "notes" ? [...new Set(refs.notes.flatMap(referenceTags))] : [];
	const ql = q.trim().toLowerCase();
	const matchQ = (label: string, note?: string, tags?: string[]): boolean =>
		!ql || (label + " " + (note || "") + " " + (tags || []).join(" ")).toLowerCase().includes(ql);
	const roleFilteredImages =
		roleFilter === "all" ? catImages : catImages.filter((r) => roleOfRef(r) === roleFilter);
	const imageList = (
		tag === "all"
			? roleFilteredImages
			: roleFilteredImages.filter((r) => referenceTags(r).includes(tag))
	).filter((r) => matchQ(r.label, r.description, r.tags));
	const noteList = (
		tag === "all" ? refs.notes : refs.notes.filter((n) => (n.tags ?? []).includes(tag))
	).filter((n) => matchQ(n.label, n.body, n.tags));
	const filteredProducts = productList.filter((p) => {
		const tags = p.category_path
			? p.category_path
					.split("/")
					.map((x) => x.trim())
					.filter(Boolean)
			: [];
		return (tag === "all" || tags.includes(tag)) && matchQ(p.label, p.note, tags);
	});

	// Role grouping, in every mode. Two panels used to group and one did not.
	const grouped = REF_KIND_ORDER.map((role) => ({
		role,
		meta: getKind(role),
		items: imageList.filter((r) => referenceDisplayRole(r) === role),
	})).filter((g) => g.items.length);

	/* An entity's role lives on the entity, so a role change is an in-place edit.
	 * Editing used to rewrite the tag array, which is how one entity could end up
	 * carrying two roles and appearing twice in a grouped list. */
	const saveEntity = (draft: EntityDraft): void => {
		const next = applyEntityDraft(draft, editor?.initial, () => `r${crypto.randomUUID()}`);
		setPool?.((entries) => upsertPool(entries, next));
		persistGlobalImage(next);
		setEditor(null);
	};

	const saveNote = (n: NotePayload): void => {
		const id = noteModal?.id ?? "note" + Date.now();
		setRefs((rr) => ({
			...rr,
			notes: rr.notes.some((x) => x.id === id)
				? rr.notes.map((x) => (x.id === id ? { ...x, ...n } : x))
				: [...rr.notes, { id, ...n, default: false }],
		}));
		if (projectId)
			persistNoteRef(projectId, id, n, refs.notes.find((x) => x.id === id)?.default ?? false);
		setNoteModal(null);
	};

	const askDelete = (id: string, label: string, kind: "reference" | "note" = "reference"): void => {
		setDelErr(null);
		setEditor(null);
		setNoteModal(null);
		setConfirm({ id, label, kind, count: usedCount(id), scenes: scenesStrandedBy(id, sceneCasts) });
	};

	/* A note lives in the note store, not the workspace asset registry. Routing it
	 * through `onDeleteRef` deleted an asset that does not exist and left the
	 * project_note row in place, so the note came back on the next reload. */
	const removeNote = async (id: string): Promise<boolean> => {
		if (projectId) {
			try {
				await deleteProjectNote(projectId, id);
			} catch {
				return false;
			}
		}
		setRefs((rr) => ({ ...rr, notes: rr.notes.filter((n) => n.id !== id) }));
		return true;
	};
	const confirmDelete = async (): Promise<void> => {
		if (!confirm) return;
		setDeleting(true);
		setDelErr(null);
		const ok =
			confirm.kind === "note" ? await removeNote(confirm.id) : await onDeleteRef(confirm.id);
		setDeleting(false);
		if (ok) setConfirm(null);
		else setDelErr(`Couldn’t delete on the server — the ${confirm.kind} was kept. Try again.`);
	};

	/* In a scene context, casting requires the project to have selected the entity
	 * first, so an unselected entity gets an explicit add-then-cast rather than a
	 * silent union. */
	const castOrAdd = (id: string): void => {
		if (!onToggleSceneRef) {
			onToggleProjectSelection(id);
			return;
		}
		if (tier(id) === "workspace") onToggleProjectSelection(id);
		onToggleSceneRef(id);
	};

	const renderCard = (r: RefImage): JSX.Element => {
		const t = tier(r.id);
		const used = usedCount(r.id);
		const inScene = sceneRefIds?.includes(r.id) ?? false;
		const placeable = draggableToTimeline && Boolean(r.imageUrl);
		return (
			<MediaCard
				key={r.id}
				draggable={placeable}
				hint={
					placeable
						? "Drag onto the timeline to place this image — selecting is what casts it for generation"
						: undefined
				}
				onDragStart={
					placeable
						? (e) => {
								writeMediaDragPayload(
									e.dataTransfer,
									{
										url: r.imageUrl!,
										kind: "image",
										label: r.label,
										source: "reference",
										// Not admitted yet: admission on drop names the asset and
										// records which workspace entity it came from.
										referenceEntityId: r.id,
									},
									e.currentTarget,
								);
							}
						: undefined
				}
				preview={
					<Frame
						generated={!r.imageUrl}
						src={r.imageUrl}
						seed={r.seed}
						aspect={1}
						w="100%"
						fit="contain"
					/>
				}
				overlay={
					<>
						{t !== "workspace" && (
							<FrameBadge corner="tr" className="tw:text-ai">
								{t === "scene" ? Ic.film(ICON.xs) : Ic.spark(ICON.xs)}
							</FrameBadge>
						)}
						{used > 0 && <FrameBadge corner="br">{used}</FrameBadge>}
					</>
				}
				title={r.label}
				meta={
					used > 0
						? `${TIER_LABEL[t]} · Used in ${used} place${used === 1 ? "" : "s"}`
						: TIER_LABEL[t]
				}
				label={`Edit ${r.label}`}
				onActivate={() => setEditor({ initial: r })}
				actions={
					<div className="cv-libcard-actions">
						<button
							className={`cv-textbtn ${t !== "workspace" ? "on" : ""}`}
							onClick={() => onToggleProjectSelection(r.id)}
							title={t === "workspace" ? "Select for this project" : "Remove from this project"}
						>
							{t === "workspace" ? "Select" : "Selected"}
						</button>
						{onToggleSceneRef && (
							<button
								className={`cv-textbtn ${inScene ? "on" : ""}`}
								onClick={() => castOrAdd(r.id)}
								title={inScene ? "Remove from scene" : "Cast in this scene"}
							>
								{inScene ? "In scene" : "Cast"}
							</button>
						)}
					</div>
				}
			/>
		);
	};

	const addMenu = (
		<div className="cv-libpanel-actions">
			<Button variant="secondary" size="sm" onClick={() => setEditor({})}>
				{Ic.plus(ICON.md)} New reference
			</Button>
			<Button
				variant="ghost"
				size="sm"
				onClick={() => setNoteModal({ label: "", body: "", tags: [] })}
			>
				{Ic.type(ICON.sm)} New note
			</Button>
		</div>
	);

	return (
		<>
			{mode !== "panel" && (
				<PanelHeader className="cv-libpanel-head" title="Reference library" onClose={onClose} />
			)}
			<div className={`tl2-panel-body cv-rail-inner cv-reflib mode-${mode}`}>
				<SearchField
					size="sm"
					label="Search references"
					placeholder="Search references…"
					value={q}
					onValueChange={setQ}
				/>
				{mode === "panel" && (
					<p className="fc-cap-desc">
						Workspace library. Select references to guide this project; drag images to place them on
						the timeline.
					</p>
				)}
				{addMenu}
				<div className="cv-catcat">
					{LIB_CATEGORIES.map((c) => {
						const n =
							c.key === "images"
								? images.length
								: c.key === "products"
									? productRefs.length
									: refs.notes.length;
						return (
							<button
								key={c.key}
								className={cat === c.key ? "on" : ""}
								onClick={() => {
									setCat(c.key);
									setTag("all");
									setRoleFilter("all");
								}}
							>
								{c.icon(12)} {c.label} <span>{n}</span>
							</button>
						);
					})}
				</div>

				{tagChips.length > 0 && (
					<div className="cv-cat-filters">
						<button className={tag === "all" ? "on" : ""} onClick={() => setTag("all")}>
							All
						</button>
						{tagChips.map((t) => (
							<button
								key={t}
								className={tag === t ? "on" : ""}
								onClick={() => setTag(tag === t ? "all" : t)}
							>
								{getKind(t).label}
							</button>
						))}
					</div>
				)}

				{cat === "images" && (
					<div className="cv-cat-filters cv-ref-role-filters" aria-label="Reference type filter">
						<button
							className={roleFilter === "all" ? "on" : ""}
							onClick={() => setRoleFilter("all")}
						>
							All
						</button>
						{REF_KIND_ORDER.map((role) => {
							const count = catImages.filter((ref) => roleOfRef(ref) === role).length;
							return (
								<button
									key={role}
									className={roleFilter === role ? "on" : ""}
									onClick={() => setRoleFilter(role)}
								>
									{getKind(role).label}
									<span>{count}</span>
								</button>
							);
						})}
					</div>
				)}

				{cat === "images" && unresolved.length > 0 && (
					/* Selected, and will not render. Generation blocks on exactly this
					 * set, so naming it here is what lets the operator fix it before a
					 * run instead of discovering it in the finished images. */
					<div className="cv-lib-unresolved" role="status">
						<div className="cv-lib-unresolved-head">
							{Ic.warning(ICON.xs)}{" "}
							{unresolved.length === 1
								? "1 selected reference will not render"
								: `${unresolved.length} selected references will not render`}
						</div>
						{unresolved.map((entry) => (
							<div key={entry.id} className="cv-lib-unresolved-row">
								<span className="cv-lib-unresolved-label">{entry.label}</span>
								<span className="cv-lib-unresolved-why">
									{entry.reason === "unattached"
										? "not attached to this project"
										: "no longer in this workspace"}
								</span>
								{/* Attach and Remove are genuinely different actions. Attaching
								    adds the roster row the lock is missing; removing drops the
								    id from the lock. Offered only where each can work — an
								    entity the workspace no longer has cannot be attached. */}
								{entry.reason === "unattached" && projectId && (
									<button
										className="cv-textbtn"
										onClick={() => {
											attachUnresolved(projectId, entry.id);
										}}
									>
										Attach
									</button>
								)}
								<button className="cv-textbtn" onClick={() => onToggleProjectSelection(entry.id)}>
									Remove
								</button>
							</div>
						))}
					</div>
				)}

				{cat === "images" && (
					<div className="cv-lib-groups">
						{grouped.map((g) => (
							<section key={g.role} className="cv-lib-group">
								<h4 className="cv-glib-gh" style={{ color: `oklch(0.5 0.13 ${g.meta.hue})` }}>
									{Ic[g.meta.iconName]?.(11)} {g.meta.label}{" "}
									<span className="cv-glib-count">{g.items.length}</span>
								</h4>
								<MediaGrid label={`${g.meta.label} references`} min={150} density="compact">
									{g.items.map(renderCard)}
								</MediaGrid>
							</section>
						))}
						{imageList.length === 0 && (
							<div className="cv-cat-empty">No references{q ? ` for “${q}”` : ""}.</div>
						)}
					</div>
				)}

				{cat === "products" && (
					<>
						<MediaGrid label="Saved products" min={150} density="compact">
							{filteredProducts.map((p) => {
								const t = tier(p.id);
								return (
									<MediaCard
										key={p.id}
										preview={
											<Frame
												generated={!p.src}
												src={p.src}
												seed={p.seed}
												aspect={1}
												w="100%"
												fit="contain"
											/>
										}
										overlay={
											t !== "workspace" ? (
												<FrameBadge corner="tr" className="tw:text-ai">
													{Ic.spark(ICON.xs)}
												</FrameBadge>
											) : null
										}
										title={p.label}
										meta={[
											p.category_path,
											p.price != null ? fmtPrice(p.price) : "",
											t !== "workspace" ? TIER_LABEL[t] : "",
										]
											.filter(Boolean)
											.join(" · ")}
										actions={
											<div className="cv-libcard-actions">
												<button
													className={`cv-textbtn ${t !== "workspace" ? "on" : ""}`}
													aria-pressed={t !== "workspace"}
													onClick={() => selectProduct(p)}
												>
													{t === "workspace" ? "Select" : "Selected"}
												</button>
											</div>
										}
									/>
								);
							})}
						</MediaGrid>
						{filteredProducts.length === 0 && (
							<div className="cv-cat-empty">No saved products{q ? ` for “${q}”` : ""}.</div>
						)}
					</>
				)}

				{cat === "notes" && (
					<div className="cv-libnotes">
						{noteList.map((n) => (
							<NoteRow
								key={n.id}
								note={n}
								inScene={sceneNoteIds?.includes(n.id) ?? false}
								onOpen={() =>
									setNoteModal({ id: n.id, label: n.label, body: n.body, tags: n.tags })
								}
								onToggleScene={onToggleSceneNote ? () => onToggleSceneNote(n.id) : undefined}
								onToggleDefault={() => toggleNoteDefault(n)}
							/>
						))}
						{noteList.length === 0 && (
							<div className="cv-cat-empty">No notes{q ? ` for “${q}”` : ""}.</div>
						)}
					</div>
				)}
			</div>

			{editor && (
				<EntityEditor
					initial={editor.initial}
					projectId={projectId}
					tier={editor.initial ? tier(editor.initial.id) : "workspace"}
					isPrimary={Boolean(editor.initial && primaryEntityId === editor.initial.id)}
					onSetPrimary={
						onSetPrimary && editor.initial
							? (next) => onSetPrimary(editor.initial!.id, next)
							: undefined
					}
					usedCount={editor.initial ? usedCount(editor.initial.id) : 0}
					onToggleProjectSelection={
						editor.initial ? () => onToggleProjectSelection(editor.initial!.id) : undefined
					}
					onDelete={
						editor.initial ? () => askDelete(editor.initial!.id, editor.initial!.label) : undefined
					}
					onClose={() => setEditor(null)}
					onSave={saveEntity}
				/>
			)}

			{noteModal && (
				<NoteModal
					initial={noteModal}
					onClose={() => setNoteModal(null)}
					onSave={saveNote}
					detail={
						noteModal.id
							? {
									usedCount: 0,
									isProjectRef: refs.notes.find((n) => n.id === noteModal.id)?.default ?? false,
									onToggleProjectRef: () => {
										const n = refs.notes.find((x) => x.id === noteModal.id);
										if (n) toggleNoteDefault(n);
									},
									onDuplicate: () => {
										/* handled through New note */
									},
									onDelete: () => askDelete(noteModal.id!, noteModal.label ?? "note", "note"),
								}
							: undefined
					}
				/>
			)}

			{confirm && (
				<DeleteConfirm
					label={confirm.label}
					kind={confirm.kind}
					count={confirm.count}
					scenes={confirm.scenes}
					deleting={deleting}
					error={delErr}
					onCancel={() => {
						setConfirm(null);
						setDelErr(null);
					}}
					onConfirm={confirmDelete}
				/>
			)}
		</>
	);

	function toggleNoteDefault(n: Note): void {
		const nextDefault = !n.default;
		setRefs((rr) => ({
			...rr,
			notes: rr.notes.map((x) => (x.id === n.id ? { ...x, default: nextDefault } : x)),
		}));
		if (projectId)
			persistNoteRef(
				projectId,
				n.id,
				{ label: n.label, body: n.body, tags: n.tags ?? [] },
				nextDefault,
			);
	}

	/* A catalogue product becomes a `product`-role entity keyed by its own id, then
	 * is selected like anything else. */
	function selectProduct(p: CatalogueProduct): void {
		const ref: RefImage = {
			id: p.id,
			label: p.label,
			imageUrl: p.src,
			seed: p.seed,
			role: "product",
			tags: [
				"product",
				...(p.category_path
					? p.category_path
							.split("/")
							.map((x) => x.trim())
							.filter(Boolean)
					: []),
			],
			description: p.note,
			prompt: p.url,
		};
		if (!pool.some((r) => r.id === p.id)) {
			setPool?.((entries) => upsertPool(entries, ref));
			persistGlobalImage(ref);
		}
		onToggleProjectSelection(p.id);
	}
}
