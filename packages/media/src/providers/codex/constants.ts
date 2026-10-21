/* Runner boundary configuration. `imagegen` is a Codex skill, not an importable
 * Bun API, so this package reaches it by spawning the `codex` CLI. No runner
 * path to configure. */
import { whichSync } from "./which.ts";

export const CODEX_PROVIDER_ID = "codex";
export const CODEX_CLI_COMMAND = "codex";
export const CODEX_IMAGE_FEATURE = "image_generation";
/** Codex invokes a skill when the prompt names it with a `$` prefix. */
export const CODEX_IMAGE_SKILL = "$imagegen";

export const RUNNER_TIMEOUT_ENV = "MALEO_CODEX_IMAGE_TIMEOUT_MS";
export const RUNNER_MODEL_ENV = "MALEO_CODEX_IMAGE_MODEL";

// A live generation was observed at ~76s; leave real headroom above that.
export const DEFAULT_IMAGE_TIMEOUT_MS = 300_000;
export const HEALTH_TIMEOUT_MS = 10_000;

export const SUPPORTED_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"] as const;
export type CodexImageExtension = (typeof SUPPORTED_IMAGE_EXTENSIONS)[number];

export function codexCliPath(): string | null {
	return whichSync(CODEX_CLI_COMMAND);
}

export function codexImageTimeoutMs(): number {
	const raw = Number(process.env[RUNNER_TIMEOUT_ENV]?.trim());
	return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_IMAGE_TIMEOUT_MS;
}

// Optional model override; without it the CLI picks its configured default.
export function codexImageModel(): string | undefined {
	return process.env[RUNNER_MODEL_ENV]?.trim() || undefined;
}
