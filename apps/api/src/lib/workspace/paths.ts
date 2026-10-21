import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const WORKSPACE_NAME_RE = /^[a-z0-9_-]+$/i;

function packageRoot(): string {
	return resolve(dirname(new URL(import.meta.url).pathname), "../../..");
}

// Monorepo root holds the shared data dir so generated output (DBs, workspaces)
// is easy to inspect at <repo>/data instead of buried under a package.
function repoRoot(): string {
	return resolve(packageRoot(), "../..");
}

export function resolveDataDir(): string {
	const explicit = process.env.MALEO_DATA_DIR?.trim();
	if (explicit) return resolve(explicit);
	return resolve(repoRoot(), "data");
}

export function resolveWorkspacesDir(): string {
	return join(resolveDataDir(), "workspaces");
}

// Reusable skill library — `data/skills/<name>.yaml`. Workspaces reference these
// by name in their `skills` list instead of inlining the full definition.
export function resolveSkillsDir(): string {
	return join(resolveDataDir(), "skills");
}

// Plugins are code (each has index.ts), not runtime data — they live at the
// core package root, resolved without an env override. MALEO_DATA_DIR is the
// single knob for relocating runtime data.
export function resolvePluginsDir(): string {
	return join(packageRoot(), "plugins");
}

export function assertValidWorkspaceName(name: string): void {
	if (!WORKSPACE_NAME_RE.test(name)) {
		throw new Error(
			`invalid workspace name "${name}" — allowed: alphanumerics, underscore, hyphen`,
		);
	}
}

export function resolveWorkspaceDir(name: string): string {
	assertValidWorkspaceName(name);
	const dir = join(resolveWorkspacesDir(), name);
	if (existsSync(join(dir, "config.yaml"))) return dir;
	throw new Error(`workspace "${name}" not found at ${dir}`);
}
