/* The workspace catalogue, fetched once per mounting component.
 *
 * This effect was written twice, verbatim: the voices list and the images tab
 * each ran their own `fetchContentCatalogue` with their own `alive` flag and
 * their own loading state, and the two drifted only by which field they kept.
 * One hook is what stops a third copy appearing next to them.
 */
import { useCallback, useEffect, useState } from "react";
import { fetchContentCatalogue } from "@api/workspace-catalogue.ts";
import type { RefImage, TtsProviderOption } from "@maleo/shared";
import type { Voice } from "@models/references/voice-library.ts";

export interface ContentCatalogueState {
	images: RefImage[];
	/** The effective provider's voices — for a surface that binds one. */
	voices: Voice[];
	/** Every registered provider and its voices — for a surface that only
	 *  browses or auditions. Kept separate from `voices` on purpose; see the note
	 *  in `fetchContentCatalogue`. */
	voiceProviders: TtsProviderOption[];
	/** True until the first response settles, successfully or not. */
	loading: boolean;
	/** The last load did not return a catalogue. Without this a failed load and
	 *  an empty workspace are the same three empty arrays. */
	failed: boolean;
	/** Re-fetch, for a surface that has just changed what the catalogue holds.
	 *  A created clone must be selectable without a manual refresh. */
	reload: () => void;
}

export function useContentCatalogue(): ContentCatalogueState {
	const [images, setImages] = useState<RefImage[]>([]);
	const [voices, setVoices] = useState<Voice[]>([]);
	const [voiceProviders, setVoiceProviders] = useState<TtsProviderOption[]>([]);
	const [loading, setLoading] = useState(true);
	const [failed, setFailed] = useState(false);
	const [nonce, setNonce] = useState(0);
	const reload = useCallback(() => setNonce((n) => n + 1), []);

	useEffect(() => {
		// Guards a setState after unmount; the fetch itself is not cancellable.
		let alive = true;
		setLoading(true);
		void fetchContentCatalogue()
			.then((catalogue) => {
				if (!alive) return;
				setFailed(catalogue === null);
				if (!catalogue) return;
				setImages(catalogue.images);
				setVoices(catalogue.voices);
				setVoiceProviders(catalogue.voiceProviders);
			})
			.finally(() => {
				if (alive) setLoading(false);
			});
		return () => {
			alive = false;
		};
	}, [nonce]);

	return { images, voices, voiceProviders, loading, failed, reload };
}
