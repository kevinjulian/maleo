/* The workspace registry as the operator's switcher reads it: list every tenant
 * they can work in, and add one.
 *
 * This is the only route family that is deliberately NOT workspace-scoped — it
 * is the surface an operator uses to choose the scope, so scoping it would make
 * the choice unreachable.
 *
 * Not scoped is not the same as not authorised. The list is filtered to the
 * caller's memberships: an operator chooses among the tenants they may act in,
 * and a tenant they may not act in must not appear here, or the switcher
 * becomes a directory of every workspace the deployment holds. */
import { Hono } from "hono";
import type { WorkspaceSummary } from "@maleo/shared";
import { getWorkspace, listWorkspaces, updateWorkspace } from "@maleo/db/workspaces";
import {
	addWorkspaceMember,
	getWorkspaceMember,
	LastOwnerError,
	listWorkspaceMembers,
	listWorkspacesForUser,
	removeWorkspaceMember,
} from "@maleo/db/workspace-members";
import {
	listPendingInvitations,
	mintInvitation,
	revokeInvitation,
} from "@maleo/db/workspace-invitations";
import { countContentProjectsByWorkspace } from "@maleo/db/content-projects";
import { deriveBranding } from "../lib/workspace/branding.ts";
import { scaffoldWorkspace } from "../lib/workspace/scaffold.ts";
import { assertValidWorkspaceName } from "../lib/workspace/paths.ts";
import {
	createWorkspaceBody,
	deleteWorkspaceBody,
	inviteMemberBody,
	updateWorkspaceBody,
} from "./request-schemas.ts";
import { deleteWorkspace, FinalWorkspaceError } from "../lib/workspace/delete.ts";
import { activeCaller, notOwnerRefusal } from "../lib/active-workspace.ts";
import { accountLabels } from "@maleo/auth/accounts";

/* Registry branding columns are nullable — rows written before the branding
 * migration carry NULLs. Filling them from the same name-hash the registry sync
 * uses means a caller never renders a workspace with no colour, and the value it
 * gets is the one the row would have had. */
function toSummary(
	row: Awaited<ReturnType<typeof listWorkspaces>>[number],
	projectCount: number,
): WorkspaceSummary {
	const branding = deriveBranding(row.name, {
		color: row.color,
		color_bright: row.color_bright,
		color_deep: row.color_deep,
		tagline: row.tagline,
		initials: row.initials,
	});
	return {
		name: row.name,
		display_name: row.display_name,
		status: row.status,
		...branding,
		project_count: projectCount,
	};
}

/* The administrative view of one workspace.
 *
 * Carries `description` and the caller's own role, which the summary above
 * deliberately does not: the switcher renders forty of these and needs a chip,
 * while the Manage surface renders one and needs to know whether to offer the
 * controls. A surface that guessed its own permissions would show buttons the
 * API then refuses. */
function toDetail(
	row: Awaited<ReturnType<typeof listWorkspaces>>[number],
	projectCount: number,
	viewerRole: string | null,
): WorkspaceSummary & { description: string | null; viewer_role: string | null } {
	return { ...toSummary(row, projectCount), description: row.description, viewer_role: viewerRole };
}

export function workspacesRoutes(): Hono {
	const app = new Hono();

	app.get("/", async (c) => {
		const mine = new Set(await listWorkspacesForUser(activeCaller(c).userId));
		const counts = await countContentProjectsByWorkspace();
		return c.json({
			items: (await listWorkspaces())
				.filter((row) => mine.has(row.name))
				.map((row) => toSummary(row, counts[row.name] ?? 0)),
		});
	});

	/* One workspace, in full. Readable by any member — seeing the description of
	 * a workspace you are in is not an administrative act — but the controls it
	 * carries are gated by `viewer_role`. */
	app.get("/:name", async (c) => {
		const name = c.req.param("name");
		const caller = activeCaller(c);
		const membership = await getWorkspaceMember(name, caller.userId);
		const row = await getWorkspace(name);
		// A non-member is told nothing: same answer as a workspace that is not
		// there, so the API cannot be used to enumerate tenants.
		if (!row || !membership) return c.json({ error: "unknown_workspace", workspace: name }, 400);
		const counts = await countContentProjectsByWorkspace();
		return c.json({ item: toDetail(row, counts[name] ?? 0, membership.role) });
	});

	app.patch("/:name", async (c) => {
		const name = c.req.param("name");
		const refusal = await notOwnerRefusal(c, name);
		if (refusal) return refusal;

		const parsed = updateWorkspaceBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

		const updated = await updateWorkspace(name, parsed.data);
		if (!updated) return c.json({ error: "unknown_workspace", workspace: name }, 400);
		const counts = await countContentProjectsByWorkspace();
		return c.json({ item: toDetail(updated, counts[name] ?? 0, "owner") });
	});

	/* Who is in this workspace. Readable by any member: seeing your colleagues is
	 * not an administrative act, and a members page that only owners could open
	 * would leave everyone else unable to find out who to ask for access. */
	app.get("/:name/members", async (c) => {
		const name = c.req.param("name");
		const caller = activeCaller(c);
		const membership = await getWorkspaceMember(name, caller.userId);
		if (!membership) return c.json({ error: "unknown_workspace", workspace: name }, 400);

		const rows = await listWorkspaceMembers(name);
		// Who these ids actually are. See packages/auth/src/accounts.ts for why the join is
		// here rather than in the database package.
		const labels = await accountLabels(rows.map((m) => m.user_id));

		return c.json({
			items: rows.map((m) => {
				const label = labels.get(m.user_id);
				return {
					user_id: m.user_id,
					// Falls back to the id when the account is gone but the membership
					// is not — visible and removable beats hidden and still granting.
					email: label?.email ?? null,
					name: label?.name ?? null,
					role: m.role,
					created_at: m.created_at,
					is_you: m.user_id === caller.userId,
				};
			}),
			// Only an owner is shown who has been invited but has not arrived. A
			// pending invitation names an intent that is not yet a fact.
			invitations:
				membership.role === "owner"
					? (await listPendingInvitations(name)).map((i) => ({
							id: i.id,
							role: i.role,
							created_at: i.created_at,
							expires_at: i.expires_at,
						}))
					: [],
			viewer_role: membership.role,
		});
	});

	app.delete("/:name/members/:userId", async (c) => {
		const name = c.req.param("name");
		const refusal = await notOwnerRefusal(c, name);
		if (refusal) return refusal;

		try {
			await removeWorkspaceMember(name, c.req.param("userId"));
		} catch (err) {
			/* The last-owner rule, surfaced as an explanation rather than as a 500.
			 * An operator meeting this rule has done something reasonable — removed
			 * the wrong person, or tried to leave — and deserves a sentence, not a
			 * stack trace. */
			if (err instanceof LastOwnerError) {
				return c.json(
					{
						error: "last_owner",
						workspace: name,
						message: "This is the only owner. Make someone else an owner first.",
					},
					409,
				);
			}
			throw err;
		}
		return c.json({ ok: true });
	});

	app.post("/:name/invitations", async (c) => {
		const name = c.req.param("name");
		const refusal = await notOwnerRefusal(c, name);
		if (refusal) return refusal;

		const parsed = inviteMemberBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

		const minted = await mintInvitation({
			workspace: name,
			invitedBy: activeCaller(c).userId,
			...(parsed.data.role ? { role: parsed.data.role } : {}),
		});

		/* The token is returned HERE and nowhere else, ever. It is not stored, so
		 * this response is the only copy that will exist — a client that loses it
		 * mints another rather than looking it up. */
		return c.json(
			{
				item: {
					id: minted.row.id,
					role: minted.row.role,
					expires_at: minted.row.expires_at,
				},
				token: minted.token,
			},
			201,
		);
	});

	app.delete("/:name/invitations/:id", async (c) => {
		const name = c.req.param("name");
		const refusal = await notOwnerRefusal(c, name);
		if (refusal) return refusal;

		// Already spent or already revoked answers the same way: the link does not
		// work, which is what the caller wanted.
		await revokeInvitation(c.req.param("id"));
		return c.json({ ok: true });
	});

	app.delete("/:name", async (c) => {
		const name = c.req.param("name");
		const refusal = await notOwnerRefusal(c, name);
		if (refusal) return refusal;

		const parsed = deleteWorkspaceBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

		/* The operator types the name. Not a boolean flag, not a Confirm button:
		 * this has no undo, and a dialog dismissed by muscle memory is exactly how
		 * an irreversible operation gets run by accident. */
		if (parsed.data.confirm_name !== name) {
			return c.json(
				{
					error: "confirmation_mismatch",
					message: "Type the workspace name exactly to confirm.",
				},
				400,
			);
		}

		/* Refusing the last one is about reachability, not data safety.
		 *
		 * An account with no memberships signs in to an application scoped to
		 * nothing: an empty switcher, no way to create anything, and no
		 * explanation. That reads as a broken deployment rather than as the
		 * consequence of what they just did. */
		const caller = activeCaller(c);
		if ((await listWorkspacesForUser(caller.userId)).length <= 1) {
			return c.json(
				{
					error: "last_workspace",
					message: "This is your only workspace. Create another one before deleting this.",
				},
				409,
			);
		}

		try {
			const report = await deleteWorkspace(name);
			return c.json({ ok: true, ...report });
		} catch (error) {
			if (!(error instanceof FinalWorkspaceError)) throw error;
			return c.json(
				{ error: "last_workspace", message: "The deployment's final workspace cannot be deleted." },
				409,
			);
		}
	});

	app.post("/", async (c) => {
		const parsed = createWorkspaceBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const body = parsed.data;
		const name = typeof body.name === "string" ? body.name.trim() : "";
		if (!name) return c.json({ error: "name required" }, 400);
		try {
			assertValidWorkspaceName(name);
		} catch {
			return c.json({ error: "invalid_workspace_name" }, 400);
		}
		// Checked against the registry AND caught off the scaffold below: the
		// directory and the row can each exist without the other, and either one
		// makes this name taken.
		if (await getWorkspace(name)) return c.json({ error: "workspace_exists" }, 409);
		try {
			// Writes the directory, its config.yaml, AND the registry row. A row on
			// its own would be selectable and then fail on first read, which is not
			// a created workspace.
			await scaffoldWorkspace(name);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (message.includes("already exists")) return c.json({ error: "workspace_exists" }, 409);
			throw err;
		}
		const row = await getWorkspace(name);
		if (!row) return c.json({ error: "workspace_create_failed" }, 500);
		/* The creator owns what they created. Without this the new workspace is
		 * invisible the moment it exists — the listing above is scoped to
		 * membership, so creating one and then not being a member of it is a
		 * workspace that vanishes on the next request. */
		await addWorkspaceMember({ workspace: name, user_id: activeCaller(c).userId, role: "owner" });
		return c.json({ item: toSummary(row, 0) }, 201);
	});

	return app;
}
