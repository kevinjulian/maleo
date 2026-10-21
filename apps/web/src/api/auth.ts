/* The sign-in boundary.
 *
 * These four calls deliberately do NOT go through `client.ts`. Its helpers
 * redirect to /login on a 401, which is exactly right everywhere else and
 * exactly wrong here: a wrong password answers 401, and redirecting the sign-in
 * screen to itself turns a typo into a page that reloads and forgets what was
 * typed. Sign-in is the one place a 401 is an answer rather than an accident.
 *
 * `credentials: "include"` on every call, because the whole point is the
 * cookie. */
import { apiUrl } from "@models/core/asset-url.ts";

export interface AuthState {
	/** False on a deployment nobody has claimed yet. */
	hasAccounts: boolean;
	/** Whether creating an account is on offer at all. */
	registrationOpen: boolean;
}

export interface SessionUser {
	id: string;
	email: string;
	name: string;
	role?: string;
}

async function authPost(path: string, body: unknown): Promise<Response> {
	return fetch(apiUrl(`/api/auth${path}`), {
		method: "POST",
		credentials: "include",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

/** The message a failed sign-in should show. Never says whether the address is
 *  registered — the API refuses to distinguish the two, and a client that
 *  guessed would undo that. */
async function refusalMessage(response: Response, fallback: string): Promise<string> {
	// SAFETY: the shape is not trusted, only narrowed. `.catch(() => null)` covers
	// a non-JSON body, and every read below is optional with a fallback, so an
	// unexpected shape degrades to `fallback` rather than throwing.
	const body = (await response.json().catch(() => null)) as { message?: string } | null;
	return body?.message ?? fallback;
}

export async function readAuthState(): Promise<AuthState> {
	const response = await fetch(apiUrl("/api/auth-state"), { credentials: "include" });
	if (!response.ok) throw new Error(`auth-state ${response.status}`);
	// SAFETY: guarded by the `response.ok` check above, and the body comes from
	// routes/auth-state.ts in this repository, which returns exactly these two
	// booleans. A cross-origin impostor cannot reach here — the request is
	// same-origin through the proxy.
	return (await response.json()) as AuthState;
}

export async function readSession(): Promise<SessionUser | null> {
	const response = await fetch(apiUrl("/api/auth/get-session"), { credentials: "include" });
	if (!response.ok) return null;
	// SAFETY: narrowing only. A non-JSON body becomes null via the catch, and a
	// missing `user` falls through to null — which is the "nobody is signed in"
	// answer this function exists to give.
	const body = (await response.json().catch(() => null)) as { user?: SessionUser } | null;
	return body?.user ?? null;
}

export async function signIn(email: string, password: string): Promise<void> {
	const response = await authPost("/sign-in/email", { email, password });
	if (response.ok) return;
	throw new Error(
		await refusalMessage(
			response,
			response.status === 429
				? "Too many attempts. Wait a minute and try again."
				: "That email and password did not match.",
		),
	);
}

export async function createFirstOwner(
	email: string,
	password: string,
	name: string,
): Promise<void> {
	const response = await authPost("/sign-up/email", { email, password, name });
	if (response.ok) return;
	throw new Error(await refusalMessage(response, "Could not create the account."));
}

/** Revokes the current session. A 401 means it was already gone, which is the
 *  outcome asked for; any other refusal throws, so the caller does not show the
 *  sign-in screen over a session that is still live. */
export async function signOut(): Promise<void> {
	const response = await authPost("/sign-out", {});
	if (response.ok || response.status === 401) return;
	throw new Error(await refusalMessage(response, "Could not sign out. Try again."));
}

/* ─── The signed-in person's own account ───
 *
 * Same rule as sign-in: not through `client.ts`. A wrong current password is a
 * 4xx that means "try again", and a redirect to /login would throw away what
 * was typed and show no reason. */

async function authOrThrow(response: Response, fallback: string): Promise<Response> {
	if (response.ok) return response;
	throw new Error(await refusalMessage(response, fallback));
}

export async function updateName(name: string): Promise<void> {
	await authOrThrow(
		await authPost("/update-user", { name: name.trim() }),
		"Could not save your name.",
	);
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
	const response = await authPost("/change-password", {
		currentPassword,
		newPassword,
		revokeOtherSessions: true,
	});
	if (response.ok) return;
	// SAFETY: narrowing only; a non-JSON body degrades to the generic message.
	const body = (await response
		.clone()
		.json()
		.catch(() => null)) as { code?: string } | null;
	if (body?.code === "INVALID_PASSWORD") throw new Error("Current password is incorrect.");
	throw new Error(await refusalMessage(response, "Could not change your password."));
}

export interface AccountSession {
	id: string;
	userAgent: string | null;
	updatedAt: string;
	current: boolean;
}

export async function listSessions(): Promise<AccountSession[]> {
	const [list, current] = await Promise.all([
		fetch(apiUrl("/api/auth/list-sessions"), { credentials: "include" }),
		fetch(apiUrl("/api/auth/get-session"), { credentials: "include" }),
	]);
	await authOrThrow(list, "Could not load your sessions.");
	// SAFETY: guarded by the ok check; the body is better-auth's session list,
	// and only these three fields are read.
	const rows = (await list.json()) as Array<{
		id: string;
		userAgent?: string | null;
		updatedAt: string;
	}>;
	// SAFETY: narrowing only; a failed or empty answer marks nothing current.
	const currentId = (
		(await current.json().catch(() => null)) as { session?: { id?: string } } | null
	)?.session?.id;
	return rows.map((row) => ({
		id: row.id,
		userAgent: row.userAgent ?? null,
		updatedAt: row.updatedAt,
		current: row.id === currentId,
	}));
}

export async function revokeOtherSessions(): Promise<void> {
	await authOrThrow(
		await authPost("/revoke-other-sessions", {}),
		"Could not sign out your other sessions.",
	);
}

export interface InvitationPreview {
	workspace: string;
	display_name: string;
	role: "owner" | "member";
	expires_at: number;
}

/* The invitation screen's two calls. Like sign-in, they do NOT go through
 * `client.ts`: a bad token answers 404, and redirecting that to /login would
 * replace "this link does not work" with a login form and no explanation. */
export async function readInvitation(token: string): Promise<InvitationPreview | null> {
	const response = await fetch(apiUrl(`/api/invitations/${encodeURIComponent(token)}`), {
		credentials: "include",
	});
	if (!response.ok) return null;
	// SAFETY: guarded by response.ok, and the body comes from routes/invitations.ts
	// in this repository, which returns exactly these four fields.
	const body = (await response.json()) as { item: InvitationPreview };
	return body.item;
}

export async function redeemInvitation(
	token: string,
	credentials?: { email: string; password: string; name?: string },
): Promise<void> {
	const response = await fetch(apiUrl(`/api/invitations/${encodeURIComponent(token)}/redeem`), {
		method: "POST",
		credentials: "include",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(credentials ?? {}),
	});
	if (response.ok) return;
	throw new Error(await refusalMessage(response, "This invitation link is not usable."));
}

/* ─── Personal API keys, for MCP clients ───
 *
 * better-auth's api-key plugin, through the same session cookie. A key acts as
 * its owner; the API never returns a key's value again after creating it, so the
 * caller shows it once. */

export interface ApiKeyRow {
	id: string;
	name: string | null;
	/** The first characters of the key, to recognise it by. */
	start: string | null;
	createdAt: string;
	expiresAt: string | null;
}

interface StoredApiKey {
	id: string;
	name?: string | null;
	start?: string | null;
	createdAt: string;
	expiresAt?: string | null;
}

export async function listApiKeys(): Promise<ApiKeyRow[]> {
	const response = await authOrThrow(
		await fetch(apiUrl("/api/auth/api-key/list"), { credentials: "include" }),
		"Could not load your keys.",
	);
	// SAFETY: guarded by the ok check; the plugin answers a list, or (newer versions) `{ apiKeys }`, and only these fields are read.
	const body = (await response.json()) as StoredApiKey[] | { apiKeys?: StoredApiKey[] };
	const rows = Array.isArray(body) ? body : (body.apiKeys ?? []);
	return rows.map((row) => ({
		id: row.id,
		name: row.name ?? null,
		start: row.start ?? null,
		createdAt: row.createdAt,
		expiresAt: row.expiresAt ?? null,
	}));
}

/** Creates a key and returns its value — the only time the value is available. */
export async function createApiKey(
	name: string,
	expiresInDays: number | null,
): Promise<{ id: string; key: string }> {
	const body = {
		name: name.trim(),
		...(expiresInDays ? { expiresIn: expiresInDays * 24 * 60 * 60 } : {}),
	};
	const response = await authOrThrow(
		await authPost("/api-key/create", body),
		"Could not create the key.",
	);
	// SAFETY: guarded by the ok check; the plugin answers the created key with its value.
	const created = (await response.json()) as { id: string; key: string };
	return { id: created.id, key: created.key };
}

export async function deleteApiKey(id: string): Promise<void> {
	await authOrThrow(await authPost("/api-key/delete", { keyId: id }), "Could not delete the key.");
}
