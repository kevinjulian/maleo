/* Test seam for the membership boundary.
 *
 * `workspaceScope()` refuses any request whose caller it cannot identify, which
 * is the correct production behaviour and makes every route test a signed-in
 * one. Standing up a real session per suite would mean a real database, a real
 * sign-up and a real cookie in tests that are about tenancy, not about auth —
 * so a caller is installed directly instead.
 *
 * Mirrors `secret-store-testing.ts` in @maleo/db: a test-only helper that
 * lives beside the thing it opens, rather than a production flag that could be
 * set in a deployment.
 */
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { listWorkspaces } from "@maleo/db/workspaces";
import { DEFAULT_CONTENT_WORKSPACE } from "@maleo/db/schema";
import { addWorkspaceMember } from "@maleo/db/workspace-members";
import type { Caller } from "@maleo/auth/session";

export const TEST_CALLER: Caller = {
	userId: "test-operator",
	email: "test-operator@example.com",
	role: "instance_owner",
};

/* Make the test caller a member of every workspace registered right now, plus
 * the default one whether or not it has a row yet.
 *
 * The default is granted unconditionally because `isRegisteredWorkspace()`
 * self-heals it: a suite that resets the database has no `default` row until
 * the scope middleware creates one, which happens AFTER this runs. Granting
 * only what is listed would leave the commonest case — a test that names no
 * workspace at all — refused. Membership carries no foreign key, so a grant
 * ahead of the row is legal and is reconciled the moment the row appears. */
export async function grantTestMembershipToAll(): Promise<void> {
	const names = new Set([
		DEFAULT_CONTENT_WORKSPACE,
		...(await listWorkspaces()).map((r) => r.name),
	]);
	for (const name of names) {
		await addWorkspaceMember({ workspace: name, user_id: TEST_CALLER.userId, role: "owner" });
	}
}

/* Mount ahead of the routes under test.
 *
 * Grants membership per request rather than once at mount: a suite that
 * scaffolds a workspace partway through would otherwise be refused by a grant
 * that ran before the workspace existed, and the failure would read as a
 * tenancy bug rather than as test setup.
 *
 * A test that needs a caller WITHOUT membership should set the caller itself
 * rather than reach for this. */
export function installTestCaller(caller: Caller = TEST_CALLER): MiddlewareHandler {
	return async (c, next) => {
		c.set("activeCaller", caller);
		if (caller.userId === TEST_CALLER.userId) await grantTestMembershipToAll();
		await next();
	};
}

/* Wrap a route family that mounts `workspaceScope()` internally.
 *
 * `ttsRoutes()` and friends build their own Hono with the scope middleware
 * already inside, so a caller cannot be installed ahead of it from outside —
 * hence the wrapper rather than a `use()` on the family itself. */
export function testApp(routes: Hono, caller: Caller = TEST_CALLER): Hono {
	const app = new Hono();
	app.use("*", installTestCaller(caller));
	app.route("/", routes);
	return app;
}
