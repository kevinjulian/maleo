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
import { setConfigSource } from "@maleo/shared/provider-config";
import { capabilitiesRoutes, providerRoutes } from "./capabilities.ts";
import type { Caller } from "@maleo/auth/session";

const app = testApp(settingsRoutes(), TEST_CALLER);
const priorKey = process.env.MALEO_AI_API_KEY;
let modelCalls = 0;
let modelStatus = 200;
const endpoint = Bun.serve({
	port: 0,
	fetch: () => {
		modelCalls++;
		return Response.json(
			modelStatus === 200
				? { data: [{ id: "deepseek-flash" }] }
				: { error: "private-key private-metadata" },
			{ status: modelStatus },
		);
	},
});
const member: Caller = { userId: "model-member", email: "member@example.com", role: "member" };

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
	setConfigSource(null);
	await writeTextProviderSelection(null);
	setTextProviderSelectionReader(() => ({}));
	if (priorKey === undefined) delete process.env.MALEO_AI_API_KEY;
	else process.env.MALEO_AI_API_KEY = priorKey;
});
afterAll(async () => {
	await endpoint.stop(true);
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
	test("member receives safe endpoint options, can refresh, and cannot change global configuration", async () => {
		modelCalls = 0;
		modelStatus = 200;
		const config: Record<string, string> = {
			MALEO_AI_API_BASE_URL: `http://127.0.0.1:${endpoint.port}/v1`,
			MALEO_AI_API_KEY: "private-key",
			MALEO_AI_API_MODELS: "declared-model",
		};
		setConfigSource({ resolve: (key) => config[key] });
		await writeTextProviderSelection({ providerId: "api", model: "gpt-5.5" });
		const app = testApp(settingsRoutes(), member);
		const first = await app.request("/text-provider");
		expect(first.status).toBe(200);
		const body = await first.json();
		expect(body.providers[0]).toMatchObject({
			model_options: [
				{ id: "deepseek-flash", source: "discovered" },
				{ id: "declared-model", source: "declared" },
			],
			discovery: { status: "ready" },
		});
		expect(body.selection_error).toContain("does not offer model");
		await app.request("/text-provider");
		expect(modelCalls).toBe(1);
		modelStatus = 401;
		const retry = await app.request("/text-provider?refresh=true");
		const failure = await retry.json();
		expect(failure.providers[0].discovery).toMatchObject({ status: "error", models: [] });
		expect(failure.providers[0].models).toEqual(["declared-model"]);
		expect(modelCalls).toBe(2);
		for (const view of [body, failure]) {
			const serialized = JSON.stringify(view);
			for (const secret of [
				"private-key",
				"private-metadata",
				config.MALEO_AI_API_BASE_URL,
				"value_masked",
				'"config":',
			])
				expect(serialized).not.toContain(secret);
		}
		expect(
			(
				await testApp(capabilitiesRoutes(), member).request("/text/provider", {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ provider_id: "api", model: "deepseek-flash" }),
				})
			).status,
		).toBe(403);
		expect(
			(await testApp(providerRoutes(), member).request("/api/config", { method: "PUT" })).status,
		).toBe(403);
		expect(await readTextProviderSelection()).toEqual({
			default: { providerId: "api", model: "gpt-5.5" },
		});
	});
});
