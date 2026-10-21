/* OpenAI-compatible HTTP provider — one adapter, many vendors.
 *
 * A plain `POST {baseUrl}/chat/completions` with a bearer token reaches OpenAI,
 * Anthropic, Gemini, OpenRouter, Groq, DeepSeek, xAI, Together, and local
 * Ollama or vLLM. No SDK dependency, which is what keeps this package a true
 * leaf with an empty dependency list.
 *
 * Trade-off accepted: no vendor extras — prompt caching, native extended
 * thinking blocks, vendor-specific structured-output modes. None of the sixteen
 * single-shot call sites use them. If prompt caching later becomes a real cost
 * lever, a native adapter is an additional registry entry, which is precisely
 * the property this seam exists to provide.
 *
 * Credentials arrive from the environment rather than the settings table: this
 * package never reads the database. */
import type {
	AiProvider,
	ProviderHealth,
	TextInput,
	TextResult,
	ThinkingLevel,
} from "../../types.ts";
import { estimateTokens } from "../../usage.ts";
import { resolveConfig } from "@maleo/shared/provider-config";

const PROVIDER_ID = "api";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const API_BASE_URL_ENV = "MALEO_AI_API_BASE_URL";
export const API_KEY_ENV = "MALEO_AI_API_KEY";
/* Models beyond the catalog the endpoint serves — a local Ollama's `llama3.2`,
 * say — comma-separated. Operator-declared, so selecting one is still a choice
 * the provider declares rather than an arbitrary string; they price at the
 * metered fallback. */
export const API_MODELS_ENV = "MALEO_AI_API_MODELS";

/* Static catalog — design decision 12. These are the models the price table
 * knows rates for; an unlisted model still runs, and prices at the metered
 * fallback rather than free. */
const MODELS = [
	"gpt-5.5",
	"gpt-5-mini",
	"claude-opus-4-5",
	"claude-sonnet-4-5",
	"claude-haiku-4-5",
] as const;

/* OpenAI-style `reasoning_effort`. `off` is not declared: omitting the field
 * is not the same as disabling reasoning on a reasoning model, and claiming
 * otherwise would be the silent-downgrade failure this scale exists to avoid. */
const EFFORT = {
	off: undefined,
	low: "low",
	medium: "medium",
	high: "high",
	max: undefined,
} satisfies Record<ThinkingLevel, string | undefined>;

const DECLARED_LEVELS: ThinkingLevel[] = ["low", "medium", "high"];

/** The catalog, then the operator's extra models. */
function declaredModels(): string[] {
	const extra = (resolveConfig(API_MODELS_ENV) ?? "")
		.split(",")
		.map((model) => model.trim())
		.filter(Boolean);
	return [...new Set([...MODELS, ...extra])];
}

export interface ApiConfig {
	baseUrl: string;
	apiKey: string;
}

/* Read at call time rather than module load. The previous runner read its two
 * knobs once at import, which meant changing them required a restart — and a
 * settings UI that appears to work but does not take effect is worse than one
 * that is absent. */
export function apiConfig(): ApiConfig {
	return {
		baseUrl: (resolveConfig(API_BASE_URL_ENV) ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
		apiKey: resolveConfig(API_KEY_ENV) ?? "",
	};
}

export function effortFor(thinking: ThinkingLevel | undefined): string | undefined {
	if (!thinking) return undefined;
	const native = EFFORT[thinking];
	if (!native) {
		throw new Error(`api provider does not support thinking level "${thinking}"`);
	}
	return native;
}

interface ChatCompletion {
	choices?: { message?: { content?: string } }[];
	usage?: { prompt_tokens?: number; completion_tokens?: number };
	error?: { message?: string };
}

/* Read the completion field by field rather than declaring the body IS one.
 *
 * Hand-written because this is the one response it reads. The endpoint is
 * OpenAI-compatible, which in practice means "whatever the operator pointed
 * `MALEO_AI_BASE_URL` at": a local llama.cpp, a proxy, a gateway. Asserting
 * `ChatCompletion` over that was the least safe claim in this file.
 *
 * Every field stays optional, matching the interface: the caller already handles
 * an absent content, an absent usage and an absent error. */
function field(value: unknown, key: string): unknown {
	if (value === null || typeof value !== "object") return undefined;
	return Object.getOwnPropertyDescriptor(value, key)?.value;
}

function numberField(value: unknown, key: string): number | undefined {
	const v = field(value, key);
	return typeof v === "number" ? v : undefined;
}

function stringField(value: unknown, key: string): string | undefined {
	const v = field(value, key);
	return typeof v === "string" ? v : undefined;
}

function readChatCompletion(value: unknown): ChatCompletion | null {
	if (value === null || typeof value !== "object") return null;
	const rawChoices = field(value, "choices");
	const choices = Array.isArray(rawChoices)
		? rawChoices.map((choice) => {
				const content = stringField(field(choice, "message"), "content");
				return { message: content === undefined ? {} : { content } };
			})
		: undefined;
	const promptTokens = numberField(field(value, "usage"), "prompt_tokens");
	const completionTokens = numberField(field(value, "usage"), "completion_tokens");
	const errorMessage = stringField(field(value, "error"), "message");
	return {
		...(choices === undefined ? {} : { choices }),
		...(promptTokens === undefined && completionTokens === undefined
			? {}
			: {
					usage: {
						...(promptTokens === undefined ? {} : { prompt_tokens: promptTokens }),
						...(completionTokens === undefined ? {} : { completion_tokens: completionTokens }),
					},
				}),
		...(errorMessage === undefined ? {} : { error: { message: errorMessage } }),
	};
}

async function health(): Promise<ProviderHealth> {
	// Key presence only. Reachability is deliberately not probed here: health()
	// is called on every settings render, and a network round-trip per render
	// makes the settings page as slow as the slowest endpoint.
	return apiConfig().apiKey ? "ready" : "unconfigured";
}

async function healthReason(): Promise<string | undefined> {
	if (!apiConfig().apiKey) return "MALEO_AI_API_KEY is not set";
	return undefined;
}

/** Explicit reachability check, for a settings "test connection" action rather
 *  than for render-time health. */
export async function checkReachable(): Promise<{ ok: boolean; reason?: string }> {
	const cfg = apiConfig();
	if (!cfg.apiKey) return { ok: false, reason: "MALEO_AI_API_KEY is not set" };
	try {
		const res = await fetch(`${cfg.baseUrl}/models`, {
			headers: { authorization: `Bearer ${cfg.apiKey}` },
			signal: AbortSignal.timeout(10_000),
		});
		if (!res.ok) return { ok: false, reason: `${cfg.baseUrl} returned ${res.status}` };
		return { ok: true };
	} catch (err) {
		return {
			ok: false,
			reason: err instanceof Error ? err.message : String(err),
		};
	}
}

export const apiProvider: AiProvider = {
	meta: {
		id: PROVIDER_ID,
		label: "OpenAI-compatible API",
		capabilities: ["text"],
		get models() {
			return declaredModels();
		},
		thinkingLevels: DECLARED_LEVELS,
		config: [
			{
				key: API_KEY_ENV,
				label: "API key",
				kind: "secret",
				required: true,
				help: "Bearer token for the endpoint below.",
			},
			{
				key: API_BASE_URL_ENV,
				label: "Base URL",
				kind: "url",
				required: false,
				help: `OpenAI-compatible endpoint. Defaults to ${DEFAULT_BASE_URL}; also reaches Anthropic, Gemini, OpenRouter, Groq, or a local Ollama or vLLM.`,
			},
			{
				key: API_MODELS_ENV,
				label: "Extra models",
				kind: "text",
				required: false,
				help: "Comma-separated model names the endpoint serves beyond the built-in list, e.g. llama3.2 on a local Ollama.",
			},
		],
		traits: {
			jsonMode: true,
			// No subprocess, so the ceiling is the endpoint's rate limit rather
			// than the machine's.
			maxConcurrency: 16,
			contextTokens: 200_000,
			// The whole reason cost stopped being zero.
			meteredPerToken: true,
		},
		health,
		healthReason,
	},
	text: {
		async generate(input: TextInput): Promise<TextResult> {
			const cfg = apiConfig();
			if (!cfg.apiKey) {
				throw new Error("api provider is unconfigured: MALEO_AI_API_KEY is not set");
			}
			const model = input.model ?? MODELS[0];
			const effort = effortFor(input.thinking);
			const started = Date.now();

			// Caller aborts and the timeout are the same signal to fetch, so a
			// generation cannot outlive either.
			const timeout = AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
			const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;

			let res: Response;
			try {
				res = await fetch(`${cfg.baseUrl}/chat/completions`, {
					method: "POST",
					headers: {
						authorization: `Bearer ${cfg.apiKey}`,
						"content-type": "application/json",
					},
					body: JSON.stringify({
						model,
						messages: [{ role: "user", content: input.prompt }],
						...(effort ? { reasoning_effort: effort } : {}),
					}),
					signal,
				});
			} catch (err) {
				throw new Error(
					`api request to ${cfg.baseUrl} failed: ${err instanceof Error ? err.message : String(err)}`,
				);
			}

			const body = readChatCompletion(await res.json().catch(() => null));
			if (!res.ok) {
				// Never echo the response body wholesale — a rejected request can
				// contain the key that was rejected.
				throw new Error(
					`api provider returned ${res.status}: ${body?.error?.message ?? res.statusText}`,
				);
			}
			const text = body?.choices?.[0]?.message?.content ?? "";
			const usage = body?.usage;

			return {
				text,
				usage: usage
					? {
							inputTokens: usage.prompt_tokens ?? 0,
							outputTokens: usage.completion_tokens ?? 0,
						}
					: // A compatible endpoint that omits usage still has to be billed.
						estimateTokens(input.prompt, text),
				model,
				durationMs: Date.now() - started,
			};
		},
	},
};
