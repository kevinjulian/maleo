/* The pre-research clarification question generator.
 *
 * It reads the run's ALREADY RESOLVED context — duration, aspect, language,
 * voice, style/preset, attached references — and is told not to ask for any of
 * it. What is left is the set of decisions that materially shape the story and
 * that nothing in the request or the project answers: audience, viewer outcome,
 * example context, tone. It proposes decisions, never stories.
 *
 * A failure returns null and the build proceeds without clarification. A question
 * generator that cannot run must not be able to block a video. */
import { runPrompt } from "../../../lib/text-runner.ts";
import { renderPrompt, type RenderedPrompt } from "../../../lib/prompts/registry.ts";
import { modelSeamsStubbed } from "../../../lib/content-generator.ts";
import { storyClarificationBatchSchema, type StoryClarificationBatch } from "@maleo/shared";
import type { AgentJob } from "./model.ts";

/** Everything already decided, so the generator cannot ask for it again. */
export interface StoryClarificationContext {
	request: string;
	brief: string;
	targetDurationSec?: number;
	aspect?: string;
	language?: string;
	voice?: string;
	style?: string;
	styleName?: string;
	referenceCount: number;
	direction?: string;
}

export function storyClarificationContext(
	job: AgentJob,
	instruction: string,
): StoryClarificationContext {
	return {
		request: instruction,
		brief: job.brief,
		targetDurationSec: job.targetDurationSec,
		aspect: job.aspect,
		language: job.language,
		voice: job.voice,
		style: job.style,
		styleName: job.styleName,
		referenceCount: (job.projectRefIds?.length ?? 0) + (job.styleImageUrl ? 1 : 0),
		direction: job.direction?.story?.trim() || job.direction?.raw?.trim() || undefined,
	};
}

// Test seam: drive the batch deterministically without the model subprocess.
let plannerOverride:
	| ((context: StoryClarificationContext) => Promise<StoryClarificationBatch | null>)
	| null = null;
export function setStoryClarificationPlannerForTests(
	fn: ((context: StoryClarificationContext) => Promise<StoryClarificationBatch | null>) | null,
): void {
	plannerOverride = fn;
}

export function storyClarificationRequest(context: StoryClarificationContext): RenderedPrompt {
	return renderPrompt("prompt:clarification:storyClarificationPrompt", context);
}

export function storyClarificationPrompt(context: StoryClarificationContext): string {
	return storyClarificationRequest(context).text;
}

function parseJson(text: string): unknown {
	const trimmed = text.trim();
	const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
	return JSON.parse(fence?.[1] ?? trimmed);
}

/** Generate one batch, or null when none can be produced. Never throws: a build
 *  must not fail because the clarification model did. */
export async function generateStoryClarification(
	context: StoryClarificationContext,
): Promise<StoryClarificationBatch | null> {
	if (plannerOverride) return plannerOverride(context);
	// A deterministic test that stubs the model seams but says nothing about
	// clarification asks nothing — it must not spawn a subprocess to find that out.
	if (modelSeamsStubbed()) return null;
	try {
		const { stdout } = await runPrompt(storyClarificationRequest(context), { timeoutMs: 60_000 });
		const parsed = storyClarificationBatchSchema.safeParse(parseJson(stdout));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}
