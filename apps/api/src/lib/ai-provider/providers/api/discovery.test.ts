import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { setConfigSource } from "@maleo/shared/provider-config";
import { API_BASE_URL_ENV, API_KEY_ENV, API_MODELS_ENV } from "./config.ts";
import { discoverTextModels, textEndpointIdentity, textModelOptions } from "./discovery.ts";
import { selectReadyProvider } from "../../selection.ts";
import { apiProvider } from "./index.ts";

let server: Server;
let values: Record<string, string>;
let calls: number;
let status: number;
let payload = "";
let authorization: string | undefined;
let hang: boolean;
let stallBody: boolean;
let generations: unknown[];

beforeEach(async () => {
	calls = 0;
	status = 200;
	payload = JSON.stringify({ data: [{ id: "deepseek-flash" }, { id: "deepseek-v4-pro" }] });
	hang = false;
	stallBody = false;
	generations = [];
	server = createServer((request, response) => {
		if (request.method === "POST") {
			let body = "";
			request.on("data", (chunk) => {
				body += chunk;
			});
			request.on("end", () => {
				generations.push(JSON.parse(body));
				response.writeHead(200, { "content-type": "application/json" });
				if (stallBody) {
					response.write('{"choices":[{"message":{"content":"{\\"lay');
					return;
				}
				response.end(
					JSON.stringify({
						choices: [{ message: { content: "Done" } }],
						usage: { prompt_tokens: 3, completion_tokens: 1 },
					}),
				);
			});
			return;
		}
		calls++;
		authorization = request.headers.authorization;
		if (hang) return;
		response.writeHead(status, { "content-type": "application/json" });
		response.end(payload);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing test server address");
	values = {
		[API_BASE_URL_ENV]: `http://127.0.0.1:${address.port}/v1`,
		[API_KEY_ENV]: "private-test-key",
	};
	setConfigSource({ resolve: (key) => values[key] });
});

afterEach(async () => {
	vi.restoreAllMocks();
	setConfigSource(null);
	server.closeAllConnections();
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
});

describe("endpoint model discovery", () => {
	test("parses endpoint IDs, coalesces requests, caches for 60 seconds and refreshes", async () => {
		const results = await Promise.all([
			discoverTextModels(),
			discoverTextModels(),
			discoverTextModels(),
		]);
		expect(results[0]).toEqual({ status: "ready", models: ["deepseek-flash", "deepseek-v4-pro"] });
		expect(calls).toBe(1);
		expect(authorization).toBe("Bearer private-test-key");
		await discoverTextModels();
		expect(calls).toBe(1);
		const now = Date.now();
		vi.spyOn(Date, "now").mockReturnValue(now + 60_001);
		await discoverTextModels();
		expect(calls).toBe(2);
		await discoverTextModels(true);
		expect(calls).toBe(3);
	});
	test("accepts empty lists and deduplicates IDs", async () => {
		payload = JSON.stringify({ data: [] });
		expect(await discoverTextModels()).toEqual({ status: "ready", models: [] });
		payload = JSON.stringify({ data: [{ id: "deepseek-flash" }, { id: "deepseek-flash" }] });
		expect((await discoverTextModels(true)).models).toEqual(["deepseek-flash"]);
	});
	test.each([
		null,
		{},
		{ data: "models" },
		{ data: [{ id: 7 }] },
		{ data: [{ id: "bad\nmodel" }] },
	])("refuses malformed response %j", async (invalid) => {
		payload = JSON.stringify(invalid);
		expect(await discoverTextModels()).toMatchObject({ status: "error", models: [] });
	});
	test.each([401, 403, 500])("returns safe HTTP %i failure", async (code) => {
		status = code;
		payload = JSON.stringify({ error: values });
		const result = await discoverTextModels();
		expect(result.status).toBe("error");
		expect(result.error).toContain(`HTTP ${code}`);
		expect(JSON.stringify(result)).not.toContain("private-test-key");
		expect(JSON.stringify(result)).not.toContain(values[API_BASE_URL_ENV]);
	});
	test.each([404, 405, 501])("identifies unsupported discovery (%i)", async (code) => {
		status = code;
		expect(await discoverTextModels()).toEqual({ status: "unsupported", models: [] });
	});
	test("bounds a stalled request without exposing network details", async () => {
		hang = true;
		const timeout = AbortSignal.timeout.bind(AbortSignal);
		const spy = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => timeout(20));
		expect(await discoverTextModels()).toMatchObject({ status: "error", models: [] });
		expect(spy).toHaveBeenCalledWith(10_000);
	});
	test("refreshes effective configuration and invalidates on credentials or declarations", async () => {
		let refreshed = 0;
		setConfigSource({
			resolve: (key) => values[key],
			refresh: async () => {
				refreshed++;
			},
		});
		const endpoint = textEndpointIdentity();
		await discoverTextModels();
		values[API_KEY_ENV] = "rotated-key";
		await discoverTextModels();
		expect(authorization).toBe("Bearer rotated-key");
		expect(textEndpointIdentity()).toBe(endpoint);
		values[API_MODELS_ENV] = "declared-model";
		await discoverTextModels();
		expect(calls).toBe(3);
		expect(refreshed).toBe(3);
		values[API_BASE_URL_ENV] += "/changed";
		expect(textEndpointIdentity()).not.toBe(endpoint);
		await discoverTextModels();
		expect(calls).toBe(4);
	});
	test("does not fetch without credentials", async () => {
		delete values[API_KEY_ENV];
		expect(await discoverTextModels()).toEqual({ status: "unconfigured", models: [] });
		expect(calls).toBe(0);
	});
	test("merges declarations with discovered IDs and keeps their source", async () => {
		values[API_MODELS_ENV] = "deepseek-flash, declared-model, declared-model, invalid model";
		expect((await textModelOptions()).options).toEqual([
			{ id: "deepseek-flash", source: "discovered" },
			{ id: "deepseek-v4-pro", source: "discovered" },
			{ id: "declared-model", source: "declared" },
		]);
	});
	test("rejects stale GPT choice and implicit GPT before either generation path", async () => {
		await expect(
			selectReadyProvider("text", { default: { providerId: "api", model: "gpt-5.5" } }),
		).rejects.toThrow("does not offer model");
		await expect(selectReadyProvider("text")).rejects.toThrow("Choose a text model");
		await expect(apiProvider.text!.generate({ prompt: "test" })).rejects.toThrow(
			"Choose a text model",
		);
		await expect(apiProvider.text!.generate({ prompt: "test", model: "gpt-5.5" })).rejects.toThrow(
			"does not offer model",
		);
		expect(generations).toEqual([]);
	});
	test("uses explicitly declared model when discovery is unsupported", async () => {
		status = 404;
		values[API_MODELS_ENV] = "local-model";
		const decision = await selectReadyProvider("text", {
			default: { providerId: "api", model: "local-model" },
		});
		expect(decision.choice.model).toBe("local-model");
		const result = await apiProvider.text!.generate({
			prompt: "test",
			model: decision.choice.model,
			thinking: "high",
		});
		expect(result).toMatchObject({
			model: "local-model",
			text: "Done",
			usage: { inputTokens: 3, outputTokens: 1 },
		});
		expect(generations).toEqual([
			{
				model: "local-model",
				messages: [{ role: "user", content: "test" }],
				reasoning_effort: "high",
			},
		]);
		expect((await textModelOptions()).options).toEqual([{ id: "local-model", source: "declared" }]);
	});
});

test("a timeout while the reply body streams is an error, not an empty answer", async () => {
	stallBody = true;
	await expect(
		apiProvider.text!.generate({ prompt: "test", model: "deepseek-flash", timeoutMs: 200 }),
	).rejects.toThrow(/timed out/);
});
