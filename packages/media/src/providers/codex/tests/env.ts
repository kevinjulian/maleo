import { chmodSync, copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const FAKE_CODEX_SOURCE = fileURLToPath(
	new URL("./fixtures/fake-codex.sh", import.meta.url),
);

const MANAGED_KEYS = [
	"PATH",
	"CACHE_DIR",
	"CODEX_HOME",
	"MALEO_CODEX_IMAGE_TIMEOUT_MS",
	"MALEO_CODEX_IMAGE_MODEL",
	"FAKE_CODEX_MODE",
	"FAKE_CODEX_PROMPT_LOG",
	"FAKE_CODEX_ARGV_LOG",
	"FAKE_CODEX_ARGS_LOG",
] as const;

export function snapshotEnv(): Record<string, string | undefined> {
	return Object.fromEntries(MANAGED_KEYS.map((key) => [key, process.env[key]]));
}

export function restoreEnv(snapshot: Record<string, string | undefined>): void {
	for (const key of MANAGED_KEYS) {
		const value = snapshot[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
}

/* Puts a stub `codex` on PATH. The provider spawns the CLI by name exactly as the
 * text provider does, so the only way to drive it in tests is to own PATH. */
export function useFakeCodex(): void {
	const dir = mkdtempSync(join(tmpdir(), "maleo-codex-bin-"));
	const bin = join(dir, "codex");
	copyFileSync(FAKE_CODEX_SOURCE, bin);
	chmodSync(bin, 0o755);
	// Prepend, never replace: the stub is a shell script and still needs the
	// system utilities the rest of PATH provides.
	process.env.PATH = `${dir}:${process.env.PATH ?? ""}`;
}

// No codex CLI anywhere on PATH.
export function useNoCodex(): void {
	process.env.PATH = "";
}
