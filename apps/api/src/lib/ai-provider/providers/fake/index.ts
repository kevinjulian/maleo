/* Deterministic provider for tests. No subprocess, no network, no clock
 * dependence beyond a fixed duration.
 *
 * This replaces the ad-hoc test seam that lived at `content-generator.ts:103`.
 * That seam existed because there was no way to generate text without spawning
 * codex; now there is one, and it is registered like any other provider rather
 * than reached through a module-private hook. */
import type { AiProvider, ProviderHealth, TextInput, TextResult } from "../../types.ts";

const PROVIDER_ID = "fake";

export interface ScriptedReply {
	// Matched against the prompt. First match wins, so order is precedence.
	when: (prompt: string) => boolean;
	reply: string;
}

let script: ScriptedReply[] = [];
let fallback = "";
const calls: TextInput[] = [];

/* Tests set the script, run the code under test, then assert on `fakeCalls()`.
 * Scripts are replaced rather than appended so one test cannot leak a reply
 * into the next. */
export function setFakeScript(replies: ScriptedReply[], fallbackReply = ""): void {
	script = replies;
	fallback = fallbackReply;
	calls.length = 0;
}

export function fakeCalls(): readonly TextInput[] {
	return calls;
}

export function resetFake(): void {
	script = [];
	fallback = "";
	calls.length = 0;
}

async function health(): Promise<ProviderHealth> {
	return "ready";
}

export const fakeProvider: AiProvider = {
	meta: {
		id: PROVIDER_ID,
		label: "Fake (testing)",
		capabilities: ["text"],
		// Never offered in settings: it reports ready unconditionally, so it
		// would look like the healthiest option while returning empty text.
		internal: true,
		models: ["fake-1"],
		thinkingLevels: ["off", "low", "medium", "high", "max"],
		traits: {
			jsonMode: true,
			maxConcurrency: 64,
			contextTokens: 1_000_000,
			meteredPerToken: false,
		},
		health,
	},
	text: {
		async generate(input: TextInput): Promise<TextResult> {
			calls.push(input);
			const matched = script.find((s) => s.when(input.prompt));
			const text = matched ? matched.reply : fallback;
			return {
				text,
				usage: {
					inputTokens: Math.ceil(input.prompt.length / 4),
					outputTokens: Math.ceil(text.length / 4),
					estimated: true,
				},
				model: input.model ?? "fake-1",
				// Fixed, not measured: a duration that varies makes a golden test flaky.
				durationMs: 0,
			};
		},
	},
};
