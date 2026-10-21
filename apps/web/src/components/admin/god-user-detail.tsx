import { Select } from "@design-system/components/select.tsx";
import { Input } from "@design-system/components/input.tsx";
import { useState, type JSX } from "react";
import type { AdminUser } from "@api/admin.ts";
import { useAdminActions } from "@hooks/admin/use-admin-actions.ts";
import { ConfirmAction } from "./confirm-action.tsx";

/* Actions that change who can administer or sign in, or destroy the account,
 * need the account's email typed back. Promotion is here too: it hands over
 * the whole deployment, which is more than any demotion takes away. */
type TypedAction = "promote" | "demote" | "suspend" | "delete";

const TYPED_LABEL: Record<TypedAction, string> = {
	promote: "Make instance owner",
	demote: "Remove instance owner",
	suspend: "Suspend account",
	delete: "Delete account",
};

export function GodUserDetail({
	user,
	onChanged,
	onDeleted,
	onOpenWorkspace,
}: {
	user: AdminUser;
	onChanged: () => void;
	onDeleted: () => void;
	onOpenWorkspace: (name: string) => void;
}): JSX.Element {
	const { api, run, busy, error } = useAdminActions(onChanged);
	const [confirm, setConfirm] = useState<TypedAction | null>(null);
	const [typed, setTyped] = useState("");
	const [workspace, setWorkspace] = useState("");
	const [role, setRole] = useState<"owner" | "member">("member");
	const verified = typed === user.email;
	const blocking = (user.workspaces ?? []).filter((w) => w.sole_owner).map((w) => w.name);

	const reset = () => {
		setConfirm(null);
		setTyped("");
	};
	const commit = async () => {
		if (!verified || !confirm) return;
		if (confirm === "promote") await run(() => api.setUserRole(user.id, "instance_owner"));
		if (confirm === "demote") await run(() => api.setUserRole(user.id, "member"));
		if (confirm === "suspend") await run(() => api.setUserSuspended(user.id, true));
		if (confirm === "delete" && (await run(() => api.deleteUser(user.id, user.email)))) onDeleted();
		reset();
	};

	return (
		<div className="god-detail-body">
			<div className="god-fields">
				<div>
					<span>Instance role</span>
					<strong>{user.role === "instance_owner" ? "Instance owner" : "Member"}</strong>
				</div>
				<div>
					<span>Status</span>
					<strong>{user.suspended ? "Suspended" : "Active"}</strong>
				</div>
				<div>
					<span>Account ID</span>
					<code>{user.id}</code>
				</div>
			</div>

			<section className="god-action-section">
				<h3>Account access</h3>
				<div className="god-actions">
					{user.role === "instance_owner" ? (
						<button type="button" disabled={busy} onClick={() => setConfirm("demote")}>
							Remove instance owner
						</button>
					) : (
						<button type="button" disabled={busy} onClick={() => setConfirm("promote")}>
							Make instance owner
						</button>
					)}
					{user.suspended ? (
						<button
							type="button"
							disabled={busy}
							onClick={() => void run(() => api.setUserSuspended(user.id, false))}
						>
							Restore account
						</button>
					) : (
						<button type="button" disabled={busy} onClick={() => setConfirm("suspend")}>
							Suspend account
						</button>
					)}
					<ConfirmAction
						label="Revoke sessions"
						confirmLabel="Sign out everywhere"
						disabled={busy}
						onConfirm={() => void run(() => api.revokeUserSessions(user.id))}
					/>
				</div>
				<p className="god-muted">Instance ownership does not grant workspace content access.</p>
			</section>

			<section className="god-action-section">
				<h3>Workspace access</h3>
				{user.workspaces?.length ? (
					<ul className="god-simple-list">
						{user.workspaces.map(({ name, role: workspaceRole, sole_owner }) => (
							<li key={name}>
								<span>
									<strong>{name}</strong>
									<small>{sole_owner ? "only owner" : workspaceRole}</small>
								</span>
								<ConfirmAction
									label="Remove"
									confirmLabel={`Remove from ${name}`}
									disabled={busy}
									onConfirm={() => void run(() => api.removeMember(name, user.id))}
								/>
							</li>
						))}
					</ul>
				) : (
					<p className="god-muted">No memberships.</p>
				)}
				<form
					className="god-inline-form"
					onSubmit={(event) => {
						event.preventDefault();
						if (workspace.trim()) void run(() => api.grantMember(workspace.trim(), user.id, role));
					}}
				>
					<Input
						aria-label="Workspace name"
						placeholder="Workspace name"
						value={workspace}
						onChange={(event) => setWorkspace(event.target.value)}
					/>
					<Select
						size="md"
						width="auto"
						aria-label="Workspace role"
						value={role}
						onValueChange={(event) => setRole(event === "owner" ? "owner" : "member")}
						options={[
							{ value: "member", label: "Member" },
							{ value: "owner", label: "Owner" },
						]}
					/>
					<button disabled={busy || !workspace.trim()}>Grant access</button>
				</form>
			</section>

			<section className="god-action-section god-danger">
				<h3>Delete account</h3>
				{blocking.length ? (
					<>
						<p>
							This account is the only owner of {blocking.join(", ")}. Make another member an owner
							there, then delete the account.
						</p>
						<div className="god-actions">
							{blocking.map((name) => (
								<button
									key={name}
									type="button"
									className="god-transfer"
									onClick={() => onOpenWorkspace(name)}
								>
									Transfer ownership of {name}
								</button>
							))}
						</div>
					</>
				) : (
					<>
						<p>Sessions and memberships are removed. Workspace content stays.</p>
						<button type="button" disabled={busy} onClick={() => setConfirm("delete")}>
							Delete account
						</button>
					</>
				)}
			</section>

			{confirm && (
				<section className="god-confirm" aria-label="Confirm account action">
					<h3>{TYPED_LABEL[confirm]}</h3>
					<p>
						Type <strong>{user.email}</strong> to continue.
					</p>
					<Input
						autoFocus
						aria-label="Confirm account email"
						value={typed}
						onChange={(event) => setTyped(event.target.value)}
					/>
					<div className="god-actions">
						<button type="button" disabled={!verified || busy} onClick={() => void commit()}>
							Confirm {confirm}
						</button>
						<button type="button" onClick={reset}>
							Cancel
						</button>
					</div>
				</section>
			)}
			{error && (
				<p className="god-error" role="alert">
					{error}
				</p>
			)}
		</div>
	);
}
