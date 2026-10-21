/* adopt-mastra-internal-agent 2.14: text runs on API-backed models only.
 *
 * With no API key the product still serves settings and reports the text
 * capability as unconfigured with its reason. No CLI runner is offered. A stored
 * selection naming a removed CLI provider is reported by name, not replaced. */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeMaleoDb } from "@maleo/db/connection";
import { TEST_CALLER, testApp } from "../middleware/auth-testing.ts";
import {
	readTextProviderSelection,
	writeTextProviderSelection,
} from "../lib/text-provider-settings.ts";
import { runPrompt, setTextProviderSelectionReader } from "../lib/text-runner.ts";
import { settingsRoutes } from "./settings.ts";

const app = testApp(settingsRoutes(), TEST_CALLER);
const priorKey = process.env.MALEO_AI_API_KEY;

interface Status {
	effective_provider: string | null;
	selection_error: string | null;
	providers: Array<{
		id: string;
		health: string;
		health_reason: string | null;
		supported: boolean;
	}>;
}

const status = async (): Promise<Status> => await (await app.request("/text-provider")).json();

beforeEach(() => {
	delete process.env.MALEO_AI_API_KEY;
	// As the API wires it at boot (index.ts).
	setTextProviderSelectionReader(readTextProviderSelection);
});
afterEach(async () => {
	await writeTextProviderSelection(null);
	setTextProviderSelectionReader(() => ({}));
	if (priorKey === undefined) delete process.env.MALEO_AI_API_KEY;
	else process.env.MALEO_AI_API_KEY = priorKey;
});
afterAll(async () => {
	await closeMaleoDb();
});

describe("the text capability on API-backed models", () => {
	test("without an API key, settings serve and report text unconfigured with why; no CLI runner is offered", async () => {
		const res = await app.request("/text-provider");
		expect(res.status).toBe(200);
		const body: Status = await res.json();
		expect(body.providers).toEqual([
			expect.objectContaining({
				id: "api",
				health: "unconfigured",
				health_reason: "MALEO_AI_API_KEY is not set",
				supported: true,
			}),
		]);
		expect(body.effective_provider).toBeNull();
		expect(body.selection_error).toContain('no ready provider implements capability "text"');
	});

	test("a stored selection naming a removed CLI provider fails visibly by name, with nothing substituted", async () => {
		process.env.MALEO_AI_API_KEY = "sk-test";
		await writeTextProviderSelection({ providerId: "codex", model: "gpt-5.5" });
		const body = await status();
		expect(body.effective_provider).toBeNull();
		expect(body.selection_error).toContain(
			'"codex" was removed: the Codex CLI can no longer generate text. Select an API provider in Settings',
		);
		await expect(runPrompt("hello", { timeoutMs: 1000 })).rejects.toThrow('"codex" was removed');
	});
});
