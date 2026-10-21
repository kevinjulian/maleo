/* Redeeming an invitation — the one route that creates an account on a
 * deployment where registration is closed.
 *
 * It may do that because the token proves a workspace owner asked for this
 * account to exist. Everything else about sign-up still applies: the same
 * password rules, the same argon2id storage, the same rate limiting, because
 * this goes through better-auth's own sign-up rather than around it.
 *
 * Reachable while signed out, so it is a declared exemption in
 * packages/auth/src/perimeter.ts rather than an accident of mounting.
 *
 * Every refusal here is the same refusal. Forged, expired, spent and revoked
 * are one answer, because the difference is only useful to somebody probing a
 * deployment for which workspaces exist and when they last invited anyone.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import {
	findRedeemable,
	markRedeemed,
	setInvitationRedeemer,
} from "@maleo/db/workspace-invitations";
import { getWorkspace } from "@maleo/db/workspaces";
import { addWorkspaceMember } from "@maleo/db/workspace-members";
import { getAuth } from "@maleo/auth/config";
import { withInvitationAuthorisation } from "@maleo/auth/invitation-context";
import { resolveCaller } from "@maleo/auth/session";

const redeemBody = z.object({
	email: z.string().email(),
	password: z.string(),
	name: z.string().optional(),
});

/** One answer for every bad token. */
const refuseToken = (c: Context): Response =>
	c.json({ error: "invitation_invalid", message: "This invitation link is not usable." }, 404);

export function invitationRoutes(): Hono {
	const app = new Hono();

	/* What the redemption screen needs to render: which workspace this is for.
	 *
	 * Safe to answer, because the caller already holds the token — telling them
	 * the name of the workspace they were invited to reveals nothing they were
	 * not just given. It returns the DISPLAY name only: not the member list, not
	 * the description, not who invited them. */
	app.get("/:token", async (c) => {
		const invitation = await findRedeemable(c.req.param("token"));
		if (!invitation) return refuseToken(c);
		const workspace = await getWorkspace(invitation.workspace);
		if (!workspace) return refuseToken(c);

		return c.json({
			item: {
				workspace: workspace.name,
				display_name: workspace.display_name,
				role: invitation.role,
				expires_at: invitation.expires_at,
			},
		});
	});

	app.post("/:token/redeem", async (c) => {
		const token = c.req.param("token");
		const invitation = await findRedeemable(token);
		if (!invitation) return refuseToken(c);
		if (!(await getWorkspace(invitation.workspace))) return refuseToken(c);

		/* Already signed in: add the membership to the account they have.
		 *
		 * Creating a second account for someone who is already an operator is the
		 * wrong answer — they would end up with two identities and only one of
		 * them holding the work. */
		const existing = await resolveCaller(c.req.raw);
		if (existing) {
			if (!(await markRedeemed(invitation.id, existing.userId))) return refuseToken(c);
			await addWorkspaceMember({
				workspace: invitation.workspace,
				user_id: existing.userId,
				role: invitation.role,
			});
			return c.json({ ok: true, workspace: invitation.workspace, joined_existing_account: true });
		}

		const parsed = redeemBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

		/* Claim the invitation BEFORE creating the account.
		 *
		 * The UPDATE is conditional on it still being pending, so two redemptions
		 * racing produce exactly one winner — and the loser is refused before it
		 * can create an account that would then have no invitation to justify it.
		 * The cost of this order is that a failed sign-up burns the invitation;
		 * the cost of the other order is two accounts from one link. */
		const placeholderUser = `pending:${token.slice(0, 8)}`;
		if (!(await markRedeemed(invitation.id, placeholderUser))) return refuseToken(c);

		const response = await withInvitationAuthorisation(invitation.workspace, () =>
			getAuth().handler(
				new Request(new URL("/api/auth/sign-up/email", c.req.url), {
					method: "POST",
					headers: c.req.raw.headers,
					body: JSON.stringify({
						email: parsed.data.email,
						password: parsed.data.password,
						name: parsed.data.name ?? parsed.data.email,
					}),
				}),
			),
		);

		if (!response.ok) {
			// Sign-up refused it — a weak password, a duplicate address, the rate
			// limiter. Pass the library's own answer through; it is the accurate one.
			return response;
		}

		/* SAFETY: guarded by `response.ok` above, and the body is better-auth's own
		 * sign-up response, which carries the created user. `id` is read optionally
		 * and a missing one is answered with a 500 on the next line rather than
		 * assumed. */
		const created = (await response.clone().json()) as { user?: { id?: string } };
		const userId = created.user?.id;
		if (!userId) return c.json({ error: "invitation_failed" }, 500);

		await addWorkspaceMember({
			workspace: invitation.workspace,
			user_id: userId,
			role: invitation.role,
		});
		// Record who actually redeemed it, now that they exist.
		await setInvitationRedeemer(invitation.id, userId);

		// The library's response carries the session cookie, so redemption signs
		// them in — the same as any other sign-up.
		return response;
	});

	return app;
}
