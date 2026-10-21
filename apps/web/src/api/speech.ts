/* The speech lab's and speech gallery's requests. Both render what these return;
 * neither builds a URL or calls the client itself.
 *
 * Synthesis is one request — the clip comes back in the response. There is no job
 * id to poll, which is why there is no `fetchSpeechJob` here to match the image
 * lab's. */
import { del, get, post } from "./client.ts";
import type { TtsProviderOption, TtsVoiceOption } from "@maleo/shared";
import type { LedgerClip, SpeechSource } from "@models/speech/clip.ts";

export type { LedgerClip, SpeechSource };

/** Recorded clips, newest first, within one workspace. */
export function fetchClips(
	opts: {
		limit?: number;
		offset?: number;
		workspace?: string;
		/** "none" selects clips belonging to no project. */
		project?: string;
		source?: SpeechSource;
		search?: string;
	} = {},
): Promise<{ items: LedgerClip[] }> {
	const params = new URLSearchParams();
	if (opts.limit != null) params.set("limit", String(opts.limit));
	if (opts.offset != null) params.set("offset", String(opts.offset));
	if (opts.workspace) params.set("workspace", opts.workspace);
	if (opts.project) params.set("project", opts.project);
	if (opts.source) params.set("source", opts.source);
	if (opts.search?.trim()) params.set("q", opts.search.trim());
	const query = params.toString();
	return get<{ items: LedgerClip[] }>(`/api/tts/clips${query ? `?${query}` : ""}`);
}

/** The gallery's filter options, within one workspace. `sources` is derived from
 *  the clips that exist, so a value speech cannot be produced by is never
 *  offered — a control that would always return nothing. */
export function fetchClipFacets(workspace: string): Promise<{
	projects: Array<{ id: string; title: string }>;
	sources: SpeechSource[];
}> {
	return get(`/api/tts/clips/facets?workspace=${encodeURIComponent(workspace)}`);
}

export function starClip(id: string): Promise<void> {
	return post(`/api/tts/clips/${encodeURIComponent(id)}/star`, {});
}

/** Hides the clip. The ledger row survives, because it is the artifact side of a
 *  metered, billed synthesis. */
export function deleteClip(id: string): Promise<void> {
	return del(`/api/tts/clips/${encodeURIComponent(id)}`);
}

export interface SynthesizeInput {
	text: string;
	voice?: string;
	provider?: string;
}

export interface SynthesizedClip {
	url: string;
	durationSec?: number;
	id?: string;
	error?: string;
	/** Present on a 413: the cap the composer should have enforced. */
	limit?: number;
}

/** One synchronous synthesis. Resolves with the clip, or with the server's error
 *  message — the caller renders it rather than throwing past the feed. */
export function synthesizeSpeech(body: SynthesizeInput): Promise<SynthesizedClip> {
	return post<SynthesizedClip>("/api/tts/generate", body);
}

/* The status payload as this surface reads it. It carried a `provider` field
 * that the payload stopped sending when TTS moved onto the provider registry;
 * nothing broke only because nothing read it. `providers` is the list every
 * surface offering a choice renders from. */
export interface TtsStatus {
	providers: TtsProviderOption[];
	/** The provider that would run with nothing chosen, or null when none can. */
	effective_provider: string | null;
	ready: boolean;
	/** The effective provider's voices. A surface that offers a provider CHOICE
	 *  should read `providers[].voices` instead — this field is what runs by
	 *  default, not what is available. */
	voices: TtsVoiceOption[];
}

/** Provider readiness, every registered provider, and the effective provider's
 *  voices. Empty voices means the provider is unconfigured, not that it has none. */
export function fetchTtsStatus(): Promise<TtsStatus> {
	return get<TtsStatus>("/api/tts/status");
}
