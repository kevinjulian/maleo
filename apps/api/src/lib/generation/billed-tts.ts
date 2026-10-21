/* Text-to-speech with credit accounting.
 *
 * This is the whole of what the old `generationGateway` facade actually did: it
 * claimed to unify four modalities, but image/video/cost had no production
 * caller and `text` forwarded `generateContent` unchanged. Only tts carried
 * logic — the reservation and usage record around the synth call — so that is
 * what survives, named for what it is.
 *
 * Callers: the /api/tts route and the longform voiceover flow. */
import { synthesizeTts, type TtsSynthesisRequest } from "../tts-synth.ts";
import { meter } from "../metering/meter.ts";
import { providerCostUsd } from "../metering/prices.ts";

export interface BilledTtsResult {
	bytes: Uint8Array;
	ext: string;
	/** USD the provider charged for this synthesis. */
	cost_usd: number;
}

export async function synthesizeBilledTts(request: TtsSynthesisRequest): Promise<BilledTtsResult> {
	const { text, voice, provider, language, workspace } = request;
	const result = await meter({
		operation: "audio",
		quantity: text.length,
		provider: provider ?? "tts-default",
		model: voice ?? "default-voice",
		reference: "tts",
		// Both, and for different reasons: `scope` is whose ledger the spend lands
		// on, `workspace` is whose quota gates it. Setting only the first billed the
		// workspace without ever asking whether it was allowed another generation.
		workspace,
		metadata: { language },
		identity: [text, voice, provider, language],
		run: () => synthesizeTts(request),
	});
	return { ...result, cost_usd: providerCostUsd("audio", text.length) };
}
