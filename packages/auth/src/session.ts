/* Resolving the caller, once per request.
 *
 * Kept apart from config.ts because this is the part the rest of the API talks
 * to: routes want "who is this", not an auth library. */
import { getAuth } from "./config.ts";
import { MODEL_NAMES } from "./config.ts";
import { openDb } from "@maleo/db/connection";

export interface Caller {
	userId: string;
	email: string;
	/** The instance role — see INSTANCE_OWNER in config.ts. Not a workspace role. */
	role: string;
}

/** The signed-in caller, or null. Never throws: an unreadable session is an
 *  anonymous request, not a 500. */
export async function resolveCaller(req: Request): Promise<Caller | null> {
	try {
		const session = await getAuth().api.getSession({ headers: req.headers });
		if (!session?.user) return null;
		// SAFETY: `session.user` is non-null per the guard above. The cast adds
		// `role`, which this deployment declares as a user additionalField in
		// config.ts but the library's base type does not know about; it is read
		// defensively with a fallback on the next line.
		const user = session.user as { id: string };
		const current = await openDb().get<{ email: string; role: string | null; suspended: boolean }>(
			`SELECT email, role, suspended FROM ${MODEL_NAMES.user} WHERE id = ?`,
			[user.id],
		);
		if (!current || current.suspended) return null;
		return { userId: user.id, email: current.email, role: current.role ?? "member" };
	} catch {
		return null;
	}
}

/* The refusal. One shape for every covered path, so a prober cannot tell a
 * route that exists from one that does not, or a missing session from a revoked
 * one.
 *
 * The stale cookie is cleared on the way out: leaving it set means the browser
 * presents a dead credential on every subsequent request, and the sign-in
 * screen has to reason about a cookie that cannot work. */
export function refuseAnonymous(): Response {
	return new Response(JSON.stringify({ error: "unauthorized" }), {
		status: 401,
		headers: {
			"content-type": "application/json",
			"set-cookie": "better-auth.session_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
		},
	});
}
