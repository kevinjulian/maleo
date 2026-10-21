// Registry of refreshable workspace secrets. Each entry knows how to
// take the current value (and optionally other secrets / dashboard
// env) and produce a new value, plus any side-effect writes (e.g.
// rotating Threads also stamps issued_at + expires_in).

import { fieldOf } from "@maleo/shared";
import { readWorkspaceSecrets, writeWorkspaceSecrets } from "./workspace-secrets.ts";

export interface RefreshResult {
	key: string;
	new_value_masked: string;
	side_effects: Record<string, string>; // e.g. {THREADS_TOKEN_EXPIRES_IN: "5184000"}
}

type RefreshFn = (
	workspace: string,
	currentValue: string,
	allSecrets: Record<string, string>,
) => Promise<{ value: string; sideEffects?: Record<string, string> }>;

const registry = new Map<string, RefreshFn>();

registry.set("THREADS_ACCESS_TOKEN", async (_workspace, current) => {
	const url = new URL("https://graph.threads.net/refresh_access_token");
	url.searchParams.set("grant_type", "th_refresh_token");
	url.searchParams.set("access_token", current);
	const res = await fetch(url.toString());
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`threads refresh failed: HTTP ${res.status}: ${text.slice(0, 300)}`);
	}
	/* Checked, not asserted. This is the one refresh path where a wrong shape does
	 * not lose a value, it destroys one: the caller writes `value` straight back
	 * over the live secret, and `maskShort(undefined)` returns "" — so a response
	 * without `access_token` overwrote a working credential and reported success
	 * with an empty mask. Nothing downstream could tell that from a rotation. */
	const body: unknown = await res.json();
	const accessToken = fieldOf(body, "access_token");
	if (typeof accessToken !== "string" || !accessToken) {
		throw new Error(
			"threads refresh returned no access_token; the existing token was left untouched",
		);
	}
	const expiresIn = fieldOf(body, "expires_in");
	return {
		value: accessToken,
		sideEffects: {
			THREADS_TOKEN_ISSUED_AT: String(Date.now()),
			// Absent rather than invented: an expiry this code made up would be
			// treated as authoritative by whatever schedules the next refresh.
			...(typeof expiresIn === "number" ? { THREADS_TOKEN_EXPIRES_IN: String(expiresIn) } : {}),
		},
	};
});

export function isRefreshable(key: string): boolean {
	return registry.has(key);
}

export function refreshableKeys(): string[] {
	return Array.from(registry.keys());
}

function maskShort(value: string): string {
	if (!value) return "";
	if (value.length <= 4) return "***";
	return `••••${value.slice(-4)}`;
}

export async function refreshSecret(workspace: string, key: string): Promise<RefreshResult> {
	const fn = registry.get(key);
	if (!fn) throw new Error(`no refresh handler for key: ${key}`);
	const secrets = readWorkspaceSecrets(workspace);
	const current = secrets[key];
	if (!current) throw new Error(`secret ${key} is not set for workspace ${workspace}`);
	const { value, sideEffects } = await fn(workspace, current, secrets);
	const updated = { ...secrets, [key]: value, ...sideEffects };
	writeWorkspaceSecrets(workspace, updated);
	return {
		key,
		new_value_masked: maskShort(value),
		side_effects: sideEffects ?? {},
	};
}
