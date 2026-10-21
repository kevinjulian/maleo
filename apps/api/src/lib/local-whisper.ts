/* Caption execution adapter: inference, setup and cache belong to media worker. */
import { createMediaClient, type SpeechResult, type SpeechStatus } from "@maleo/media/api";
import { offsetCaptionWords } from "@maleo/shared";
import { configuredServiceToken } from "./service-token.ts";
export {
	alignCaptionWordsToScript,
	captionsToCaptionWords,
	offsetCaptionWords,
} from "@maleo/shared";
export type { CaptionWord } from "@maleo/shared/agent-wire";
export type LocalWhisperResult = NonNullable<SpeechResult>;
export type LocalWhisperStatus = SpeechStatus;

function speechClient(timeoutMs = 10_000) {
	const baseUrl = process.env.MALEO_GEN_WORKER_URL?.trim();
	const token = configuredServiceToken();
	if (!baseUrl || !token)
		throw new Error("Configure media worker and matching service token for captions");
	return createMediaClient({ baseUrl, token, requestTimeoutMs: timeoutMs });
}
export async function getLocalWhisperStatus(): Promise<LocalWhisperStatus> {
	return speechClient().speechStatus();
}
export async function setupLocalWhisper(): Promise<LocalWhisperStatus> {
	return speechClient(30 * 60 * 1000).setupSpeech();
}
export async function transcribeLocalWhisper(input: {
	audioPath: string;
	language?: string;
	offsetSec?: number;
	text?: string;
	force?: boolean;
}): Promise<LocalWhisperResult | null> {
	if (!input.audioPath.toLowerCase().endsWith(".wav")) return null;
	const client = speechClient(30 * 60 * 1000);
	const result = await client.transcribeSpeech(Bun.file(input.audioPath), {
		language: input.language,
		text: input.text,
		force: input.force,
	});
	return result
		? { ...result, words: offsetCaptionWords(result.words, input.offsetSec ?? 0) }
		: null;
}
