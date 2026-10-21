// Read/write dashboard-root .env. Edits preserve existing comments
// and ordering — only matching key lines are rewritten; new keys
// append at end. Allowlist guards which keys are exposed to UI.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Keys editable from the Settings UI. Keep this list curated — never
// expose arbitrary process.env (would leak host secrets).
export const ALLOWED_KEYS = [
	"MALEO_GEN_WORKER_URL",
	"MALEO_GEN_WORKER_TOKEN",
	"MALEO_GEN_WORKER_PUBLIC_URL",
	"MALEO_VIDEO_URL",
	"MALEO_VIDEO_TOKEN",
	"TELEGRAM_BOT_TOKEN",
	"TELEGRAM_CHAT_ID",
	/* Optional override pinning the BrowserOS search tool name when discovery is
	 * ambiguous. Not a provider field: it tunes how the provider talks to a
	 * service, rather than naming the service or its credential. */
	"BROWSEROS_SEARCH_TOOL",
] as const;

/* Deliberately NOT here: the TTS service URLs, the BrowserOS endpoint, and every
 * other value a provider DECLARES. Those are edited on the provider's own page,
 * where the form is generated from the declaration and the value is checked
 * before it is saved. Listing them in both places would give one value two
 * editors with different rules — and this one writes a `.env` file a container
 * restart discards, which is the failure the provider surface exists to end.
 *
 * `provider-key-ownership.bun.test.ts` fails if the two lists ever overlap again. */

export type AllowedKey = (typeof ALLOWED_KEYS)[number];

function envPath(): string {
	return resolve(process.cwd(), ".env");
}

function isKeyLine(line: string, key: string): boolean {
	const trimmed = line.trim();
	if (!trimmed || trimmed.startsWith("#")) return false;
	const eq = trimmed.indexOf("=");
	if (eq < 0) return false;
	return trimmed.slice(0, eq).trim() === key;
}

function formatValue(value: string): string {
	// Quote only when contains whitespace, '#', or starts/ends with space.
	if (/\s|#|"|'/.test(value) || value.trim() !== value) {
		return `"${value.replace(/"/g, '\\"')}"`;
	}
	return value;
}

export function readDashboardEnv(): Record<string, string> {
	const p = envPath();
	if (!existsSync(p)) return {};
	const out: Record<string, string> = {};
	for (const raw of readFileSync(p, "utf8").split("\n")) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const eq = line.indexOf("=");
		if (eq < 0) continue;
		const key = line.slice(0, eq).trim();
		if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) continue;
		let val = line.slice(eq + 1).trim();
		if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
			val = val.slice(1, -1);
		}
		out[key] = val;
	}
	return out;
}

// Returns merged view: file value when present, else process.env. UI
// uses this so values set only at launch time still show as "set".
export function effectiveEnv(): Record<string, string> {
	const file = readDashboardEnv();
	const out: Record<string, string> = {};
	for (const key of ALLOWED_KEYS) {
		const v = file[key] ?? process.env[key];
		if (v != null && v !== "") out[key] = v;
	}
	return out;
}

// Update one or more allowed keys in .env. Empty string deletes the
// key line. Non-allowed keys silently ignored. Also mutates
// process.env so reads later in the process see the new value
// without a restart (server-side fetch headers, etc.).
export function updateDashboardEnv(updates: Record<string, string>): void {
	const p = envPath();
	const allowed = new Set<string>(ALLOWED_KEYS);
	const filtered: Record<string, string> = {};
	for (const [k, v] of Object.entries(updates)) {
		if (allowed.has(k)) filtered[k] = v;
	}
	const existing = existsSync(p) ? readFileSync(p, "utf8") : "";
	const lines = existing.split("\n");
	const handled = new Set<string>();
	const out: string[] = [];
	for (const line of lines) {
		let replaced = false;
		for (const [k, v] of Object.entries(filtered)) {
			if (handled.has(k)) continue;
			if (isKeyLine(line, k)) {
				handled.add(k);
				if (v !== "") out.push(`${k}=${formatValue(v)}`);
				// else: drop line (deleting key)
				replaced = true;
				break;
			}
		}
		if (!replaced) out.push(line);
	}
	// Append new keys not present in file.
	const appends: string[] = [];
	for (const [k, v] of Object.entries(filtered)) {
		if (!handled.has(k) && v !== "") appends.push(`${k}=${formatValue(v)}`);
	}
	let content = out.join("\n");
	if (appends.length > 0) {
		if (content && !content.endsWith("\n")) content += "\n";
		content += `${appends.join("\n")}\n`;
	}
	writeFileSync(p, content, { mode: 0o600 });
	// Mirror to process.env so subsequent reads (without restart) pick up.
	for (const [k, v] of Object.entries(filtered)) {
		if (v === "") delete process.env[k];
		else process.env[k] = v;
	}
}
