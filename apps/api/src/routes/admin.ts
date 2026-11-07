import { Hono, type Context } from "hono";
import { agentTemplateCatalog } from "../modules/agents/core/template-catalog.ts";
import { z } from "zod";
import { instanceOwnerOnly } from "../middleware/instance-owner.ts";
import { adminRenderComparisonRoutes } from "./admin-render-comparisons.ts";
import { listAdminAudit, recordAdminAudit } from "@maleo/db/admin-audit";
import { activeCaller } from "../lib/active-workspace.ts";
import {
	AdminConflict,
	deleteAccount,
	revokeAccountSessions,
	setAccountRole,
	setAccountSuspended,
} from "../lib/admin-accounts.ts";
import { registrationPolicy, setRegistrationPolicy } from "@maleo/auth/registration-policy";
import {
	adminWorkspaceDeleteImpact,
	createAdminInvitation,
	createAdminWorkspace,
	deleteAdminWorkspace,
	grantAdminMembership,
	LastOwnerError,
	removeAdminMembership,
	revokeAdminInvitation,
	updateAdminWorkspace,
} from "../lib/admin-workspaces.ts";
import { updateWorkspaceBody } from "./request-schemas.ts";
import { assertValidWorkspaceName } from "../lib/workspace/paths.ts";
import { getWorkspaceMember } from "@maleo/db/workspace-members";
import {
	getAdminProject,
	getAdminUser,
	getAdminWorkspace,
	listAdminProjects,
	listAdminUsers,
	listAdminWorkspaces,
} from "../lib/admin-directory.ts";

export function adminRoutes(): Hono {
	const app = new Hono();
	app.use("*", instanceOwnerOnly());
	app.route("/render-comparisons", adminRenderComparisonRoutes());
	app.get("/agent-templates", (c) => {
		try {
			return c.json(agentTemplateCatalog());
		} catch {
			return c.json(
				{
					error: "agent_template_catalog_invalid",
					message: "Deployed template definitions failed validation.",
				},
				500,
			);
		}
	});
	const act = async (
		c: Context,
		action: string,
		targetId: string,
		run: () => Promise<unknown>,
		targetType = "user",
	): Promise<Response> => {
		try {
			return c.json({ item: await run() });
		} catch (error) {
			const reason =
				error instanceof AdminConflict
					? error.reason
					: error instanceof LastOwnerError
						? "last_workspace_owner"
						: "internal";
			await recordAdminAudit({
				actor_id: activeCaller(c).userId,
				action,
				target_type: targetType,
				target_id: targetId,
				outcome: "refused",
				reason,
			});
			if (error instanceof AdminConflict) return c.json({ error: reason }, error.status);
			if (error instanceof LastOwnerError) return c.json({ error: reason }, 409);
			throw error;
		}
	};

	const paging = (query: (name: string) => string | undefined) => ({
		q: (query("q") ?? "").trim().slice(0, 100),
		limit: Math.min(100, Math.max(1, Number.parseInt(query("limit") ?? "20", 10) || 20)),
		offset: Math.min(100_000, Math.max(0, Number.parseInt(query("offset") ?? "0", 10) || 0)),
	});

	app.get("/users", async (c) => {
		const { q, limit, offset } = paging((key) => c.req.query(key));
		return c.json(await listAdminUsers(q, limit, offset));
	});
	app.get("/users/:id", async (c) => {
		const item = await getAdminUser(c.req.param("id"));
		return item ? c.json({ item }) : c.json({ error: "user_not_found" }, 404);
	});
	app.get("/workspaces", async (c) => {
		const { q, limit, offset } = paging((key) => c.req.query(key));
		return c.json(await listAdminWorkspaces(q, limit, offset));
	});
	app.get("/workspaces/:name", async (c) => {
		const item = await getAdminWorkspace(c.req.param("name"));
		return item ? c.json({ item }) : c.json({ error: "workspace_not_found" }, 404);
	});
	app.get("/projects", async (c) => {
		const { q, limit, offset } = paging((key) => c.req.query(key));
		return c.json(await listAdminProjects(q, limit, offset));
	});
	app.get("/projects/:id", async (c) => {
		const item = await getAdminProject(c.req.param("id"));
		return item ? c.json({ item }) : c.json({ error: "project_not_found" }, 404);
	});
	app.get("/audit", async (c) => {
		const { limit, offset } = paging((key) => c.req.query(key));
		return c.json(await listAdminAudit(limit, offset));
	});
	app.get("/authentication", async (c) => c.json({ policy: await registrationPolicy() }));
	app.put("/authentication", async (c) => {
		const body = z
			.object({ policy: z.enum(["open", "invitation_only"]) })
			.safeParse(await c.req.json().catch(() => ({})));
		if (!body.success) return c.json({ error: "invalid_body" }, 400);
		if ((await registrationPolicy()).source === "environment")
			return c.json({ error: "environment_override" }, 409);
		await setRegistrationPolicy(body.data.policy);
		await recordAdminAudit({
			actor_id: activeCaller(c).userId,
			action: "registration.policy",
			target_type: "instance",
			target_id: "registration",
			outcome: "success",
			reason: null,
		});
		return c.json({ policy: await registrationPolicy() });
	});

	app.patch("/users/:id/role", async (c) => {
		const body = z
			.object({ role: z.enum(["instance_owner", "member"]) })
			.safeParse(await c.req.json().catch(() => ({})));
		if (!body.success) return c.json({ error: "invalid_body" }, 400);
		const id = c.req.param("id");
		return act(c, "account.role", id, () =>
			setAccountRole(activeCaller(c).userId, id, body.data.role),
		);
	});
	app.patch("/users/:id/status", async (c) => {
		const body = z
			.object({ suspended: z.boolean() })
			.safeParse(await c.req.json().catch(() => ({})));
		if (!body.success) return c.json({ error: "invalid_body" }, 400);
		const id = c.req.param("id");
		return act(c, body.data.suspended ? "account.suspend" : "account.restore", id, () =>
			setAccountSuspended(activeCaller(c).userId, id, body.data.suspended),
		);
	});
	app.post("/users/:id/revoke-sessions", async (c) => {
		const id = c.req.param("id");
		return act(c, "account.sessions.revoke", id, () =>
			revokeAccountSessions(activeCaller(c).userId, id),
		);
	});
	app.delete("/users/:id", async (c) => {
		const id = c.req.param("id");
		const body = z
			.object({ confirm_email: z.string().email() })
			.safeParse(await c.req.json().catch(() => ({})));
		if (!body.success) return c.json({ error: "invalid_body" }, 400);
		const existing = await getAdminUser(id);
		if (!existing || existing.email !== body.data.confirm_email)
			return c.json({ error: "confirmation_mismatch" }, 400);
		return act(c, "account.delete", id, () => deleteAccount(activeCaller(c).userId, id));
	});

	const roleBody = z.object({ role: z.enum(["owner", "member"]) });
	app.put("/workspaces/:name/members/:userId", async (c) => {
		const body = roleBody.safeParse(await c.req.json().catch(() => ({})));
		if (!body.success) return c.json({ error: "invalid_body" }, 400);
		const name = c.req.param("name"),
			id = c.req.param("userId");
		// Named for what the call would have done, so a refusal reads the same as its success.
		const action = (await getWorkspaceMember(name, id)) ? "membership.role" : "membership.grant";
		return act(c, action, id, () =>
			grantAdminMembership(activeCaller(c).userId, name, id, body.data.role),
		);
	});
	app.delete("/workspaces/:name/members/:userId", async (c) => {
		const name = c.req.param("name"),
			id = c.req.param("userId");
		return act(c, "membership.remove", id, () =>
			removeAdminMembership(activeCaller(c).userId, name, id),
		);
	});
	app.post("/workspaces/:name/invitations", async (c) => {
		const body = roleBody.safeParse(await c.req.json().catch(() => ({})));
		if (!body.success) return c.json({ error: "invalid_body" }, 400);
		const name = c.req.param("name");
		return act(
			c,
			"invitation.mint",
			name,
			() => createAdminInvitation(activeCaller(c).userId, name, body.data.role),
			"workspace",
		);
	});
	app.delete("/workspaces/:name/invitations/:id", async (c) => {
		const name = c.req.param("name"),
			id = c.req.param("id");
		return act(
			c,
			"invitation.revoke",
			id,
			() => revokeAdminInvitation(activeCaller(c).userId, name, id),
			"invitation",
		);
	});
	app.post("/workspaces", async (c) => {
		const body = z
			.object({
				name: z.string().min(1),
				owner_email: z.string().email(),
				display_name: z.string().min(1).max(120).optional(),
			})
			.safeParse(await c.req.json().catch(() => ({})));
		if (!body.success) return c.json({ error: "invalid_body" }, 400);
		try {
			assertValidWorkspaceName(body.data.name);
		} catch {
			return c.json({ error: "invalid_workspace_name" }, 400);
		}
		const { name, owner_email, display_name } = body.data;
		return act(
			c,
			"workspace.create",
			name,
			() => createAdminWorkspace(activeCaller(c).userId, name, owner_email, display_name),
			"workspace",
		);
	});
	app.patch("/workspaces/:name", async (c) => {
		const body = updateWorkspaceBody.safeParse(await c.req.json().catch(() => ({})));
		if (!body.success) return c.json({ error: "invalid_body" }, 400);
		const name = c.req.param("name");
		return act(
			c,
			"workspace.update",
			name,
			() => updateAdminWorkspace(activeCaller(c).userId, name, body.data),
			"workspace",
		);
	});
	app.get("/workspaces/:name/delete-impact", async (c) => {
		try {
			return c.json({ item: await adminWorkspaceDeleteImpact(c.req.param("name")) });
		} catch (error) {
			if (error instanceof AdminConflict) return c.json({ error: error.reason }, error.status);
			throw error;
		}
	});
	app.delete("/workspaces/:name", async (c) => {
		const name = c.req.param("name");
		const body = z
			.object({ confirm_name: z.string(), confirm_losing_access: z.array(z.string()).max(10_000) })
			.safeParse(await c.req.json().catch(() => ({})));
		if (!body.success || body.data.confirm_name !== name)
			return c.json({ error: "confirmation_mismatch" }, 400);
		return act(
			c,
			"workspace.delete",
			name,
			() => deleteAdminWorkspace(activeCaller(c).userId, name, body.data.confirm_losing_access),
			"workspace",
		);
	});

	return app;
}
