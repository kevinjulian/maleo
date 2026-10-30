import { createHash } from "node:crypto";
import { z } from "zod";
import { textModelIdSchema } from "@maleo/shared";
import { refreshConfig, resolveConfig } from "@maleo/shared/provider-config";
import { apiConfig, API_MODELS_ENV, DEFAULT_BASE_URL } from "./config.ts";

export const MODEL_DISCOVERY_TIMEOUT_MS = 10_000;
const CACHE_MS = 60_000;
const modelListSchema = z.object({
	data: z.array(z.object({ id: textModelIdSchema })).max(10_000),
});

export interface ModelDiscovery {
	status: "ready" | "unconfigured" | "unsupported" | "error";
	models: string[];
	error?: string;
}

let cache: { identity: string; expires: number; request: Promise<ModelDiscovery> } | undefined;
let latest: { identity: string; models: string[] } | undefined;

function configurationIdentity(): string {
	const config = apiConfig();
	return createHash("sha256")
		.update(JSON.stringify([config.baseUrl, config.apiKey, resolveConfig(API_MODELS_ENV)]))
		.digest("hex");
}

export function declaredTextModels(): string[] {
	return [
		...new Set(
			(resolveConfig(API_MODELS_ENV) ?? "")
				.split(",")
				.map((id) => id.trim())
				.filter((id) => textModelIdSchema.safeParse(id).success),
		),
	];
}

export function currentTextModels(): string[] {
	const discovered = latest?.identity === configurationIdentity() ? latest.models : [];
	return [...new Set([...discovered, ...declaredTextModels()])];
}

export async function textModelOptions(refresh = false) {
	const discovery = await discoverTextModels(refresh);
	const declared = declaredTextModels();
	return {
		discovery,
		options: [...new Set([...discovery.models, ...declared])].map((id) => ({
			id,
			source: discovery.models.includes(id) ? ("discovered" as const) : ("declared" as const),
		})),
	};
}

/** Only the intended OpenAI endpoint has an implicit model. Custom endpoints require a choice. */
export function defaultTextModel(): string | undefined {
	return apiConfig().baseUrl === DEFAULT_BASE_URL ? "gpt-5.5" : undefined;
}

export async function resolveTextModel(model?: string): Promise<string> {
	const selected = model ?? defaultTextModel();
	if (!selected) throw new Error("Choose a text model for the configured endpoint before sending.");
	const { options, discovery } = await textModelOptions();
	if (!options.some((option) => option.id === selected)) {
		throw new Error(
			`The configured endpoint does not offer model "${selected}". Choose an available model.${discovery.error ? ` ${discovery.error}` : ""}`,
		);
	}
	return selected;
}

/** Endpoint binding excludes credentials so key rotation does not retarget a run. */
export function textEndpointIdentity(): string {
	return createHash("sha256").update(apiConfig().baseUrl).digest("hex");
}

async function discover(): Promise<ModelDiscovery> {
	const config = apiConfig();
	if (!config.apiKey) return { status: "unconfigured", models: [] };
	try {
		const response = await fetch(`${config.baseUrl}/models`, {
			headers: { authorization: `Bearer ${config.apiKey}` },
			signal: AbortSignal.timeout(MODEL_DISCOVERY_TIMEOUT_MS),
			redirect: "error",
		});
		if ([404, 405, 501].includes(response.status)) {
			return { status: "unsupported", models: [] };
		}
		if (!response.ok) {
			return {
				status: "error",
				models: [],
				error: `Model discovery failed (HTTP ${response.status}). Retry or contact the instance owner.`,
			};
		}
		const parsed = modelListSchema.safeParse(await response.json());
		if (!parsed.success) {
			return {
				status: "error",
				models: [],
				error: "Model discovery returned invalid model data. Retry or contact the instance owner.",
			};
		}
		return { status: "ready", models: [...new Set(parsed.data.data.map((model) => model.id))] };
	} catch {
		return {
			status: "error",
			models: [],
			error: "Model discovery failed or timed out. Retry or contact the instance owner.",
		};
	}
}

/** Cache both success and failure. Never retain raw endpoint responses or configuration. */
export async function discoverTextModels(refresh = false): Promise<ModelDiscovery> {
	await refreshConfig();
	const identity = configurationIdentity();
	if (
		cache?.identity === identity &&
		(cache.expires === Infinity || (!refresh && cache.expires > Date.now()))
	) {
		return cache.request;
	}
	const entry = { identity, expires: Infinity, request: discover() };
	cache = entry;
	void entry.request.then((result) => {
		entry.expires = Date.now() + CACHE_MS;
		if (cache === entry) latest = { identity, models: result.models };
	});
	return entry.request;
}
