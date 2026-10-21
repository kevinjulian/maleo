/* Who an MCP request acts as.
 *
 * An MCP client — Codex CLI, Claude Code — authenticates with a user-owned API
 * key sent as `Authorization: Bearer <key>`. The key acts as its owner: every
 * project it reaches is one the owner reaches in the web app. A suspended
 * owner's keys stop working with the account. */
import { openDb } from "@maleo/db/connection";
import { getAuth, MODEL_NAMES } from "@maleo/auth/config";

export interface McpPrincipal {
	userId: string;
}

function bearer(req: Request): string | null {
	const match = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get("authorization") ?? "");
	return match?.[1] ?? null;
}

/** The principal a request carries, or null when it carries no valid key. */
export async function mcpPrincipal(req: Request): Promise<McpPrincipal | null> {
	const key = bearer(req);
	if (!key?.startsWith("maleo_")) return null;
	const verified = await getAuth().api.verifyApiKey({ body: { key } });
	const userId = verified.valid ? verified.key?.referenceId : undefined;
	if (!userId) return null;
	const owner = await openDb().get<{ suspended: boolean }>(
		`SELECT suspended FROM ${MODEL_NAMES.user} WHERE id = ?`,
		[userId],
	);
	if (!owner || owner.suspended) return null;
	return { userId };
}
