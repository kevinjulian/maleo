/* TTS provider status: fetch once on mount, then derive the effective voice
 * provider + its voice options for the current project.
 *
 * Defaults used to be literals and per-provider
 * boolean read off the payload by name. Both are gone: the effective provider is
 * whatever the server resolved, and the voices come from that provider's entry
 * in the list, so a provider added to the registry reaches this hook with no
 * change here. */
import { useEffect, useMemo, useState } from "react";
import { fetchTtsStatus } from "@api/media.ts";
import type { TtsProviderId, TtsProviderOption, TtsStatus, TtsVoiceOption } from "@maleo/shared";

export interface TtsStatusState {
	ttsStatus: TtsStatus | null;
	/** The provider that will actually run: the project's choice when it names a
	 *  registered one, else whatever the server resolved. Empty when nothing can
	 *  run — which is a state the caller must render, not paper over. */
	effVoiceProvider: TtsProviderId;
	ttsVoiceOptions: TtsVoiceOption[];
	/** Every registered provider, for a surface that offers the choice. */
	ttsProviders: TtsProviderOption[];
	/** Whether the effective provider can synthesize right now. */
	effProviderReady: boolean;
}

export function useTtsStatus(voiceProvider: TtsProviderId | undefined): TtsStatusState {
	const [ttsStatus, setTtsStatus] = useState<TtsStatus | null>(null);
	useEffect(() => {
		void fetchTtsStatus()
			.then(setTtsStatus)
			.catch(() => setTtsStatus(null));
	}, []);

	return useMemo(() => {
		const providers = ttsStatus?.providers ?? [];
		/* A project may name a provider that has since been retired. That falls
		 * back to the server's resolution rather than failing, the same recovery
		 * the server applies to a stored id — otherwise a removed provider would
		 * strand every project that had selected it. */
		const wanted =
			voiceProvider && providers.some((p) => p.id === voiceProvider) ? voiceProvider : "";
		const effVoiceProvider = wanted || ttsStatus?.effective_provider || "";
		const entry = providers.find((p) => p.id === effVoiceProvider);
		return {
			ttsStatus,
			effVoiceProvider,
			ttsVoiceOptions: entry?.voices ?? [],
			ttsProviders: providers,
			effProviderReady: entry?.health === "ready",
		};
	}, [ttsStatus, voiceProvider]);
}
