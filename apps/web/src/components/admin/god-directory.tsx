import { Input } from "@design-system/components/input.tsx";
import { useEffect, useRef, useState, type JSX } from "react";
import type { GodSection } from "@models/core/routing.ts";
import { useAdminDirectory } from "@hooks/admin/use-admin-directory.ts";
import { useAdminActions } from "@hooks/admin/use-admin-actions.ts";
import type { AdminProject, DirectoryItem } from "@api/admin.ts";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { GodPager } from "./god-pager.tsx";
import { GodUserDetail } from "./god-user-detail.tsx";
import { GodWorkspaceDetail } from "./god-workspace-detail.tsx";

type Kind = Extract<GodSection, "users" | "workspaces" | "projects">;

function keyOf(item: DirectoryItem): string {
	return "email" in item ? item.id : "name" in item ? item.name : item.id;
}
function labelOf(item: DirectoryItem): string {
	return "email" in item ? item.email : "display_name" in item ? item.display_name : item.title;
}
function metaOf(item: DirectoryItem): string {
	return "email" in item
		? item.role
		: "display_name" in item
			? `${item.project_count} projects`
			: `${item.workspace} · ${item.status}`;
}

export function GodDirectory({
	kind,
	id,
	onSelect,
	onOpenWorkspace,
}: {
	kind: Kind;
	id?: string;
	onSelect: (id?: string) => void;
	onOpenWorkspace: (name: string) => void;
}): JSX.Element {
	const [query, setQuery] = useState("");
	const [search, setSearch] = useState("");
	const [offset, setOffset] = useState(0);
	const detailHeading = useRef<HTMLHeadingElement>(null);
	const focusedId = useRef<string | undefined>(undefined);
	const { page, detail, loading, error, refresh } = useAdminDirectory<DirectoryItem>(
		kind,
		search,
		offset,
		id,
	);

	useEffect(() => {
		setOffset(0);
		setQuery("");
		setSearch("");
	}, [kind]);
	useEffect(() => {
		if (!id) {
			focusedId.current = undefined;
			return;
		}
		if (detail && focusedId.current !== id) {
			detailHeading.current?.focus();
			focusedId.current = id;
		}
	}, [id, detail]);

	const close = () => {
		const previous = id;
		onSelect();
		requestAnimationFrame(() => {
			const row = [...document.querySelectorAll<HTMLButtonElement>("[data-admin-row]")].find(
				(button) => button.dataset.adminRow === previous,
			);
			row?.focus();
		});
	};
	const title = kind[0]!.toUpperCase() + kind.slice(1);

	return (
		<div className={`god-directory${id ? " has-detail" : ""}`}>
			<section className="god-list" aria-label={`${title} directory`}>
				<div className="god-section-heading">
					<div>
						<p className="god-eyebrow">Management</p>
						<h1>{title}</h1>
					</div>
					<span className="god-count">{page?.total ?? "—"} total</span>
				</div>
				<form
					className="god-search"
					onSubmit={(event) => {
						event.preventDefault();
						setOffset(0);
						setSearch(query.trim());
					}}
				>
					<Input
						aria-label={`Search ${kind}`}
						placeholder={`Search ${kind}…`}
						value={query}
						onChange={(event) => setQuery(event.target.value)}
					/>
					<button type="submit">Search</button>
				</form>
				{kind === "workspaces" && (
					<CreateWorkspace
						onCreated={(name) => {
							refresh();
							onSelect(name);
						}}
					/>
				)}
				{error && (
					<p className="god-error" role="alert">
						{error}
					</p>
				)}
				{loading && !page && <p className="god-muted">Loading {kind}…</p>}
				{page?.items.length === 0 && <p className="god-empty">No {kind} match this search.</p>}
				<div className="god-rows">
					{page?.items.map((item) => (
						<button
							key={keyOf(item)}
							type="button"
							data-admin-row={keyOf(item)}
							className={`god-row${id === keyOf(item) ? " selected" : ""}`}
							onClick={() => onSelect(keyOf(item))}
						>
							<span>
								<strong>{labelOf(item)}</strong>
								<small>{metaOf(item)}</small>
							</span>
							<span aria-hidden="true">{Ic.chevR(ICON.md)}</span>
						</button>
					))}
				</div>
				{page && <GodPager offset={offset} total={page.total} onOffset={setOffset} />}
			</section>
			{id && (
				<section className="god-detail" aria-label={`${title} detail`}>
					<button type="button" className="god-back" onClick={close}>
						{Ic.chevronLeft(ICON.sm)} Back to {title}
					</button>
					{loading && !detail && <p className="god-muted">Loading detail…</p>}
					{!loading && !detail && (
						<p className="god-error" role="alert">
							Detail unavailable.
						</p>
					)}
					{detail && (
						<>
							<h2 ref={detailHeading} tabIndex={-1}>
								{labelOf(detail)}
							</h2>
							{kind === "users" && "email" in detail && (
								<GodUserDetail
									user={detail}
									onChanged={refresh}
									onDeleted={close}
									onOpenWorkspace={onOpenWorkspace}
								/>
							)}
							{kind === "workspaces" && "display_name" in detail && (
								<GodWorkspaceDetail workspace={detail} onChanged={refresh} onDeleted={close} />
							)}
							{kind === "projects" && "title" in detail && <ProjectDetail project={detail} />}
						</>
					)}
				</section>
			)}
		</div>
	);
}

/* A new workspace always has a named owner: the API refuses one without, so a
 * tenant can never exist that nobody can manage from its own surface. */
function CreateWorkspace({ onCreated }: { onCreated: (name: string) => void }): JSX.Element {
	const { api, run, busy, error } = useAdminActions(() => {});
	const [name, setName] = useState("");
	const [display, setDisplay] = useState("");
	const [owner, setOwner] = useState("");
	const ready = name.trim() && owner.trim();
	const submit = async () => {
		const key = name.trim();
		if (!ready) return;
		if (await run(() => api.createWorkspace(key, owner.trim(), display.trim() || key))) {
			setName("");
			setDisplay("");
			setOwner("");
			onCreated(key);
		}
	};
	return (
		<form
			className="god-create-workspace"
			onSubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
		>
			<details>
				<summary>Create workspace</summary>
				<div className="god-inline-form">
					<Input
						aria-label="New workspace key"
						placeholder="Workspace key"
						value={name}
						onChange={(event) => setName(event.target.value)}
					/>
					<Input
						aria-label="New workspace display name"
						placeholder="Display name"
						value={display}
						onChange={(event) => setDisplay(event.target.value)}
					/>
					<Input
						aria-label="Owner email"
						type="email"
						placeholder="Owner email"
						value={owner}
						onChange={(event) => setOwner(event.target.value)}
					/>
					<button disabled={busy || !ready}>Create</button>
				</div>
				{error && (
					<p className="god-error" role="alert">
						{error}
					</p>
				)}
			</details>
		</form>
	);
}

function ProjectDetail({ project }: { project: AdminProject }): JSX.Element {
	return (
		<div className="god-fields">
			<div>
				<span>Workspace</span>
				<strong>{project.workspace}</strong>
			</div>
			<div>
				<span>Type</span>
				<strong>{project.type}</strong>
			</div>
			<div>
				<span>Status</span>
				<strong>{project.status}</strong>
			</div>
			<div>
				<span>Project ID</span>
				<code>{project.id}</code>
			</div>
			<p className="god-muted">Project content requires workspace membership.</p>
		</div>
	);
}
