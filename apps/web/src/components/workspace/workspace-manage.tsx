/* The workspace surface: General, Members, and — set apart — the Danger Zone.
 *
 * The separation before the last group is structural, not decorative. Everything
 * above it is reversible; the thing below it is not, and a reader scanning a
 * settings page should not meet an irreversible control in the same rhythm as a
 * text field.
 *
 * Controls a member cannot use are not rendered at all, rather than rendered
 * disabled. A disabled button still says "this is a thing you could do here",
 * which is the wrong message for somebody who will never be allowed to.
 */
import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Button } from "@design-system/components/button.tsx";
import { Field } from "@design-system/components/field.tsx";
import { Input, Textarea } from "@design-system/components/input.tsx";
import { useWorkspaceAdmin } from "@hooks/workspace/use-workspace-admin.ts";
import { WORKSPACE_PANELS, type WorkspacePanel } from "@models/core/routing.ts";

const PANEL_LABEL: Record<WorkspacePanel, string> = {
	general: "General",
	members: "Members",
	danger: "Danger Zone",
};

export interface WorkspaceManageProps {
	workspace: string;
	panel: WorkspacePanel;
	onPanel: (panel: WorkspacePanel) => void;
	/** Called after the workspace is gone, so the shell can move elsewhere. */
	onDeleted: () => void;
}

export function WorkspaceManage({
	workspace,
	panel,
	onPanel,
	onDeleted,
}: WorkspaceManageProps): JSX.Element {
	const admin = useWorkspaceAdmin(workspace);

	if (admin.loading && !admin.detail) {
		return (
			<div className="wsm-shell">
				<p className="wsm-muted">Loading…</p>
			</div>
		);
	}

	return (
		<div className="wsm-shell">
			<nav className="wsm-nav" aria-label="Workspace sections">
				{WORKSPACE_PANELS.map((p) => (
					<div key={p} className={p === "danger" ? "wsm-nav-danger" : undefined}>
						{/* The separator is a real element, not a margin: the group below
						    it is different in kind, and a gap alone does not say so. */}
						{p === "danger" && <hr className="wsm-sep" />}
						<button
							type="button"
							className={`wsm-nav-item${panel === p ? " active" : ""}${p === "danger" ? " danger" : ""}`}
							onClick={() => onPanel(p)}
							aria-current={panel === p ? "page" : undefined}
						>
							{PANEL_LABEL[p]}
						</button>
					</div>
				))}
			</nav>

			<section className="wsm-panel">
				{admin.error && (
					<p className="wsm-error" role="alert">
						{admin.error}
					</p>
				)}
				{panel === "general" && <GeneralPanel admin={admin} />}
				{panel === "members" && <MembersPanel admin={admin} />}
				{panel === "danger" && (
					<DangerPanel admin={admin} workspace={workspace} onDeleted={onDeleted} />
				)}
			</section>
		</div>
	);
}

type Admin = ReturnType<typeof useWorkspaceAdmin>;

function GeneralPanel({ admin }: { admin: Admin }): JSX.Element {
	const [displayName, setDisplayName] = useState("");
	const [description, setDescription] = useState("");
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);

	// Seeded from the server, and re-seeded when it answers again.
	useEffect(() => {
		setDisplayName(admin.detail?.display_name ?? "");
		setDescription(admin.detail?.description ?? "");
	}, [admin.detail]);

	if (!admin.isOwner) {
		return (
			<>
				<h2 className="wsm-title">General</h2>
				<p className="wsm-muted">{admin.detail?.description || "No description."}</p>
				<p className="wsm-note">Only a workspace owner can change these.</p>
			</>
		);
	}

	const submit = async (): Promise<void> => {
		setSaving(true);
		setSaved(false);
		try {
			// null, not "", so clearing the field clears the column rather than
			// storing an empty string that reads back as a description.
			await admin.save({ display_name: displayName, description: description.trim() || null });
			setSaved(true);
		} catch {
			/* The hook holds the message; the panel above renders it. */
		} finally {
			setSaving(false);
		}
	};

	return (
		<>
			<h2 className="wsm-title">General</h2>
			<Field>
				<span className="wsm-label">Display name</span>
				<Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
				<span className="wsm-help">
					What this workspace is called. Its address and its data are unaffected.
				</span>
			</Field>
			<Field>
				<span className="wsm-label">Description</span>
				<Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
			</Field>
			<div className="wsm-actions">
				<Button variant="primary" onClick={() => void submit()} disabled={saving}>
					{saving ? "Saving…" : "Save changes"}
				</Button>
				{saved && <span className="wsm-ok">Saved.</span>}
			</div>
		</>
	);
}

function MembersPanel({ admin }: { admin: Admin }): JSX.Element {
	const [link, setLink] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	const invite = async (): Promise<void> => {
		setCopied(false);
		try {
			const token = await admin.invite();
			// A whole URL, because the operator has to send it to somebody.
			setLink(`${window.location.origin}/invite/${token}`);
		} catch {
			/* Rendered by the panel above. */
		}
	};

	const copy = async (): Promise<void> => {
		if (!link) return;
		try {
			await navigator.clipboard.writeText(link);
			setCopied(true);
		} catch {
			// Clipboard access can be refused. The link is on screen and
			// selectable, so this is a missing convenience rather than a failure.
			setCopied(false);
		}
	};

	return (
		<>
			<h2 className="wsm-title">Members</h2>
			<ul className="wsm-list">
				{(admin.members?.items ?? []).map((m) => (
					<li key={m.user_id} className="wsm-row">
						<span className="wsm-row-main">
							{/* Name if they gave one, then email, and the raw id only when
							    the account itself is gone — which is a state worth seeing
							    rather than hiding, because the membership still grants
							    access until someone removes it. */}
							{m.name || m.email || m.user_id}
							{m.name && m.email && <span className="wsm-row-sub">{m.email}</span>}
							{m.is_you && <span className="wsm-tag">you</span>}
						</span>
						<span className="wsm-row-role">{m.role}</span>
						{admin.isOwner && (
							<Button
								variant="ghost"
								size="sm"
								onClick={() => void admin.remove(m.user_id).catch(() => {})}
							>
								Remove
							</Button>
						)}
					</li>
				))}
			</ul>

			{admin.isOwner && (
				<>
					<h3 className="wsm-subtitle">Invitations</h3>
					<ul className="wsm-list">
						{(admin.members?.invitations ?? []).map((i) => (
							<li key={i.id} className="wsm-row">
								<span className="wsm-row-main">
									Invitation · {i.role}
									<span className="wsm-tag">
										expires {new Date(i.expires_at).toLocaleDateString()}
									</span>
								</span>
								<Button
									variant="ghost"
									size="sm"
									onClick={() => void admin.revoke(i.id).catch(() => {})}
								>
									Revoke
								</Button>
							</li>
						))}
						{(admin.members?.invitations ?? []).length === 0 && (
							<li className="wsm-muted">No pending invitations.</li>
						)}
					</ul>

					<div className="wsm-actions">
						<Button variant="primary" onClick={() => void invite()}>
							Create invite link
						</Button>
					</div>

					{link && (
						<div className="wsm-invite">
							{/* Shown once. The token is not stored in plaintext, so there is
							    no way to retrieve this later — mint another instead. */}
							<p className="wsm-help">
								Copy this now — it is shown once, works once, and expires in 48 hours.
							</p>
							<div className="wsm-invite-row">
								<Input readOnly value={link} onFocus={(e) => e.target.select()} />
								<Button variant="secondary" onClick={() => void copy()}>
									{copied ? "Copied" : "Copy"}
								</Button>
							</div>
						</div>
					)}
				</>
			)}
		</>
	);
}

function DangerPanel({
	admin,
	workspace,
	onDeleted,
}: {
	admin: Admin;
	workspace: string;
	onDeleted: () => void;
}): JSX.Element {
	const [typed, setTyped] = useState("");
	const [working, setWorking] = useState(false);

	if (!admin.isOwner) {
		return (
			<>
				<h2 className="wsm-title">Danger Zone</h2>
				<p className="wsm-note">Only a workspace owner can delete this workspace.</p>
			</>
		);
	}

	const matches = typed === workspace;

	const destroy = async (): Promise<void> => {
		setWorking(true);
		try {
			await admin.destroy(typed);
			onDeleted();
		} catch {
			setWorking(false);
		}
	};

	return (
		<>
			<h2 className="wsm-title">Danger Zone</h2>
			<div className="wsm-danger">
				<h3 className="wsm-subtitle">Delete this workspace</h3>
				{/* Naming what goes is the point. An operator who has not been told
				    that renders and generation history go with it will find out
				    afterwards, and there is no afterwards to fix it in. */}
				<p className="wsm-help">
					This permanently deletes <strong>{admin.detail?.display_name}</strong> and everything in
					it: {admin.detail?.project_count ?? 0} project
					{admin.detail?.project_count === 1 ? "" : "s"}, their storyboards, renders and outputs,
					generation history, references, voice clones, uploaded files, and this workspace&rsquo;s
					credit balance. Running jobs are cancelled. This cannot be undone.
				</p>
				<Field>
					<span className="wsm-label">
						Type <code>{workspace}</code> to confirm
					</span>
					<Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
				</Field>
				<Button variant="danger" disabled={!matches || working} onClick={() => void destroy()}>
					{working ? "Deleting…" : "Delete this workspace"}
				</Button>
			</div>
		</>
	);
}
