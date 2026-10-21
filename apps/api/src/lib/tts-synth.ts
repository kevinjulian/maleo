/* Shared TTS synthesis. Provider choice stays API-owned; execution, polling,
 * caching, and artifact storage belong to media worker. */
import {
	getProvider,
	providersFor,
	resolveProvider,
	selectReadyProvider,
	type ProviderDecision,
	type ProviderSelection,
} from "@maleo/media/providers";
import { getGlobalTtsProvider } from "@maleo/db/global-settings";
import { getVoiceClone } from "@maleo/db/voice-clone";
import { getMediaClient } from "./image-gen-client.ts";
import { getMedia } from "@maleo/storage";

/** A registered provider's id. Not a closed union: the set of TTS providers is
 *  the registry's, and a union here is what made every surface downstream carry
 *  its own copy of the provider names. */
export type TtsProviderId = string;

/** Every provider that can synthesize speech, in registry (display) order. */
export function ttsProviders() {
	return providersFor("tts");
}

/** The app-wide selection, or undefined when none is stored. */
export async function selectedTtsProviderId(): Promise<string | undefined> {
	return await getGlobalTtsProvider();
}

/* An explicit per-call id is a `project` override — highest precedence, and the
 * one source that fails loudly on an unknown id. The stored app-wide choice sits
 * at `workspace`, where a retired id falls through to the default instead of
 * breaking every synthesis (see isRetiredPersistedId in the media package). */
export async function ttsSelection(providerId?: string): Promise<ProviderSelection> {
	const stored = await selectedTtsProviderId();
	return {
		...(providerId ? { project: { tts: providerId } } : {}),
		...(stored ? { workspace: { tts: stored } } : {}),
	};
}

/** The provider that would actually run, with where the choice came from.
 *  Probes health, so it fails when the chosen provider cannot serve. */
export async function resolveTtsProvider(providerId?: string): Promise<ProviderDecision> {
	return selectReadyProvider("tts", await ttsSelection(providerId));
}

/* Which provider a synthesis WOULD use, without asking whether it is up.
 *
 * The ledger row is opened before synthesis and has to name a provider. Probing
 * health to fill that field would make recording a generation depend on the
 * service being reachable — and would move the "not configured" failure ahead of
 * the test seam, so a stubbed synthesizer could not be exercised without a live
 * deployment. Readiness is still enforced, one line later, by `synthesizeTts`. */
export async function plannedTtsProviderId(providerId?: string): Promise<string> {
	return resolveProvider("tts", await ttsSelection(providerId)).meta.id;
}

/** Where a stored selection came from, for a settings surface to report. */
export async function ttsSelectionSource(): Promise<"global" | "env" | "default"> {
	if (await selectedTtsProviderId()) return "global";
	return process.env.MALEO_PROVIDER_TTS?.trim() ? "env" : "default";
}

/** A provider's display label, or its id when nothing is registered under it. */
export function ttsProviderLabel(id: string): string {
	return getProvider(id)?.meta.label ?? id;
}

/* What a synthesis is asked for, as one named structure.
 *
 * It was five positional parameters, four of them optional strings, so position
 * was the only thing telling `voice` from `provider` from `language` — a
 * transposition the type checker cannot see. The live route had already started
 * padding a slot (`…, provider, undefined, { workspace }`) to reach the argument
 * it wanted, which is the shape's own warning that it had run out. */
export interface TtsSynthesisRequest {
	text: string;
	voice?: string;
	provider?: TtsProviderId;
	language?: string;
	/** Whose quota gates the synthesis, and whose voice clones resolve. */
	workspace?: string;
}

/* The one place a voice id becomes reference audio.
 *
 * Above this line `voice` is the whole identity of a voice — it is what a
 * selection stores, what the cache keys on, and what the ledger records. The
 * audio behind a cloned voice enters here and travels exactly one hop further,
 * to the provider. Nothing upstream carries the two together, because two
 * fields travelling side by side are two fields that can disagree.
 *
 * Refusals are loud and name both sides. A clone the resolved provider cannot
 * speak is not a voice to fall back from: substituting one would return audio in
 * a voice nobody chose, and every layer downstream would read it as success. */
export async function resolveVoiceReference(
	providerId: string,
	voice: string | undefined,
	workspace: string | undefined,
): Promise<string | undefined> {
	const id = voice?.trim();
	if (!id) return undefined;
	const clones = getProvider(providerId)?.meta.tts?.voiceSource === "cloned";

	const clone = workspace ? await getVoiceClone(workspace, id) : null;
	if (clone) {
		if (clone.providerId !== providerId) {
			throw new Error(
				`voice ${id} belongs to ${clone.providerId} and cannot be spoken by ${providerId}`,
			);
		}
		return clone.refUrl;
	}

	/* A cloning provider has no declared speakers, so an id it does not resolve
	 * to a clone names nothing it can speak. Passing it through would reach the
	 * provider as a voice with no reference and fail there with a vaguer message. */
	if (clones) {
		throw new Error(
			`voice ${id} is not a cloned voice in this workspace, and ${providerId} speaks only cloned voices`,
		);
	}
	return undefined;
}

type Synthesizer = (request: TtsSynthesisRequest) => Promise<{ bytes: Uint8Array; ext: string }>;

let synthOverride: Synthesizer | null = null;
/** Test seam — replace the synthesizer (avoids real TTS network calls). */
export function setTtsSynthesizerForTests(fn: Synthesizer | null): void {
	synthOverride = fn;
}

/** Synthesize speech through durable worker, returning bytes for existing API callers. */
export async function synthesizeTts(
	request: TtsSynthesisRequest,
): Promise<{ bytes: Uint8Array; ext: string }> {
	if (synthOverride) return synthOverride(request);
	const { text, voice, provider, language, workspace } = request;

	const media = getMediaClient();
	if (!media) throw new Error("media worker not configured");
	const decision = await resolveTtsProvider(provider);
	const voiceRefUrl = await resolveVoiceReference(decision.provider.meta.id, voice, workspace);
	const jobId = await media.submitTts({
		text,
		voice: voice || undefined,
		language: language || undefined,
		voiceRefUrl,
		workspaceId: workspace ?? "",
		providerId: decision.provider.meta.id,
		providerSource: decision.source,
	});
	for (let i = 0; i < 80; i++) {
		await new Promise((resolve) => setTimeout(resolve, 1500));
		const job = await media.poll(jobId);
		if (job.status === "done" && job.stored) {
			const prefix = `workspaces/${workspace ?? ""}/audio/`;
			if (!job.stored.key.startsWith(prefix)) throw new Error("speech job storage owner mismatch");
			const blob = await getMedia(job.stored.key);
			const ext =
				job.stored.contentType === "audio/mpeg"
					? "mp3"
					: job.stored.contentType === "audio/mp4"
						? "m4a"
						: job.stored.contentType.split("/")[1] || "wav";
			return { bytes: new Uint8Array(await blob.arrayBuffer()), ext };
		}
		if (job.status === "done" && job.audioUrl) return media.download(job.audioUrl);
		if (job.status === "failed") throw new Error(job.error || "speech generation failed");
	}
	throw new Error("speech generation timed out");
}
