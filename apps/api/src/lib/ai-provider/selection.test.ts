import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { providersFor, resolveProvider, selectReadyProvider } from "./index.ts";

const priorKey = process.env.MALEO_AI_API_KEY;

beforeEach(() => {
	delete process.env.MALEO_AI_API_KEY;
});
afterEach(() => {
	delete process.env.MALEO_PROVIDER_TEXT;
	if (priorKey === undefined) delete process.env.MALEO_AI_API_KEY;
	else process.env.MALEO_AI_API_KEY = priorKey;
});

describe("provider selection", () => {
	it("registers only API-backed providers and the internal test provider, the API first", () => {
		// Order is also the fallback order for an unconfigured default.
		expect(providersFor("text").map((p) => p.meta.id)).toEqual(["api", "fake"]);
		expect(resolveProvider("text").meta.id).toBe("api");
	});

	it("honors an explicit selection when it implements the capability", () => {
		expect(resolveProvider("text", { default: { providerId: "fake" } }).meta.id).toBe("fake");
	});

	it("rejects a stale explicit selection instead of silently substituting", () => {
		expect(() => resolveProvider("text", { default: { providerId: "retired-provider" } })).toThrow(
			/does not implement/,
		);
	});

	it("names a removed CLI provider and where to change it, substituting nothing", async () => {
		process.env.MALEO_AI_API_KEY = "sk-test";
		for (const [id, runner] of [
			["codex", "the Codex CLI"],
			["claude", "the Claude CLI"],
		] as const) {
			await expect(selectReadyProvider("text", { default: { providerId: id } })).rejects.toThrow(
				`selected selection provider "${id}" was removed: ${runner} can no longer generate text. Select an API provider in Settings`,
			);
			expect(() => resolveProvider("text", { default: { providerId: id } })).toThrow("was removed");
		}
	});

	it("rejects an unconfigured explicit selection, naming why", async () => {
		await expect(selectReadyProvider("text", { default: { providerId: "api" } })).rejects.toThrow(
			/"api" is unconfigured \(MALEO_AI_API_KEY is not set\); choose a ready provider/,
		);
	});

	it("with nothing configured, reports the capability unavailable rather than falling back to the test provider", async () => {
		await expect(selectReadyProvider("text")).rejects.toThrow(
			'no ready provider implements capability "text"',
		);
	});

	it("an unconfigured default lands on the API provider once it has a key", async () => {
		process.env.MALEO_AI_API_KEY = "sk-test";
		const decision = await selectReadyProvider("text");
		expect(decision.provider.meta.id).toBe("api");
		expect(decision.source).toBe("default");
	});

	it("reads an env default when nothing is persisted", async () => {
		process.env.MALEO_PROVIDER_TEXT = "fake";
		const decision = await selectReadyProvider("text");
		expect(decision.provider.meta.id).toBe("fake");
		expect(decision.source).toBe("env");
	});

	it("lets a persisted selection win over the env default", () => {
		process.env.MALEO_PROVIDER_TEXT = "fake";
		expect(resolveProvider("text", { default: { providerId: "api" } }).meta.id).toBe("api");
	});

	it("rejects a model the selected provider does not declare", () => {
		expect(() =>
			resolveProvider("text", { default: { providerId: "api", model: "not-a-model" } }),
		).toThrow(/does not offer model/);
	});

	it("accepts a model and thinking level the provider declares", () => {
		expect(
			resolveProvider("text", {
				default: { providerId: "api", model: "gpt-5-mini", thinking: "high" },
			}).meta.id,
		).toBe("api");
	});
});

describe("an endpoint's own models", () => {
	it("an operator-declared extra model is selectable; an undeclared one is still refused", () => {
		process.env.MALEO_AI_API_MODELS = "llama3.2, qwen3";
		try {
			expect(resolveProvider("text").meta.models).toEqual([
				"gpt-5.5",
				"gpt-5-mini",
				"claude-opus-4-5",
				"claude-sonnet-4-5",
				"claude-haiku-4-5",
				"llama3.2",
				"qwen3",
			]);
			expect(
				resolveProvider("text", { default: { providerId: "api", model: "llama3.2" } }).meta.id,
			).toBe("api");
			expect(() =>
				resolveProvider("text", { default: { providerId: "api", model: "mistral" } }),
			).toThrow(/does not offer model "mistral"/);
		} finally {
			delete process.env.MALEO_AI_API_MODELS;
		}
	});
});
