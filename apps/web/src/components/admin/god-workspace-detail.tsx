import { Select } from "@design-system/components/select.tsx";
import { Input, Textarea } from "@design-system/components/input.tsx";
import { useEffect, useState, type JSX } from "react";
import type { AdminWorkspace, DeleteImpact } from "@api/admin.ts";
import { useAdminActions } from "@hooks/admin/use-admin-actions.ts";
import { ConfirmAction } from "./confirm-action.tsx";

export function GodWorkspaceDetail({
	workspace,
	onChanged,
	onDeleted,
}: {
	workspace: AdminWorkspace;
	onChanged: () => void;
	onDeleted: () => void;
}): JSX.Element {
	const { api, run, busy, error } = useAdminActions(onChanged);
	const [display, setDisplay] = useState(workspace.display_name);
	const [description, setDescription] = useState(workspace.description ?? "");
	const [memberId, setMemberId] = useState("");
	const [memberRole, setMemberRole] = useState<"owner" | "member">("member");
	const [inviteRole, setInviteRole] = useState<"owner" | "member">("member");
	const [inviteToken, setInviteToken] = useState<string | null>(null);
	const [confirm, setConfirm] = useState("");
	const [confirmImpact, setConfirmImpact] = useState(false);
	const [impact, setImpact] = useState<DeleteImpact | null>(null);

	useEffect(() => {
		setDisplay(workspace.display_name);
		setDescription(workspace.description ?? "");
	}, [workspace.name, workspace.display_name, workspace.description]);

	/* Re-read on every refresh of the workspace, not once per name: a member
	 * change in this panel changes who would lose access, and an acknowledgement
	 * given for the old impact must not carry over to the new one. */
	useEffect(() => {
		let live = true;
		setImpact(null);
		setConfirmImpact(false);
		api
			.getWorkspaceDeleteImpact(workspace.name)
			.then((r) => {
				if (live) setImpact(r.item);
			})
			.catch(() => {
				if (live) setImpact(null);
			});
		return () => {
			live = false;
		};
	}, [workspace]);

	const mint = async () => {
		const result = await run(() => api.mintInvite(workspace.name, inviteRole));
		if (result) setInviteToken(result.item.token);
	};
	const remove = async () => {
		if (!impact) return;
		const result = await run(() =>
			api.deleteWorkspace(
				workspace.name,
				impact.losing_access.map((a) => a.id),
			),
		);
		if (result) onDeleted();
	};

	return (
		<div className="god-detail-body">
			<div className="god-fields">
				<div>
					<span>Workspace key</span>
					<code>{workspace.name}</code>
				</div>
				<div>
					<span>Status</span>
					<strong>{workspace.status}</strong>
				</div>
				<div>
					<span>Projects</span>
					<strong>{workspace.project_count}</strong>
				</div>
				<div>
					<span>Last activity</span>
					<strong>
						{workspace.last_activity ? new Date(workspace.last_activity).toLocaleString() : "None"}
					</strong>
				</div>
			</div>

			<section className="god-action-section">
				<h3>Workspace details</h3>
				<form
					className="god-form"
					onSubmit={(event) => {
						event.preventDefault();
						void run(() =>
							api.updateWorkspace(workspace.name, { display_name: display, description }),
						);
					}}
				>
					<label>
						Display name
						<Input value={display} onChange={(event) => setDisplay(event.target.value)} />
					</label>
					<label>
						Description
						<Textarea
							rows={3}
							value={description}
							onChange={(event) => setDescription(event.target.value)}
						/>
					</label>
					<button disabled={busy || !display.trim()}>Save workspace</button>
				</form>
			</section>

			<section className="god-action-section">
				<h3>Members</h3>
				{workspace.members?.length ? (
					<ul className="god-simple-list">
						{workspace.members.map((member) => {
							const who = member.name || member.email || member.user_id;
							const next = member.role === "owner" ? "member" : "owner";
							return (
								<li key={member.user_id}>
									<span>
										<strong>{who}</strong>
										<small>{member.role}</small>
									</span>
									<div className="god-actions">
										<ConfirmAction
											label={`Make ${next}`}
											confirmLabel={`Make ${who} ${next}`}
											disabled={busy}
											onConfirm={() =>
												void run(() => api.grantMember(workspace.name, member.user_id, next))
											}
										/>
										<ConfirmAction
											label="Remove"
											confirmLabel={`Remove ${who}`}
											disabled={busy}
											onConfirm={() =>
												void run(() => api.removeMember(workspace.name, member.user_id))
											}
										/>
									</div>
								</li>
							);
						})}
					</ul>
				) : (
					<p className="god-muted">No members.</p>
				)}
				<form
					className="god-inline-form"
					onSubmit={(event) => {
						event.preventDefault();
						if (memberId.trim())
							void run(() => api.grantMember(workspace.name, memberId.trim(), memberRole));
					}}
				>
					<Input
						aria-label="Account ID"
						placeholder="Account ID"
						value={memberId}
						onChange={(event) => setMemberId(event.target.value)}
					/>
					<Select
						size="md"
						width="auto"
						aria-label="New member role"
						value={memberRole}
						onValueChange={(event) => setMemberRole(event === "owner" ? "owner" : "member")}
						options={[
							{ value: "member", label: "Member" },
							{ value: "owner", label: "Owner" },
						]}
					/>
					<button disabled={busy || !memberId.trim()}>Add member</button>
				</form>
			</section>

			<section className="god-action-section">
				<h3>Invitations</h3>
				{workspace.invitations?.length ? (
					<ul className="god-simple-list">
						{workspace.invitations.map((invite) => (
							<li key={invite.id}>
								<span>
									{invite.role} · expires {new Date(invite.expires_at).toLocaleDateString()}
								</span>
								<ConfirmAction
									label="Revoke"
									confirmLabel="Revoke invitation"
									disabled={busy}
									onConfirm={() => void run(() => api.revokeInvite(workspace.name, invite.id))}
								/>
							</li>
						))}
					</ul>
				) : (
					<p className="god-muted">No pending invitations.</p>
				)}
				<div className="god-inline-form">
					<Select
						size="md"
						width="auto"
						aria-label="Invitation role"
						value={inviteRole}
						onValueChange={(event) => setInviteRole(event === "owner" ? "owner" : "member")}
						options={[
							{ value: "member", label: "Member" },
							{ value: "owner", label: "Owner" },
						]}
					/>
					<button type="button" disabled={busy} onClick={() => void mint()}>
						Create invitation
					</button>
				</div>
				{inviteToken && (
					<div className="god-once">
						<strong>Invitation token · shown once</strong>
						<code>{inviteToken}</code>
						<button
							type="button"
							onClick={() =>
								void navigator.clipboard.writeText(`${location.origin}/invite/${inviteToken}`)
							}
						>
							Copy invite link
						</button>
					</div>
				)}
			</section>

			<section className="god-action-section god-danger">
				<h3>Delete workspace</h3>
				<p>
					{impact
						? `${impact.affected_accounts} affected accounts · ${impact.project_count} projects · ${impact.in_flight_runs} active runs`
						: "Loading impact…"}
				</p>
				{impact?.losing_access.length ? (
					<>
						<p>These accounts will lose their only workspace:</p>
						<ul className="god-impact-list">
							{impact.losing_access.map((account) => (
								<li key={account.id}>{account.email}</li>
							))}
						</ul>
					</>
				) : null}
				{impact?.final_workspace && <p className="god-error">Final workspace cannot be deleted.</p>}
				<label>
					Type {workspace.name} to confirm
					<Input value={confirm} onChange={(event) => setConfirm(event.target.value)} />
				</label>
				<label className="god-impact-confirm">
					<input
						type="checkbox"
						checked={confirmImpact}
						onChange={(event) => setConfirmImpact(event.target.checked)}
					/>
					I understand this impact
				</label>
				<button
					type="button"
					disabled={
						busy ||
						!impact ||
						impact.final_workspace ||
						!confirmImpact ||
						confirm !== workspace.name
					}
					onClick={() => void remove()}
				>
					Delete workspace
				</button>
			</section>
			{error && (
				<p className="god-error" role="alert">
					{error}
				</p>
			)}
		</div>
	);
}
