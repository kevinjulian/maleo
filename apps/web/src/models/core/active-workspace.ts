/* The workspace the operator is currently working in.
 *
 * One value, read by everything scoped and written by one control. It lives here
 * rather than in `stores/` because the api layer has to read it — `client.ts`
 * carries it on every scoped request — and the api layer ranks below stores.
 * Pure: no React, no fetch. The React binding is hooks/workspace.
 *
 * Precedence is URL, then persisted, then `default`:
 *
 *  - the URL wins so a shared link opens the workspace it was shared FROM,
 *    rather than whichever one the recipient last used;
 *  - persistence is what makes a fresh tab open where the operator left off;
 *  - `default` is the floor because it owns every project written before
 *    scoping, so a first load lands on a full app rather than an empty one that
 *    reads as data loss.
 */

/** The query key the address and every scoped request use. One spelling. */
export const WORKSPACE_QUERY_KEY = "workspace";

const STORAGE_KEY = "maleo.activeWorkspace";

/* Matches `assertValidWorkspaceName` on the server. Applied to values coming
 * off the URL and out of storage because both are attacker- and typo-reachable,
 * and a junk value would otherwise ride on every request until the server
 * refused it. */
const VALID = /^[a-z0-9_-]+$/i;

export const FALLBACK_WORKSPACE = "default";

function sanitize(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed && VALID.test(trimmed) ? trimmed : null;
}

function readStored(): string | null {
	try {
		return sanitize(window.localStorage.getItem(STORAGE_KEY));
	} catch {
		return null; // private mode, a disabled store, or no window at all
	}
}

function persist(name: string): void {
	try {
		window.localStorage.setItem(STORAGE_KEY, name);
	} catch {
		/* ignore quota / disabled storage */
	}
}

/** Resolve the workspace a load starts in, given the address it started at.
 *  Pure, so the precedence can be tested without a browser. */
export function resolveInitialWorkspace(search: string, stored: string | null): string {
	const fromUrl = sanitize(new URLSearchParams(search).get(WORKSPACE_QUERY_KEY));
	return fromUrl ?? sanitize(stored) ?? FALLBACK_WORKSPACE;
}

let active = FALLBACK_WORKSPACE;
let initialized = false;
const listeners = new Set<() => void>();

/** Called once at shell start-up. Idempotent — a second call is ignored so a
 *  remount cannot silently move the operator. */
export function initActiveWorkspace(search?: string): string {
	if (initialized) return active;
	initialized = true;
	// Callable where there is no window. This runs at module scope in the shell,
	// and the static-render tests import that module outside a DOM — crashing
	// there would make an unrelated suite fail on a line about workspaces.
	const query = search ?? (typeof window === "undefined" ? "" : window.location.search);
	active = resolveInitialWorkspace(query, readStored());
	persist(active);
	return active;
}

export function getActiveWorkspace(): string {
	return active;
}

/** Switch workspace. Immediate and unconfirmed by design: the action is
 *  reversible and addressable, so a prompt would charge friction on every
 *  switch to guard a mistake that costs one action to undo. */
export function setActiveWorkspace(name: string): void {
	const next = sanitize(name);
	if (!next || next === active) return;
	active = next;
	initialized = true;
	persist(next);
	for (const listener of listeners) listener();
}

export function subscribeActiveWorkspace(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/* The active workspace has ceased to exist.
 *
 * Deleting the workspace you are working in leaves the stored value naming
 * something that is gone — and persistence is exactly what would carry it
 * through the reload that follows, so every scoped request afterwards is
 * refused as an unknown workspace. Clearing the store lets the next load
 * resolve a workspace the operator still belongs to.
 *
 * Only the STORED value is cleared. The in-memory one goes with the reload the
 * caller performs, and leaving it alone means a caller that forgets to reload
 * gets refusals it can see rather than a silently different tenant. */
export function forgetStoredWorkspace(): void {
	try {
		window.localStorage.removeItem(STORAGE_KEY);
	} catch {
		/* private mode, a disabled store: nothing to forget */
	}
}

/** Test seam. The module holds process-wide state, so a suite that switches
 *  workspaces has to be able to put it back. */
export function resetActiveWorkspaceForTests(): void {
	active = FALLBACK_WORKSPACE;
	initialized = false;
	listeners.clear();
}
