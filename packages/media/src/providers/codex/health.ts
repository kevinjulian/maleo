import { CODEX_CLI_COMMAND, HEALTH_TIMEOUT_MS, codexCliPath } from "./constants.ts";
import { spawnCapture } from "./spawn.ts";

export type CodexHealth = "ready" | "unconfigured" | "down";

/* `ready` only when the CLI is present and answers a cheap self-check.
 * `codex --version` on purpose: a real generation self-check would spend a model
 * turn, and health is polled by the settings picker on every render. */
export async function codexImageHealth(): Promise<CodexHealth> {
	if (!codexCliPath()) return "unconfigured";
	try {
		const result = await spawnCapture(CODEX_CLI_COMMAND, ["--version"], {
			timeoutMs: HEALTH_TIMEOUT_MS,
			label: "Codex CLI health check",
		});
		return result.code === 0 ? "ready" : "down";
	} catch {
		return "down";
	}
}
