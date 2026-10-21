/* The one place text generation crosses from the app into a provider.
 *
 * Sixteen call sites call `runPrompt` and none of them know which AI ran — that
 * is the whole point of the seam. This file resolves the selected provider,
 * calls it, and records usage. It does not retry, trace, or build prompts:
 * `retry-policy.ts` already encodes which phases are safe to retry, and that
 * knowledge is about the call site, not the runner.
 */
import { selectReadyProvider, type ProviderSelection } from "./ai-provider/index.ts";
import { recordUsage } from "./credit-service.ts";
import { THINKING_LEVELS } from "./ai-provider/index.ts";
import { oneOf } from "@maleo/shared";
import { quoteForText, textProviderCostUsd, TEXT_UNIT } from "./metering/prices.ts";
import type { RenderedPrompt } from "./prompts/registry.ts";
import { generationKey } from "./generation/generation-scope.ts";
import { requirePrompt } from "./capability-scope.ts";

/* How the facade learns which provider the user picked.
 *
 * Injected rather than imported so this file stays clear of the settings store:
 * the provider package is a leaf and the runner should not become the thing
 * that drags the database back into the generation path. Boot registers the
 * real reader; until it does, selection is empty and resolution falls through
 * to the env default and then the first ready provider. */
type SelectionReader = () => ProviderSelection | Promise<ProviderSelection>;

let readSelection: SelectionReader = () => ({});

/** The text selection the user made, read the way every text call reads it. */
export async function currentTextSelection(): Promise<ProviderSelection> {
	return await readSelection();
}

export function setTextProviderSelectionReader(reader: SelectionReader): void {
	readSelection = reader;
}

export interface RunPromptOptions {
	timeoutMs?: number;
	signal?: AbortSignal;
}

export interface RunPromptResult {
	stdout: string;
	stderr: string;
}

/* Test seam: answer a prompt without selecting a provider or spawning anything.
 *
 * Deliberately at this layer rather than per-caller. A caller that grows its own
 * stub tests its own plumbing and still shells out through everyone else's; one
 * seam here means a deterministic test of any prompt-driven feature is one call
 * away from being deterministic about the model too. Usage is NOT recorded when
 * the seam answers, because nothing was spent. */
type PromptRunner = (prompt: string, opts?: RunPromptOptions) => Promise<RunPromptResult>;

let promptRunnerOverride: PromptRunner | null = null;

export function setTextRunnerForTests(runner: PromptRunner | null): void {
	promptRunnerOverride = runner;
}

/* A prompt rendered from a template arrives with its template id, so the runner
 * knows which prompt it is sending without every builder threading one through. */
export async function runPrompt(
	request: string | RenderedPrompt,
	opts?: RunPromptOptions,
): Promise<RunPromptResult> {
	// A composition fragment is part of a request, never a request of its own.
	if (typeof request !== "string" && !request.response)
		throw new Error(
			`prompt template "${request.id}" is not a model request: it names no response contract`,
		);
	const prompt = typeof request === "string" ? request : request.text;
	// Inside an engine operation, only a declared prompt may be sent (capability-scope.ts).
	requirePrompt(typeof request === "string" ? undefined : request.id);
	if (promptRunnerOverride) return promptRunnerOverride(prompt, opts);
	/* Inside a generation scope (a tool call, a workflow node) the usage row is keyed,
	 * so a node re-entered after its call already ran is charged once. */
	const usageKey = generationKey(["llm", prompt]);
	const decision = await selectReadyProvider("text", await readSelection());
	const provider = decision.provider;
	const generate = provider.text;
	if (!generate) {
		throw new Error(`provider "${provider.meta.id}" does not generate text`);
	}

	try {
		const result = await generate.generate({
			prompt,
			model: decision.choice.model,
			thinking: oneOf(decision.choice.thinking, THINKING_LEVELS),
			timeoutMs: opts?.timeoutMs,
			signal: opts?.signal,
		});

		await recordTextUsage({
			provider: provider.meta.id,
			model: result.model,
			inputTokens: result.usage.inputTokens,
			outputTokens: result.usage.outputTokens,
			durationMs: result.durationMs,
			thinking: decision.choice.thinking,
			idempotencyKey: usageKey,
		});

		return { stdout: result.text, stderr: "" };
	} catch (err) {
		// Name the provider that actually ran, so an incident points at the right one.
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`${provider.meta.id} failed: ${message}`);
	}
}

export interface TextUsageInput {
	provider: string;
	model: string;
	inputTokens: number;
	outputTokens: number;
	durationMs: number;
	thinking?: string;
	/** Records the usage once per key. */
	idempotencyKey?: string;
}

/* Usage recording is best-effort: a ledger write must never fail a generation
 * the user already paid for in wall-clock time.
 *
 * The price comes from the table, keyed by the provider and model that actually
 * ran. It used to be a formula inlined right here with `providerCostUsd: 0`
 * beside it — harmless while every call went to a flat-rate subscription CLI,
 * and an understatement of real spend the moment one goes to an API key. */
export async function recordTextUsage(input: TextUsageInput): Promise<void> {
	try {
		const quote = quoteForText({
			provider: input.provider,
			model: input.model,
			inputTokens: input.inputTokens,
			outputTokens: input.outputTokens,
		});
		await recordUsage({
			idempotencyKey: input.idempotencyKey,
			record: {
				operation: "llm",
				provider: input.provider,
				model: input.model,
				quantity: input.inputTokens + input.outputTokens,
				unit: TEXT_UNIT,
				providerCostUsd: textProviderCostUsd(
					input.provider,
					input.model,
					input.inputTokens,
					input.outputTokens,
				),
				chargedCredits: quote.estimatedCredits,
				pricingVersion: quote.pricingVersion,
				metadata: {
					inputTokens: input.inputTokens,
					outputTokens: input.outputTokens,
					durationMs: input.durationMs,
					reasoning: input.thinking,
				},
			},
		});
	} catch (err) {
		console.warn(
			"[credits] failed to record llm usage",
			err instanceof Error ? err.message : String(err),
		);
	}
}
