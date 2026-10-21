/* References: Images / Notes under one page, switched from the shared
 * library toolbar.
 *
 * The same pools the Create-Content References panel reads (catalogue images
 * and INIT_REFS notes) — a read-only browser over that
 * shared data, not a second copy of it.
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";
import {
	INIT_REFS,
	getKind,
	referenceDisplayRole,
	REF_KIND_ORDER,
} from "@models/references/reference-vocabulary.ts";
import type { Note, RefImage } from "@maleo/shared";
import { useContentCatalogue } from "@hooks/catalog/use-content-catalogue.ts";
import { LibraryHeader } from "./library-chrome.tsx";
import {
	EmptyState,
	ErrorState,
	LoadingState,
	collectionPhase,
} from "@design-system/patterns/collection.tsx";
import { LibraryToolbar } from "./library-toolbar.tsx";
import { useActiveWorkspace } from "@hooks/workspace/use-active-workspace.ts";
import { EntityEditor, type EntityDraft } from "@components/references/entity-editor.tsx";
import { applyEntityDraft } from "@models/references/entity-write.ts";
import {
	deleteWorkspaceReferenceEntity,
	saveWorkspaceReferenceEntity,
} from "@api/workspace-catalogue.ts";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { Button } from "@design-system/components/button.tsx";
import { MediaCard, MediaGrid } from "@design-system/patterns/media.tsx";
import { Chip } from "@design-system/components/chip.tsx";
import { Modal } from "@design-system/components/modal.tsx";

type RefTab = "images" | "notes";
type RoleFilter = (typeof REF_KIND_ORDER)[number];

const REF_TABS = [
	{ id: "images", label: "Images" },
	{ id: "notes", label: "Notes" },
] as const satisfies ReadonlyArray<{ id: RefTab; label: string }>;

const ROLE_GROUPS = REF_KIND_ORDER.map((role) => ({ id: role, label: getKind(role).label }));

export function filterReferenceImages(
	images: readonly RefImage[],
	q: string,
	role: RoleFilter | null,
): RefImage[] {
	const ql = q.trim().toLowerCase();
	return images
		.filter((r) => role == null || referenceDisplayRole(r) === role)
		.filter(
			(r) =>
				!ql ||
				`${r.label} ${r.description ?? ""} ${(r.tags ?? []).join(" ")}`.toLowerCase().includes(ql),
		);
}

function ReferenceImage({
	refImage,
	loading,
}: {
	refImage: RefImage;
	loading?: "lazy";
}): JSX.Element {
	const [failed, setFailed] = useState(false);
	if (!refImage.imageUrl || failed) return <span>{refImage.label.slice(0, 1).toUpperCase()}</span>;
	return (
		<img
			src={refImage.imageUrl}
			alt={refImage.label}
			loading={loading}
			onError={() => setFailed(true)}
		/>
	);
}

function Detail({
	refImage,
	onClose,
	onEdit,
}: {
	refImage: RefImage;
	onClose: () => void;
	onEdit: () => void;
}): JSX.Element {
	const role = referenceDisplayRole(refImage);
	return (
		<Modal
			title={refImage.label}
			sub="Reference details"
			onClose={onClose}
			width={560}
			dock
			bodyClassName="catalog-ref-detail"
		>
			<div
				className="catalog-ref-detail-media"
				style={{ background: `oklch(0.6 0.12 ${refImage.seed % 360})` }}
			>
				<ReferenceImage refImage={refImage} />
			</div>
			<div className="catalog-ref-detail-fields">
				<div>
					<span>Reference type</span>
					<strong>{getKind(role).label}</strong>
				</div>
				<div>
					<span>Input scenario</span>
					<p>{refImage.description?.trim() || "Always available"}</p>
				</div>
				{refImage.prompt?.trim() && (
					<div>
						<span>Prompt</span>
						<p>{refImage.prompt}</p>
					</div>
				)}
				<div>
					<span>Source</span>
					<p>{refImage.collection || refImage.workspace || refImage.id}</p>
				</div>
			</div>
			<div className="cv-modal-actions">
				<span style={{ flex: 1 }} />
				<Button variant="ghost" size="sm" onClick={onClose}>
					Close
				</Button>
				<Button variant="primary" size="sm" onClick={onEdit}>
					{Ic.edit(ICON.sm)} Edit
				</Button>
			</div>
		</Modal>
	);
}

function DeleteConfirm({
	refImage,
	busy,
	error,
	onCancel,
	onConfirm,
}: {
	refImage: RefImage;
	busy: boolean;
	error: string | null;
	onCancel: () => void;
	onConfirm: () => void;
}): JSX.Element {
	return (
		<Modal title="Delete reference?" sub={refImage.label} onClose={onCancel} width={400} dock>
			<div className="cv-reflib-confirm">
				<p>
					<b>{refImage.label}</b> will be removed from the workspace reference library and project
					rosters.
				</p>
				{error && (
					<div role="alert" className="cv-reflib-confirm-err">
						{error}
					</div>
				)}
				<div className="cv-modal-actions">
					<Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
						Cancel
					</Button>
					<Button variant="danger" size="sm" onClick={onConfirm} disabled={busy}>
						{busy ? "Deleting…" : "Delete"}
					</Button>
				</div>
			</div>
		</Modal>
	);
}

function ImagesTab({
	q,
	role,
	edited,
	onSaved,
}: {
	q: string;
	role: RoleFilter | null;
	edited: ReadonlyMap<string, RefImage>;
	onSaved: (ref: RefImage) => void;
}): JSX.Element {
	const workspace = useActiveWorkspace();
	const { images, loading, failed, reload } = useContentCatalogue();
	const [detailId, setDetailId] = useState<string | null>(null);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [deleteId, setDeleteId] = useState<string | null>(null);
	const [deleted, setDeleted] = useState<ReadonlySet<string>>(() => new Set());
	const [deleting, setDeleting] = useState(false);
	const [deleteError, setDeleteError] = useState<string | null>(null);

	const ql = q.trim().toLowerCase();
	const merged = useMemo(
		() =>
			images
				.map((image) => edited.get(image.id) ?? image)
				.filter((image) => !deleted.has(image.id)),
		[images, edited, deleted],
	);
	const filtered = useMemo(() => filterReferenceImages(merged, ql, role), [merged, ql, role]);
	const detail = detailId ? (merged.find((item) => item.id === detailId) ?? null) : null;
	const editing = editingId ? (merged.find((item) => item.id === editingId) ?? null) : null;
	const deleteTarget = deleteId ? (merged.find((item) => item.id === deleteId) ?? null) : null;
	const save = (draft: EntityDraft): void => {
		if (!editing) return;
		const next = applyEntityDraft(draft, editing, () => editing.id);
		void saveWorkspaceReferenceEntity(next)
			.then((saved) => {
				onSaved(saved);
				setEditingId(null);
				setDetailId(saved.id);
			})
			.catch(() => {
				/* non-fatal: editor stays open */
			});
	};
	const confirmDelete = (): void => {
		if (!deleteTarget) return;
		setDeleting(true);
		setDeleteError(null);
		void deleteWorkspaceReferenceEntity(deleteTarget.id)
			.then(() => {
				setDeleted((cur) => new Set(cur).add(deleteTarget.id));
				setDeleteId(null);
				setEditingId(null);
				setDetailId(null);
			})
			.catch((err) => setDeleteError(err instanceof Error ? err.message : String(err)))
			.finally(() => setDeleting(false));
	};

	const phase = collectionPhase({ count: images.length, loading, failed });
	if (phase === "loading") return <LoadingState label="Loading images…" />;
	if (phase === "failed")
		return (
			<ErrorState title="Could not load reference images" onRetry={reload} retrying={loading} />
		);
	// Names the workspace, and says which kind of empty it is: nothing matched a
	// search, versus this workspace's reference library being empty. References
	// are workspace-scoped, so the second is the ordinary case after scoping.
	if (filtered.length === 0) {
		return (
			<EmptyState
				label={
					ql
						? `No images in ${workspace} for “${q}”.`
						: `No reference images in ${workspace} yet. Add one, or switch workspace to see another's.`
				}
			/>
		);
	}
	return (
		<>
			<MediaGrid label="Reference images" min={160}>
				{filtered.map((r) => (
					<MediaCard
						key={r.id}
						preview={<ReferenceImage refImage={r} loading="lazy" />}
						fit="contain"
						ground={`oklch(0.6 0.12 ${r.seed % 360})`}
						title={r.label}
						meta={
							<>
								<Chip variant="inline">{getKind(referenceDisplayRole(r)).label}</Chip>
								{r.description && <span className="tw:mt-1 tw:block">{r.description}</span>}
							</>
						}
						onActivate={() => setDetailId(r.id)}
					/>
				))}
			</MediaGrid>
			{detail && !editing && !deleteTarget && (
				<Detail
					refImage={detail}
					onClose={() => setDetailId(null)}
					onEdit={() => setEditingId(detail.id)}
				/>
			)}
			{editing && !deleteTarget && (
				<EntityEditor
					initial={editing}
					mode="identity"
					onClose={() => setEditingId(null)}
					onSave={save}
					onDelete={() => {
						setDeleteError(null);
						setDeleteId(editing.id);
					}}
				/>
			)}
			{deleteTarget && (
				<DeleteConfirm
					refImage={deleteTarget}
					busy={deleting}
					error={deleteError}
					onCancel={() => setDeleteId(null)}
					onConfirm={confirmDelete}
				/>
			)}
		</>
	);
}

function NotesTab({ q }: { q: string }): JSX.Element {
	const [notes] = useState<Note[]>(INIT_REFS.notes);
	const ql = q.trim().toLowerCase();
	const filtered = useMemo(
		() => notes.filter((n) => !ql || `${n.label} ${n.body}`.toLowerCase().includes(ql)),
		[notes, ql],
	);
	if (filtered.length === 0) return <EmptyState label={`No notes${ql ? ` for “${q}”` : ""}.`} />;
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 680 }}>
			{filtered.map((n) => (
				<div key={n.id} className="collection-card" style={{ padding: "12px 14px" }}>
					<div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 3 }}>{n.label}</div>
					<div style={{ fontSize: 12.5, color: "var(--fg-dim)", lineHeight: 1.45 }}>{n.body}</div>
				</div>
			))}
		</div>
	);
}

/* Images / Notes are groups in the shared toolbar, not a tab strip of
 * this page's own. They were a second control pattern doing the same job the
 * library does everywhere else, and the search box sat below them on two groups
 * and vanished on the third — so switching group moved the search.
 *
 * `null` is not offered here: images and notes render through different
 * components, so there is no combined view to fall back to. */
export function ReferencesLibrary(): JSX.Element {
	const [tab, setTab] = useState<RefTab>("images");
	const [role, setRole] = useState<RoleFilter | null>(null);
	const [q, setQ] = useState("");
	const [edited, setEdited] = useState<ReadonlyMap<string, RefImage>>(new Map());
	const saveEdited = (ref: RefImage): void =>
		setEdited((current) => new Map(current).set(ref.id, ref));

	return (
		<div className="pg">
			<LibraryHeader type="references" />
			<LibraryToolbar
				query={q}
				onQuery={setQ}
				placeholder={`Search ${tab}`}
				groups={REF_TABS}
				group={tab}
				onGroup={(next) => {
					if (next) setTab(next);
				}}
				groupLabel="Reference source"
				allowAll={false}
				secondaryGroups={tab === "images" ? ROLE_GROUPS : undefined}
				secondaryGroup={role}
				onSecondaryGroup={tab === "images" ? setRole : undefined}
				secondaryGroupLabel="Reference type"
			/>
			{tab === "images" && <ImagesTab q={q} role={role} edited={edited} onSaved={saveEdited} />}
			{tab === "notes" && <NotesTab q={q} />}
		</div>
	);
}
