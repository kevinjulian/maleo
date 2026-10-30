import type { CapturedTextSelection } from "@maleo/shared";
import { withTextSelection } from "../../../../lib/text-selection-scope.ts";
/* The internal agent's model: the selected API text provider, handed to Mastra.
 *
 * Mastra owns tool calls only when the model returns them for Mastra to run, so
 * only API-backed, OpenAI-compatible endpoints qualify (design decision 4). The
 * agent resolves the same selection every single-shot text call resolves —
 * provider, model and thinking from settings, through `selectReadyProvider` — so
 * one choice drives all text, and an unavailable or unsuitable choice fails
 * visibly instead of falling back. Each model call holds the provider's
 * concurrency slot for its whole length and records its actual usage on the same
 * ledger single-shot calls use. */
import { ModelRouterLanguageModel } from "@mastra/core/llm";
import { selectReadyProvider, type ThinkingLevel } from "../../../../lib/ai-provider/index.ts";
import {
	apiConfig,
	effortFor,
	type ApiConfig,
} from "../../../../lib/ai-provider/providers/api/index.ts";
import { semaphoreFor, type Semaphore } from "../../../../lib/ai-provider/semaphore.ts";
import { currentTextSelection, recordTextUsage } from "../../../../lib/text-runner.ts";

/** Mastra's OpenAI-compatible model configuration. */
export interface AgentModelConfig {
	providerId: string;
	modelId: string;
	url: string;
	apiKey: string;
}

export const AGENT_MODEL_PROVIDER_ID = "maleo-api";
const API_PROVIDER = "api";

export function agentModel(modelId: string, config: ApiConfig = apiConfig()): AgentModelConfig {
	return {
		providerId: AGENT_MODEL_PROVIDER_ID,
		modelId,
		url: config.baseUrl,
		apiKey: config.apiKey,
	};
}

type RouterModel = ModelRouterLanguageModel;
type CallOptions = Parameters<RouterModel["doGenerate"]>[0];
type StreamResult = Awaited<ReturnType<RouterModel["doStream"]>>;
type StreamPart = StreamResult["stream"] extends ReadableStream<infer P> ? P : never;

/* A provider reports token counts either flat (`inputTokens: 21`) or, on the
 * newer model spec, nested (`inputTokens: { total: 21, … }`). Both are read. */
type TokenCount = number | { total?: number } | undefined;

interface Usage {
	inputTokens?: TokenCount;
	outputTokens?: TokenCount;
}

function tokens(count: TokenCount): number {
	return typeof count === "number" ? count : (count?.total ?? 0);
}

/** What the agent runs on, and what it is billed as. */
export interface ResolvedAgentModel {
	model: AgentLanguageModel;
	providerId: string;
	modelId: string;
	thinking?: ThinkingLevel;
}

/* A Mastra model that holds the provider's concurrency slot for the whole call,
 * sends the selected thinking level, and records the usage the endpoint reports. */
export class AgentLanguageModel {
	readonly specificationVersion = "v2" as const;
	readonly provider: string;
	readonly modelId: string;
	readonly supportedUrls: RouterModel["supportedUrls"];

	constructor(
		private readonly inner: RouterModel,
		private readonly slots: Semaphore,
		private readonly billing: { provider: string; model: string; thinking?: ThinkingLevel },
	) {
		this.provider = inner.provider;
		this.modelId = inner.modelId;
		this.supportedUrls = inner.supportedUrls;
	}

	private withThinking(options: CallOptions): CallOptions {
		const effort = effortFor(this.billing.thinking);
		if (!effort) return options;
		return {
			...options,
			providerOptions: {
				...options.providerOptions,
				[AGENT_MODEL_PROVIDER_ID]: { reasoningEffort: effort },
			},
		};
	}

	private async record(usage: Usage | undefined, startedAt: number): Promise<void> {
		await recordTextUsage({
			provider: this.billing.provider,
			model: this.billing.model,
			inputTokens: tokens(usage?.inputTokens),
			outputTokens: tokens(usage?.outputTokens),
			durationMs: Date.now() - startedAt,
			thinking: this.billing.thinking,
		});
	}

	/* A streamed call's usage arrives on its finish part, and its slot is held
	 * until the stream ends. */
	private async metered<R extends StreamResult>(call: () => Promise<R>): Promise<R> {
		const startedAt = Date.now();
		let release!: () => void;
		const finished = new Promise<void>((resolve) => {
			release = resolve;
		});
		const started = new Promise<R>((resolve, reject) => {
			void this.slots.run(async () => {
				try {
					resolve(await call());
				} catch (error) {
					reject(error);
					return;
				}
				await finished;
			});
		});
		const result = await started;
		const reader = result.stream.getReader();
		/* The finish part ends the call: Mastra may stop reading there without
		 * draining or cancelling the stream, so the slot is released and the usage
		 * recorded at the finish part — once, whichever end comes first. */
		let ended = false;
		const end = async (usage?: Usage) => {
			if (ended) return;
			ended = true;
			release();
			await this.record(usage, startedAt);
		};
		const stream = new ReadableStream<StreamPart>({
			pull: async (controller) => {
				const next = await reader.read();
				if (next.done) {
					controller.close();
					await end();
					return;
				}
				controller.enqueue(next.value);
				if (next.value.type === "finish") await end(next.value.usage);
			},
			cancel: async (reason) => {
				await end();
				await reader.cancel(reason);
			},
		});
		return { ...result, stream };
	}

	/* A generate call carries its content and usage on the result itself; Mastra
	 * reads those rather than the accompanying stream, so the call's slot and its
	 * usage are settled when it returns. */
	async doGenerate(options: CallOptions) {
		const startedAt = Date.now();
		const result = await this.slots.run(() => this.inner.doGenerate(this.withThinking(options)));
		// SAFETY: the router's generate result carries the provider's usage at runtime; its declared type omits it.
		await this.record((result as { usage?: Usage }).usage, startedAt);
		return result;
	}

	doStream(options: CallOptions): Promise<StreamResult> {
		return this.metered(() => this.inner.doStream(this.withThinking(options)));
	}
}

/** The agent's model, from the user's text selection. */
export async function resolveAgentModel(
	capture?: CapturedTextSelection,
): Promise<ResolvedAgentModel> {
	return withTextSelection(capture, async () => {
		const decision = await selectReadyProvider("text", await currentTextSelection());
		const providerId = decision.provider.meta.id;
		if (providerId !== API_PROVIDER) {
			throw new Error(
				`text provider "${providerId}" cannot run the agent: the agent needs an API-backed model. Select an API provider in settings.`,
			);
		}
		const modelId = decision.choice.model;
		if (!modelId) throw new Error(`text provider "${providerId}" declares no model`);
		const thinking = decision.choice.thinking;
		const inner = new ModelRouterLanguageModel(agentModel(modelId));
		const slots = semaphoreFor(providerId, decision.provider.meta.traits.maxConcurrency);
		return {
			model: new AgentLanguageModel(inner, slots, {
				provider: providerId,
				model: modelId,
				thinking,
			}),
			providerId,
			modelId,
			thinking,
		};
	});
}
