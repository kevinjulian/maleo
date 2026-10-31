/* Motion design authoring (motion-design-generation): one model call decides the
 * layers and states of a moment, then the shared compiler and lint turn that
 * intent into a composition. Story generation and the `add_motion_design` tool
 * both call `authorMotionDesign`; neither builds a composition another way.
 *
 * Never throws. A refused or failed answer is retried once with the refusal as a
 * correction; a second failure is returned, and the caller keeps plain text. */
import {
	compileMotion,
	compileMotionClips,
	lintMotion,
	MOTION_EXAMPLES,
	parseMotionIntent,
	type CompositionConfig,
	type MotionIntent,
	type MotionClip,
	type MotionLintFinding,
	type MotionPalette,
} from "@maleo/shared";
import { renderPrompt, type RenderedPrompt } from "./prompts/registry.ts";
import { parseJson } from "./story/authoring-utils.ts";
import { runPrompt } from "./text-runner.ts";

export const MOTION_INTENT_PROMPT = "prompt:content:authorMotionIntent";
// Reasoning models think at length before the JSON (one live call: 7,671 output
// tokens in 42 s), so this matches the story bible, not the short frame call.
const MOTION_TIMEOUT_MS = 120_000;

export type MotionPresentation = "headline" | "explainer" | "transition";

export interface MotionAuthorInput {
	sourceText: string;
	presentation: MotionPresentation;
	spanSec: number;
	aspect: string;
	purpose?: string;
	visualConcept?: string;
	visualStyle?: string;
	palette?: Partial<MotionPalette>;
}

export type MotionIntentResult =
	| { ok: true; intent: MotionIntent; attempts: number }
	| { ok: false; error: string; attempts: number };

export type MotionDesignResult =
	| {
			ok: true;
			config: CompositionConfig;
			clips: MotionClip[];
			findings: MotionLintFinding[];
			attempts: number;
	  }
	| { ok: false; error: string; attempts: number };

export function motionIntentRequest(input: MotionAuthorInput, error?: string): RenderedPrompt {
	const example =
		MOTION_EXAMPLES.find((e) => e.presentation === input.presentation) ?? MOTION_EXAMPLES[0]!;
	return renderPrompt(MOTION_INTENT_PROMPT, {
		...input,
		spanSec: Math.round(input.spanSec * 100) / 100,
		example: JSON.stringify(example.intent),
		error,
	});
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Asks for an intent, validates it against the moment and its source text, and
 *  retries once with the refusal attached. */
export async function authorMotionIntent(input: MotionAuthorInput): Promise<MotionIntentResult> {
	let refusal: string | undefined;
	for (let attempt = 1; attempt <= 2; attempt++) {
		let raw: unknown;
		try {
			const { stdout } = await runPrompt(motionIntentRequest(input, refusal), {
				timeoutMs: MOTION_TIMEOUT_MS,
			});
			raw = parseJson(stdout);
		} catch (error) {
			// A provider failure is not something a correction can fix: report it now.
			if (!(error instanceof SyntaxError))
				return { ok: false, error: message(error), attempts: attempt };
			refusal = `the reply was not valid JSON (${error.message})`;
			continue;
		}
		const parsed = parseMotionIntent(raw, input.spanSec, input.sourceText);
		if (parsed.ok) return { ok: true, intent: parsed.intent, attempts: attempt };
		refusal = parsed.error;
	}
	return { ok: false, error: refusal ?? "no motion intent", attempts: 2 };
}

/** Authors, compiles and lints one moment of motion design. */
export async function authorMotionDesign(input: MotionAuthorInput): Promise<MotionDesignResult> {
	const authored = await authorMotionIntent(input);
	if (!authored.ok) return authored;
	try {
		const config = compileMotion(authored.intent, {
			spanSec: input.spanSec,
			palette: input.palette,
		});
		const clips = compileMotionClips(authored.intent, {
			spanSec: input.spanSec,
			palette: input.palette,
		});
		return { ok: true, config, clips, findings: lintMotion(config), attempts: authored.attempts };
	} catch (error) {
		return { ok: false, error: `compile failed: ${message(error)}`, attempts: authored.attempts };
	}
}
