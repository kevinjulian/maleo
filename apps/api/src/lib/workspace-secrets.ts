// Per-workspace secrets.yaml read/write: chmod 0600, YAML object, commented header.

import { entriesOfUnknown, textOf } from "@maleo/shared";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { workspacePath } from "./workspace-paths.ts";

const HEADER =
	"# maleo per-workspace secrets — chmod 0600\n# do NOT commit. workspaces/ is gitignored by default.\n";

export function readWorkspaceSecrets(workspace: string): Record<string, string> {
	const p = workspacePath(workspace, "secrets.yaml");
	if (!existsSync(p)) return {};
	const raw = parseYaml(readFileSync(p, "utf8")) ?? {};
	if (typeof raw !== "object" || Array.isArray(raw)) return {};
	const out: Record<string, string> = {};
	for (const [k, v] of entriesOfUnknown(raw)) {
		if (v != null) out[k] = textOf(v);
	}
	return out;
}

export function writeWorkspaceSecrets(workspace: string, data: Record<string, string>): void {
	const p = workspacePath(workspace, "secrets.yaml");
	const yaml = Object.keys(data).length === 0 ? "" : stringifyYaml(data);
	writeFileSync(p, HEADER + yaml, { mode: 0o600 });
	try {
		chmodSync(p, 0o600);
	} catch {
		/* best-effort on non-unix */
	}
}

export function setWorkspaceSecret(workspace: string, key: string, value: string): void {
	const current = readWorkspaceSecrets(workspace);
	current[key] = value;
	writeWorkspaceSecrets(workspace, current);
}

export function unsetWorkspaceSecret(workspace: string, key: string): void {
	const current = readWorkspaceSecrets(workspace);
	delete current[key];
	writeWorkspaceSecrets(workspace, current);
}

// Mask all but last 4 chars for display. Empty / very short values
// returned as "***" to avoid leaking length info.
export function maskSecret(value: string): string {
	if (!value) return "";
	if (value.length <= 4) return "***";
	return `••••${value.slice(-4)}`;
}
