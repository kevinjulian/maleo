/* The speech lab's session: the composer's state, the feed, and one synthesis.
 *
 * The feed is loaded from the ledger rather than kept only in memory, which is
 * the whole reason the ledger exists on this path — before it, a synthesis wrote
 * a file and returned a url, so navigating away lost every clip you had made.
 *
 * Synthesis is ONE request. There is no job id and nothing to poll: the clip is
 * in the response. That is why this hook has no polling effect where the image
 * lab's session has one.
 */
import { useCallback, useEffect, useState } from "react";
import {
	fetchClips,
	fetchTtsStatus,
	synthesizeSpeech,
	type LedgerClip,
	type TtsStatus,
} from "@api/speech.ts";
import type { TtsProviderOption, TtsVoiceOption } from "@maleo/shared";
import { useActiveWorkspace } from "@hooks/workspace/use-active-workspace.ts";

/** Mirrors the server's cap in routes/tts.ts. The composer shows the remaining
 *  allowance against it so an operator is told the bound while typing rather
 *  than after submitting — and the server still enforces it, because a client
 *  limit is a courtesy, not a control. */
export const MAX_SYNTHESIS_CHARS = 1200;

/* The API returns newest-first; the feed reads oldest-first, so the newest clip
 * is nearest the composer that made it. Same direction as the image lab's
 * `historyToMessages`, deliberately: moving between the two labs must not
 * reverse which end of the feed is "now". */
function oldestFirst(clips: LedgerClip[]): LedgerClip[] {
	return [...clips].reverse();
}

export interface SpeechSessionState {
	text: string;
	setText: (value: string) => void;
	voice: string;
	setVoice: (value: string) => void;
	/** The provider this synthesis will use. Defaults to the effective one and is
	 *  a per-request override: choosing here never writes the app-wide selection. */
	provider: string;
	setProvider: (value: string) => void;
	/** Every registered provider, for the control that offers the choice. */
	providers: TtsProviderOption[];
	/** The chosen provider's voices — not the effective provider's. */
	voices: TtsVoiceOption[];
	clips: LedgerClip[];
	status: TtsStatus | null;
	busy: boolean;
	error: string | null;
	workspace: string;
	remaining: number;
	overLimit: boolean;
	canSubmit: boolean;
	submit: () => Promise<void>;
}

/** What a chosen provider resolves to: the provider itself, the voices it can
 *  speak, and whether it can serve right now.
 *
 *  Pure and exported because the decision is the interesting part and a hook is
 *  the awkward place to assert it. Readiness here is the CHOSEN provider's, not
 *  the deployment's — `status.ready` answers "can the default run", a different
 *  question once this surface can pick something else. */
export interface ProviderChoice {
	/** The registered provider, or null when the id names none. */
	chosen: TtsProviderOption | null;
	/** What it can speak — empty for a provider that is not registered. */
	voices: TtsVoiceOption[];
	/** Whether IT can serve, which is not whether the deployment's default can. */
	ready: boolean;
}

export function resolveProviderChoice(status: TtsStatus | null, provider: string): ProviderChoice {
	const providers = status?.providers ?? [];
	const chosen = providers.find((p) => p.id === provider) ?? null;
	return { chosen, voices: chosen?.voices ?? [], ready: chosen?.health === "ready" };
}

export function useSpeechSession({
	onFeedGrew,
}: { onFeedGrew?: () => void } = {}): SpeechSessionState {
	const workspace = useActiveWorkspace();
	const [text, setText] = useState("");
	const [voice, setVoice] = useState("");
	const [provider, setProviderState] = useState("");
	const [clips, setClips] = useState<LedgerClip[]>([]);
	const [status, setStatus] = useState<TtsStatus | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// The workspace's history, so the feed survives a navigation away and back.
	useEffect(() => {
		let alive = true;
		void fetchClips({ workspace, source: "lab", limit: 50 })
			.then((res) => {
				if (!alive) return;
				setClips(oldestFirst(res.items));
				onFeedGrew?.();
			})
			.catch(() => {
				/* an empty feed is the ordinary state; no error banner for it */
			});
		return () => {
			alive = false;
		};
		// onFeedGrew is a scroll callback and would re-run this on every render.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [workspace]);

	useEffect(() => {
		let alive = true;
		void fetchTtsStatus()
			.then((s) => {
				if (alive) setStatus(s);
			})
			.catch(() => {
				if (alive) setStatus(null);
			});
		return () => {
			alive = false;
		};
	}, []);

	const providers = status?.providers ?? [];

	/* The effective provider is the default, but only a default — this surface
	 * persists nothing, so trying another one must not change what every project
	 * renders with. */
	useEffect(() => {
		if (!provider && status?.effective_provider) setProviderState(status.effective_provider);
	}, [status, provider]);

	const { chosen, voices } = resolveProviderChoice(status, provider);

	/* The first voice of the CHOSEN provider's catalogue, once it arrives. Not a
	 * hardcoded default: which voices exist depends on the provider, and a stale
	 * default is a request that fails at synthesis. */
	useEffect(() => {
		if (!voice && voices.length) setVoice(voices[0]!.id);
	}, [voices, voice]);

	/* Switching provider clears the voice. A voice id is meaningful only to the
	 * provider that offers it, so carrying one across would send the new provider
	 * an id it has never heard of. */
	const setProvider = useCallback((next: string) => {
		setProviderState(next);
		setVoice("");
	}, []);

	const trimmed = text.trim();
	const remaining = MAX_SYNTHESIS_CHARS - text.length;
	const overLimit = remaining < 0;
	/* Readiness is the CHOSEN provider's, not the deployment's. `status.ready`
	 * answers "can the default run", which is a different question once this
	 * surface can pick something else. */
	const canSubmit = !busy && trimmed.length > 0 && !overLimit && chosen?.health === "ready";

	const submit = useCallback(async () => {
		if (!trimmed || busy || overLimit) return;
		setBusy(true);
		setError(null);
		try {
			/* The provider travels with the request. The server treats an explicit id
			 * as the highest-precedence choice and fails loudly when it cannot serve,
			 * so nothing here has to pre-check it — and nothing writes the setting. */
			const res = await synthesizeSpeech({
				text: trimmed,
				voice: voice || undefined,
				provider: provider || undefined,
			});
			if (res.error || !res.url) {
				setError(res.error ?? "Synthesis failed.");
			} else {
				const made = await fetchClips({ workspace, source: "lab", limit: 50 });
				setClips(oldestFirst(made.items));
				setText("");
				onFeedGrew?.();
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
		setBusy(false);
	}, [trimmed, busy, overLimit, voice, provider, workspace, onFeedGrew]);

	return {
		text,
		setText,
		voice,
		setVoice,
		provider,
		setProvider,
		providers,
		voices,
		clips,
		status,
		busy,
		error,
		workspace,
		remaining,
		overLimit,
		canSubmit,
		submit,
	};
}
