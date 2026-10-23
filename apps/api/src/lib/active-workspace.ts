/* The one place a request's tenant is decided.
 *
 * Every scoped route family mounts `workspaceScope()` and reads
 * `activeWorkspace(c)`. That is the whole rule, and it exists because the
 * alternative was already in the codebase: `content-materials.ts` resolved
 * `query("workspace")?.trim() || "default"` locally, so a typo, a stale link or
 * a client that forgot the parameter silently served `default`'s data while
 * appearing to honour the operator's choice — indistinguishable, from the
 * outside, from their work having moved.
 *
 * It is now BOTH checks, and that is deliberate. Registry validation answers
 * "does this tenant exist"; membership answers "may this caller act in it". Two
 * middlewares would mean a new route family could mount one and forget the
 * other, and the forgetting is invisible — a scoped surface that serves
 * everybody looks exactly like a scoped surface that works. One seam, both
 * questions.
 *
 * The two refusals are deliberately IDENTICAL. A caller who is not a member
 * gets the same answer as a caller naming a workspace that does not exist, so
 * the API cannot be used to enumerate which tenants a deployment holds.
 *
 * What this is still NOT: a decision about generation. A generation that has a
 * project takes that project's workspace, never this one. See
 * routes/operations/generation.ts.
 */
import type { Context, MiddlewareHandler } from "hono";
import { openDb } from "@maleo/db/connection";
import { getWorkspace } from "@maleo/db/workspaces";
import { getWorkspaceMember, isWorkspaceMember } from "@maleo/db/workspace-members";
import { DEFAULT_CONTENT_WORKSPACE } from "@maleo/db/schema";
import { ensureDefaultWorkspace, syncWorkspaceRegistry } from "./workspace/registry.ts";
import type { Caller } from "@maleo/auth/session";

const VAR = "activeWorkspace";
const CALLER_VAR = "activeCaller";

/** What a request naming no workspace resolves to. Encoded once, here: it is
 *  the tenant that owns every project written before scoping was read, so a
 *  caller that has not been taught to send one sees exactly what it saw
 *  before. */
export const ABSENT_WORKSPACE_RESOLVES_TO = DEFAULT_CONTENT_WORKSPACE;

/* The caller, put on the Hono env by the dispatch in index.ts.
 *
 * Read from `c.env` rather than resolved again here: the perimeter has already
 * looked the session up for this request, and doing it twice would be a second
 * database read per request to answer a question already answered.
 *
 * Throws when absent, the same way `activeWorkspace()` throws when the scope
 * middleware is missing. Absent means the request did not come through the
 * dispatch, which is a wiring mistake — and a wiring mistake must be a loud 500
 * rather than a scoped surface that quietly skips its membership check. */
export function activeCaller(c: Context): Caller {
	// Context variable first, then the env the dispatch set. The variable is
	// what a test installs; the env is what production supplies.
	/* SAFETY: both are untyped bags Hono cannot type for us — a context variable
	 * and the env passed to `fetch`. The only writers are `installTestCaller` and
	 * the dispatch in index.ts, both of which write a `Caller`. Either being
	 * absent is handled by the throw below rather than assumed away. */
	const caller =
		(c.get(CALLER_VAR) as Caller | undefined) ?? (c.env as { caller?: Caller } | undefined)?.caller;
	if (!caller) {
		throw new Error(
			"activeCaller() read without the perimeter having resolved one — " +
				"the request did not pass through the dispatch in index.ts",
		);
	}
	return caller;
}

/** May this caller act in this tenant? */
async function mayAct(caller: Caller, workspace: string): Promise<boolean> {
	return await isWorkspaceMember(workspace, caller.userId);
}

/** Does this caller own this tenant? */
export async function ownsWorkspace(caller: Caller, workspace: string): Promise<boolean> {
	return (await getWorkspaceMember(workspace, caller.userId))?.role === "owner";
}

/* The refusal for an administrative action by someone who is only a member.
 *
 * Deliberately NOT the same answer as `unknownWorkspaceRefusal`. Those two are
 * telling a caller different things, and the difference is safe to reveal here:
 * a member already knows the workspace exists — they are in it — so refusing
 * with "unknown workspace" would be a lie that helps nobody and makes the UI
 * unable to say why the button did not work.
 *
 * A NON-member asking to administer a workspace never reaches this: the
 * membership check refuses them first, as an unknown workspace, which is what
 * keeps the tenant list private.
 *
 * Returns the refusal, or null when the caller owns the workspace. */
export async function notOwnerRefusal(c: Context, workspace: string): Promise<Response | null> {
	const caller = activeCaller(c);
	if (!(await mayAct(caller, workspace))) {
		// Not even a member. Answer exactly as if the workspace did not exist.
		return c.json({ error: "unknown_workspace", workspace }, 400);
	}
	if (await ownsWorkspace(caller, workspace)) return null;
	return c.json(
		{ error: "not_workspace_owner", workspace, message: "Only a workspace owner can do this." },
		403,
	);
}

/** Is this a tenant the registry knows about? */
export async function isRegisteredWorkspace(name: string): Promise<boolean> {
	if ((await getWorkspace(name)) != null) return true;
	if (name !== DEFAULT_CONTENT_WORKSPACE) return false;
	await ensureDefaultWorkspace();
	await syncWorkspaceRegistry();
	return (await getWorkspace(name)) != null;
}

/* The refusal, in one shape.
 *
 * The image routes cannot use the middleware below — `/generate` takes its
 * workspace from the BODY, and the read routes accept an ABSENT workspace as
 * "every workspace" rather than defaulting it. They still have to refuse an
 * unregistered name the same way, and with the same payload: two spellings of
 * "unknown workspace" is how a client comes to handle one and not the other.
 *
 * Returns the refusal, or null when the name is acceptable. Callers that allow
 * an absent workspace pass `undefined` and get null. */
export async function unknownWorkspaceRefusal(
	c: Context,
	name: string | undefined,
): Promise<Response | null> {
	const trimmed = name?.trim();
	if (!trimmed) return null;
	// Unknown and not-a-member answer the same way — see the header. Membership
	// is checked here too, because these callers take their workspace from a
	// request body and never reach the middleware below.
	if ((await isRegisteredWorkspace(trimmed)) && (await mayAct(activeCaller(c), trimmed)))
		return null;
	return c.json({ error: "unknown_workspace", workspace: trimmed }, 400);
}

/** Validate the requested tenant once per request, or refuse it.
 *
 *  Refusing rather than falling back is the point. A fallback turns "show me
 *  veronika" into "here is default" with no signal at any layer. */
export function workspaceScope(): MiddlewareHandler {
	return async (c, next) => {
		const requested = c.req.query("workspace")?.trim();
		const name = requested || ABSENT_WORKSPACE_RESOLVES_TO;
		if (!(await isRegisteredWorkspace(name)) || !(await mayAct(activeCaller(c), name))) {
			return c.json({ error: "unknown_workspace", workspace: name }, 400);
		}
		c.set(VAR, name);
		await next();
	};
}

/** The validated tenant for this request.
 *
 *  Throws when `workspaceScope()` is not mounted ahead of the handler. That is a
 *  wiring mistake, and it surfaces as a 500 rather than as a scoped surface
 *  quietly serving `default` — which is the failure this module exists to make
 *  impossible. */
export function activeWorkspace(c: Context): string {
	const name: unknown = c.get(VAR);
	if (typeof name !== "string" || !name)
		throw new Error("activeWorkspace() read without workspaceScope() mounted");
	return name;
}

/** Refuse a project id that belongs to another workspace, as one that does not exist.
 *
 *  Mounted on `/projects/:id` and below, after `workspaceScope()`, so no project
 *  route has to remember the check. An id with no project passes through, so each
 *  route keeps its own not-found answer. */
export function projectWorkspaceScope(): MiddlewareHandler {
	return async (c, next) => {
		const id = c.req.param("id");
		const project = id
			? await openDb().get<{ workspace: string }>(
					"SELECT workspace FROM content_projects WHERE id = ?",
					[id],
				)
			: undefined;
		if (project && project.workspace !== activeWorkspace(c))
			return c.json({ error: "project_not_found" }, 404);
		await next();
	};
}
