// Tiny fetch wrapper for cookie-authed API calls
const json = { "content-type": "application/json" };

import { apiUrl } from "@models/core/asset-url.ts";
export { API_BASE, apiUrl, assetUrl } from "@models/core/asset-url.ts";
import { getActiveWorkspace, WORKSPACE_QUERY_KEY } from "@models/core/active-workspace.ts";

/* The tenant rides on every content-operations request, added here rather than
 * at each call site.
 *
 * At the call sites it was optional at every route and omitted by every caller,
 * which is how the app came to be multi-tenant in schema and single-tenant in
 * practice: a forgotten parameter did not fail, it silently widened to `default`.
 * One seam means a new endpoint under this prefix is scoped the day it is added.
 *
 * Scoped to `/api/operations` and `/api/voice-clones` deliberately, and this
 * list is the decision, not an accident of what was easy:
 *
 *  - `/api/voice-clones` is a workspace's own voice library, in the same content
 *    scope as operations: switching workspace must change which clones are
 *    listed, and an unscoped create would file someone's recording under the
 *    wrong tenant.
 *
 *  - `/api/credits` and `/api/settings` are app/admin scope and MUST stay
 *    global. Switching workspace must not change a balance or a configuration.
 *  - `/api/image-gen/generate-scene` carries a project, and a project's
 *    generation is attributed to the project's OWN workspace — never to the one
 *    the operator happens to be viewing from. Sending the active workspace there
 *    is exactly the bug the split exists to prevent.
 *  - `/api/workspaces` is how a workspace is chosen; scoping it would make the
 *    choice unreachable.
 *
 * Image READS take the workspace as an explicit argument instead, because the
 * same route family also serves the generation calls above. */
function scopedPath(path: string, workspace = getActiveWorkspace()): string {
	if (!path.startsWith("/api/operations") && !path.startsWith("/api/voice-clones")) return path;
	const [base, existing] = path.split("?");
	const params = new URLSearchParams(existing);
	params.set(WORKSPACE_QUERY_KEY, workspace);
	return `${base}?${params.toString()}`;
}

/** Resolve a request URL, carrying the active workspace when the path is scoped. */
export function requestUrl(path: string, workspace?: string): string {
	return apiUrl(scopedPath(path, workspace));
}

export class ApiError extends Error {
	status: number;
	body: unknown;
	constructor(status: number, message: string, body: unknown) {
		super(message);
		this.status = status;
		this.body = body;
	}
}

function parseBody(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

/** A string field off a decoded error body, without naming a dictionary type for
 *  a shape the server is free to change. */
function errorField(parsed: unknown, key: string): string | undefined {
	if (parsed === null || typeof parsed !== "object") return undefined;
	const value = Object.getOwnPropertyDescriptor(parsed, key)?.value;
	return typeof value === "string" ? value : undefined;
}

/** The message to show for a failed response: whatever the server named it, else
 *  the raw body, capped. One implementation — it was written out twice, and the
 *  two copies read `error` and `message` in the same order for the same reason. */
function errorDetail(parsed: unknown, text: string): string {
	return errorField(parsed, "error") ?? errorField(parsed, "message") ?? text.slice(0, 300);
}

/** The decoded response body, at the type the CALLER named.
 *
 *  SAFETY: nothing here verifies that shape, and nothing here can. This module is
 *  the transport for roughly a hundred endpoints and `T` is supplied at the call
 *  site from a path built as a string, so there is no schema for it to look up —
 *  see the decision recorded in the `parse-boundaries-into-domain-types` design.
 *  A response parse belongs in the per-endpoint modules that know both the path
 *  and the shape. This is the one place the claim is made, rather than the eight
 *  it used to be made in. */
async function decoded<T>(r: Response): Promise<T> {
	// SAFETY: as above — the caller names `T`, this module cannot check it, and a
	// response parse belongs in the per-endpoint modules.
	return (await r.json()) as T;
}

/* GETs already in flight, by resolved URL.
 *
 * Two components that each need the workspace list, or the credit balance, ask
 * for it independently and get two requests for the same bytes — measured on a
 * project open, and true of any endpoint a second surface starts reading. They
 * share the one request instead.
 *
 * In FLIGHT only: the entry is removed as soon as the response settles, so this
 * is a coalescer and not a cache. A cache would have to answer when something
 * becomes stale, which is a question this layer has no way to answer and the
 * wrong place to guess at. */
const inFlight = new Map<string, Promise<unknown>>();

/* One request path, and the two policies the helpers below differ on.
 *
 * They were nine near-copies of the same six lines, and the copies had drifted:
 * `get`, `postForm`, `getOrNull` and `getBlob` redirect to /login on a 401 while
 * `post`, `put`, `patch` and `del` report it as an ordinary failure; `post`,
 * `postForm`, `getOrNull` and `getBlob` throw `ApiError` (status + parsed body)
 * while the rest throw a plain `Error`. Neither split looks deliberate, but both
 * are preserved exactly here rather than quietly unified — a 401 that starts
 * redirecting is a visible change to what happens when a session expires
 * mid-edit, and that is a decision, not a refactor.
 *
 * Stated as a table so the drift is legible: each helper names its policy on one
 * line instead of hiding it in a copied block. */
interface RequestPolicy {
	/** Keep asynchronous jobs bound to their originating workspace. */
	readonly workspace?: string;
	/** Send the operator to /login on a 401 instead of reporting an error. */
	readonly redirectOn401?: boolean;
	/** Throw `ApiError` (status + parsed body) rather than a plain `Error`. */
	readonly richError?: boolean;
	/** Answer null for a 404 rather than throwing. */
	readonly nullOn404?: boolean;
}

/** The rich error for a failed response body, shared by `request` and the upload transport. */
export function responseError(path: string, status: number, text: string): ApiError {
	const parsed = parseBody(text);
	return new ApiError(status, `${path} ${status}: ${errorDetail(parsed, text)}`, parsed);
}

async function fail(path: string, r: Response, rich: boolean): Promise<never> {
	const error = responseError(path, r.status, await r.text().catch(() => ""));
	throw rich ? error : new Error(error.message);
}

export async function request(
	path: string,
	init: RequestInit,
	policy: RequestPolicy = { richError: true },
): Promise<Response> {
	const r = await fetch(requestUrl(path, policy.workspace), { credentials: "include", ...init });
	if (policy.redirectOn401 && r.status === 401) {
		window.location.href = "/login";
		throw new Error("unauthorized");
	}
	if (policy.nullOn404 && r.status === 404) return r;
	if (!r.ok) await fail(path, r, policy.richError ?? false);
	return r;
}

export async function get<T>(path: string): Promise<T> {
	const url = requestUrl(path);
	const shared = inFlight.get(url);
	if (shared) {
		// SAFETY: the map is keyed by RESOLVED URL, and the only writer is the line
		// below, which stores the `getUncached<T>` promise for that same URL. Two
		// callers sharing an entry therefore asked for the same bytes; if they named
		// different `T`s for one URL, they already disagreed before this line.
		const sharedAsT = shared as Promise<T>;
		return sharedAsT;
	}
	const pending = getUncached<T>(path);
	inFlight.set(url, pending);
	try {
		return await pending;
	} finally {
		inFlight.delete(url);
	}
}

async function getUncached<T>(path: string): Promise<T> {
	return decoded<T>(await request(path, {}, { redirectOn401: true }));
}

export async function post<T>(path: string, body?: unknown): Promise<T> {
	const init = { method: "POST", headers: json, body: body ? JSON.stringify(body) : undefined };
	return decoded<T>(await request(path, init, { richError: true }));
}

export async function put<T>(
	path: string,
	body: unknown,
	type: "json" | "text" = "json",
): Promise<T> {
	const init = {
		method: "PUT",
		headers: { "content-type": type === "text" ? "text/plain" : "application/json" },
		body: typeof body === "string" ? body : JSON.stringify(body),
	};
	return decoded<T>(await request(path, init, {}));
}

export async function patch<T>(path: string, body: unknown): Promise<T> {
	return decoded<T>(
		await request(path, { method: "PATCH", headers: json, body: JSON.stringify(body) }, {}),
	);
}

/* A DELETE may carry a body.
 *
 * Almost none do — the id is in the path. Workspace deletion is the exception:
 * it requires the operator to type the workspace's name, and that confirmation
 * is the payload rather than a flag, because a boolean is something a client
 * sets once and forgets on an operation that has no undo. */
export async function del<T>(path: string, body?: unknown): Promise<T> {
	const init: RequestInit =
		body === undefined
			? { method: "DELETE" }
			: { method: "DELETE", headers: json, body: JSON.stringify(body) };
	return decoded<T>(await request(path, init, {}));
}

/** POST multipart form data. The JSON helpers always set a JSON content-type, so
 *  file uploads used to call `fetch` directly and skipped `apiUrl()` with it —
 *  which meant they resolved against the web origin whenever `API_BASE` was set.
 *  No content-type header: the browser sets it with the multipart boundary. */
export async function postForm<T>(path: string, form: FormData): Promise<T> {
	const policy = { redirectOn401: true, richError: true };
	return decoded<T>(await request(path, { method: "POST", body: form }, policy));
}

/** GET a resource that legitimately may not exist, returning null for 404.
 *
 *  Only 404. Callers that used to treat every failure as absence turned a server
 *  error into "there is nothing here", which for a question like "is a run
 *  already in flight?" invites the caller to start a second one. */
export async function getOrNull<T>(path: string): Promise<T | null> {
	const policy = { redirectOn401: true, richError: true, nullOn404: true };
	const r = await request(path, {}, policy);
	return r.status === 404 ? null : decoded<T>(r);
}
