/* Turning account ids into something a person recognises.
 *
 * `workspace_members` holds a user id and nothing else — no foreign key, by
 * design, because the auth tables migrate independently. That is the right
 * boundary for the data and the wrong thing to render: a members list showing
 * `cbwiQzEGto3g8SuZ5aMLIu6lO1ykbrnZ` tells an owner nothing about who is in
 * their workspace, and "remove" beside it is a coin flip.
 *
 * So the join happens HERE, in the package that is allowed to know the auth
 * tables exist, rather than in `@maleo/db` where it would couple two schemas
 * that deliberately do not reference each other.
 */
import { openDb } from "@maleo/db/connection";
import { MODEL_NAMES } from "./config.ts";

export interface AccountLabel {
	email: string;
	name: string | null;
}

/**
 * Email and name for each id, for the ids that still exist.
 *
 * An id with no row is simply absent from the map. That happens when an account
 * is deleted while a membership survives it, and the caller renders the bare id
 * — visible, obviously wrong, and removable, which is better than hiding a row
 * that still grants access.
 */
export async function accountLabels(
	userIds: readonly string[],
): Promise<Map<string, AccountLabel>> {
	const out = new Map<string, AccountLabel>();
	if (userIds.length === 0) return out;

	// One statement with a placeholder per id, rather than a query per member.
	const placeholders = userIds.map(() => "?").join(", ");
	try {
		const rows = await openDb().all<{ id: string; email: string; name: string | null }>(
			`SELECT id, email, name FROM ${MODEL_NAMES.user} WHERE id IN (${placeholders})`,
			userIds,
		);
		for (const row of rows) out.set(row.id, { email: row.email, name: row.name });
	} catch {
		/* The auth tables are not there.
		 *
		 * Only reachable before `ensureAuthTables()` has run — the API awaits it at
		 * boot, so a serving deployment always has them. Returning an empty map
		 * makes the caller render raw ids, which is ugly and correct; throwing
		 * would fail the whole members request because a DISPLAY lookup missed.
		 * Who may act in this workspace is not in question either way. */
	}
	return out;
}
