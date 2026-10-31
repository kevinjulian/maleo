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
 * Configuration resolves through the shared source at call time. This adapter
 * never reads the database. */
import type {
	AiProvider,
	ProviderHealth,
	TextInput,
	TextResult,
	ThinkingLevel,
} from "../../types.ts";
import { estimateTokens } from "../../usage.ts";
import {
	apiConfig,
	API_KEY_ENV,
	API_BASE_URL_ENV,
	API_MODELS_ENV,
	DEFAULT_BASE_URL,
} from "./config.ts";
import { currentTextModels, resolveTextModel } from "./discovery.ts";
export {
	apiConfig,
	API_KEY_ENV,
	API_BASE_URL_ENV,
	API_MODELS_ENV,
	type ApiConfig,
} from "./config.ts";

const PROVIDER_ID = "api";
const DEFAULT_TIMEOUT_MS = 120_000;
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
			return currentTextModels();
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
				help: "Comma-separated model IDs served by this endpoint. Declared models remain available when model discovery is unsupported.",
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
			const model = await resolveTextModel(input.model);
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

			/* The timeout also covers the body. A read it aborts must fail the call:
			 * swallowed, it returned "" as if the model had answered with nothing. */
			const raw = await res.json().catch(() => {
				if (signal.aborted)
					throw new Error(
						`api request to ${cfg.baseUrl} timed out after ${input.timeoutMs ?? DEFAULT_TIMEOUT_MS} ms`,
					);
				return null;
			});
			const body = readChatCompletion(raw);
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
