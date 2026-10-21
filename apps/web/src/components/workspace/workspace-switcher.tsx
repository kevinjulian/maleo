/* The active workspace, shown and changed.
 *
 * Two exports for two placements of the same idea: `WorkspaceChip` is the
 * identity on its own (the mobile topbar, the collapsed rail), and
 * `WorkspaceSwitcher` is the chip plus the panel that changes it (the sidebar).
 *
 * It invents no visual language. Colour, initials and display name come from the
 * registry, which derives all three from the workspace name, so a workspace
 * created a minute ago renders correctly with no configuration and no palette
 * collision.
 *
 * The panel shows a per-workspace count because after scoping, five of the six
 * registered workspaces own nothing. A count turns a surprising empty app into
 * an expected one BEFORE the operator commits to the switch — the same job the
 * empty states do after it. */
import { useCallback, useState, type JSX } from "react";
import type { WorkspacePanel } from "@models/core/routing.ts";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import type { WorkspaceSummary } from "@api/workspaces.ts";
import { useWorkspaceRegistry } from "@hooks/workspace/use-workspace-registry.ts";
import { useWorkspaceSwitch } from "@hooks/workspace/use-active-workspace.ts";
import { Avatar } from "@design-system/components/avatar.tsx";
import { Button } from "@design-system/components/button.tsx";
import { Input } from "@design-system/components/input.tsx";
import { Note } from "@design-system/components/note.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "@design-system/components/popover.tsx";

/** Enough of a workspace to render its identity. The registry supplies the rest;
 *  this is what the chip actually needs, so a caller with only a name can still
 *  render something honest. */
export interface WorkspaceIdentity {
	name: string;
	display_name: string;
	color: string;
	initials: string;
}

function identityOf(name: string, known: WorkspaceSummary[]): WorkspaceIdentity {
	const row = known.find((w) => w.name === name);
	if (row) return row;
	// Before the registry loads there is still an active workspace, and the chip
	// is the thing that says which. Rendering nothing here would make the active
	// workspace briefly invisible on every load — the one property this component
	// exists to hold.
	return {
		name,
		display_name: name,
		color: "var(--muted)",
		initials: name.slice(0, 2).toUpperCase(),
	};
}

/* The workspace's identity mark: the shared Avatar, square, on the colour the
 * registry derived. */
function WorkspaceChip({
	workspace,
	size = "md",
}: {
	workspace: WorkspaceIdentity;
	size?: "sm" | "md";
}) {
	return (
		<Avatar
			name={workspace.display_name}
			initials={workspace.initials}
			color={workspace.color}
			shape="square"
			size={size}
		/>
	);
}

function countLabel(count: number): string {
	if (count === 0) return "no projects yet";
	return `${count.toLocaleString()} project${count === 1 ? "" : "s"}`;
}

/* The create form lives inside the panel rather than behind a separate route:
 * an operator adds a workspace at the moment they discover the one they want
 * does not exist, which is while they are looking at the list. */
function CreateWorkspaceForm({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const submit = async (event: React.FormEvent) => {
		event.preventDefault();
		if (busy || !name.trim()) return;
		setBusy(true);
		setError(null);
		try {
			await onCreate(name.trim());
			setName("");
			setOpen(false);
		} catch (err) {
			// Surfaced, not swallowed: "workspace_exists" and an invalid name are
			// both things the operator can fix, and a form that just does nothing
			// tells them neither.
			setError(err instanceof Error ? err.message : "could not create workspace");
		} finally {
			setBusy(false);
		}
	};

	if (!open) {
		return (
			<Button variant="ghost" size="sm" className="ws-create-open" onClick={() => setOpen(true)}>
				{Ic.plus(ICON.sm)} New workspace
			</Button>
		);
	}

	return (
		<form className="ws-create" onSubmit={submit}>
			<Input
				size="sm"
				value={name}
				autoFocus
				placeholder="workspace name"
				aria-label="new workspace name"
				aria-invalid={error ? true : undefined}
				onChange={(e) => setName(e.target.value)}
			/>
			<Button type="submit" variant="secondary" size="sm" loading={busy} disabled={!name.trim()}>
				Add
			</Button>
			{error && (
				<Note tone="error" role="alert" className="ws-create-error">
					{error}
				</Note>
			)}
		</form>
	);
}

const MANAGE_LINKS: ReadonlyArray<{ panel: WorkspacePanel; label: string; icon: JSX.Element }> = [
	{ panel: "general", label: "Workspace settings", icon: Ic.settings(ICON.sm) },
	{ panel: "members", label: "Members", icon: Ic.users(ICON.sm) },
];

interface WorkspaceSwitcherProps {
	/** Collapsed rail: the chip survives as initials on its colour, and the name
	 *  and count go with the wordmark. */
	collapsed?: boolean;
	/** Rendered open on mount, for the mobile chip which opens the switcher
	 *  directly rather than the whole drawer. */
	defaultOpen?: boolean;
	onDismiss?: () => void;
	/** Opens a panel of the workspace surface. The sidebar has no section of its
	 *  own for it any more, so this menu is the way in; without a handler (the
	 *  editor topbars) the entries are not offered. */
	onNavigate?: (panel: WorkspacePanel) => void;
	/** The workspace surface is the current route. */
	current?: boolean;
}

export function WorkspaceSwitcher({
	collapsed,
	defaultOpen,
	onDismiss,
	onNavigate,
	current,
}: WorkspaceSwitcherProps) {
	const [active, switchTo] = useWorkspaceSwitch();
	const { items, loading, error, create } = useWorkspaceRegistry();
	const [open, setOpen] = useState(defaultOpen === true);
	const identity = identityOf(active, items);

	const choose = useCallback(
		(name: string) => {
			// Immediate and unconfirmed. The action is reversible and the workspace is
			// in the address, so a prompt would charge friction on every switch to
			// guard a mistake that costs one action to undo. Every scoped surface
			// re-reads from the store, so this one call re-scopes content, materials,
			// references and images together.
			switchTo(name);
			setOpen(false);
			onDismiss?.();
		},
		[switchTo, onDismiss],
	);

	const activeCount = items.find((w) => w.name === active)?.project_count;

	return (
		/* The shared Popover owns placement, collision, dismissal and focus
		 * return, and follows its trigger when the page scrolls or resizes. */
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) onDismiss?.();
			}}
		>
			<div className={`ws-root${collapsed ? " collapsed" : ""}`}>
				<PopoverTrigger asChild>
					<button
						type="button"
						className="ws-current tw:aria-[current=page]:bg-secondary"
						aria-current={current ? "page" : undefined}
						title={`Workspace: ${identity.display_name}`}
					>
						<WorkspaceChip workspace={identity} />
						{!collapsed && (
							<span className="ws-current-text">
								<span className="ws-current-name">{identity.display_name}</span>
								<span className="ws-current-sub">
									{activeCount === undefined ? " " : countLabel(activeCount)}
								</span>
							</span>
						)}
						{!collapsed && <span className="ws-caret">{Ic.chevronDown(ICON.sm)}</span>}
					</button>
				</PopoverTrigger>

				<PopoverContent
					side="bottom"
					align="start"
					className="ws-panel tw:p-1"
					aria-label="Switch workspace"
				>
					{loading && (
						<Note tone="muted" className="ws-note">
							Loading workspaces…
						</Note>
					)}
					{/* Failure and emptiness are told apart here for the same reason
					    they are on every scoped surface: a correct empty list and a
					    failed load look identical otherwise. */}
					{error && (
						<Note tone="error" role="alert" className="ws-note">
							Could not load workspaces. {error}
						</Note>
					)}
					{!loading && !error && items.length === 0 && (
						<Note tone="muted" className="ws-note">
							No workspaces yet. Add one below.
						</Note>
					)}
					{items.map((workspace) => (
						<button
							key={workspace.name}
							type="button"
							className="ws-option"
							aria-pressed={workspace.name === active}
							onClick={() => choose(workspace.name)}
						>
							<WorkspaceChip workspace={workspace} size="sm" />
							<span className="ws-option-text">
								<span className="ws-option-name">{workspace.display_name}</span>
								<span className="ws-option-sub">{countLabel(workspace.project_count)}</span>
							</span>
							{workspace.name === active && (
								<span className="ws-option-check">{Ic.check(ICON.sm)}</span>
							)}
						</button>
					))}
					{onNavigate && (
						<div className="ws-manage">
							{MANAGE_LINKS.map(({ panel, label, icon }) => (
								<button
									key={panel}
									type="button"
									className="ws-option"
									onClick={() => {
										setOpen(false);
										onDismiss?.();
										onNavigate(panel);
									}}
								>
									<span className="ws-option-icon">{icon}</span>
									<span className="ws-option-name">{label}</span>
								</button>
							))}
						</div>
					)}
					<CreateWorkspaceForm
						onCreate={async (name) => {
							await create(name);
							choose(name);
						}}
					/>
				</PopoverContent>
			</div>
		</Popover>
	);
}
