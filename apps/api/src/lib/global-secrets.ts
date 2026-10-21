/* App-global secrets — `<data>/secrets.yaml`, chmod 0600.
 *
 * The sibling of `workspace-secrets.ts`, for credentials that are not
 * per-workspace. The AI text provider's API key is the first: provider
 * selection is application-level, so duplicating its key across every workspace
 * would be seven copies of one secret with seven chances to rotate incompletely.
 *
 * Deliberately NOT stored in `global_settings`. The settings table is plaintext
 * SQLite with no permission story, and a key placed there lands in every
 * database backup and dump. This file carries the same `chmod 0600` and the
 * same gitignore the per-workspace secrets already rely on; `global_settings`
 * holds only the key's NAME.
 *
 * Loaded into `process.env` at boot so environment configuration keeps priority. */
import { entriesOfUnknown, textOf } from "@maleo/shared";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { resolveDataDir } from "./workspace/paths.ts";

const HEADER =
	"# maleo app-global secrets — chmod 0600\n# do NOT commit. Holds credentials that are not per-workspace.\n";

export function globalSecretsPath(): string {
	return join(resolveDataDir(), "secrets.yaml");
}

export function readGlobalSecrets(): Record<string, string> {
	const p = globalSecretsPath();
	if (!existsSync(p)) return {};
	const raw = parseYaml(readFileSync(p, "utf8")) ?? {};
	if (typeof raw !== "object" || Array.isArray(raw)) return {};
	const out: Record<string, string> = {};
	for (const [k, v] of entriesOfUnknown(raw)) {
		if (v != null) out[k] = textOf(v);
	}
	return out;
}

export function writeGlobalSecrets(data: Record<string, string>): void {
	const p = globalSecretsPath();
	const yaml = Object.keys(data).length === 0 ? "" : stringifyYaml(data);
	writeFileSync(p, HEADER + yaml, { mode: 0o600 });
	try {
		chmodSync(p, 0o600);
	} catch {
		/* best-effort on non-unix */
	}
}

export function setGlobalSecret(key: string, value: string): void {
	writeGlobalSecrets({ ...readGlobalSecrets(), [key]: value });
}

export function unsetGlobalSecret(key: string): void {
	const current = readGlobalSecrets();
	delete current[key];
	writeGlobalSecrets(current);
}

/* Publish stored secrets into the environment, without clobbering anything the
 * operator set explicitly. An env var passed on the command line or through the
 * deployment is a deliberate override and must win over a file written by the
 * settings UI — otherwise a stale saved key silently beats the one someone just
 * exported to debug with. */
export function loadGlobalSecretsIntoEnv(): void {
	for (const [key, value] of Object.entries(readGlobalSecrets())) {
		if (!value) continue;
		if ((process.env[key] ?? "").trim()) continue;
		process.env[key] = value;
	}
}

// Mask all but the last 4 chars for display. Short values collapse to "***" so
// the mask does not leak length.
export function maskSecret(value: string): string {
	if (!value) return "";
	if (value.length <= 4) return "***";
	return `••••${value.slice(-4)}`;
}
