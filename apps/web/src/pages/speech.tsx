/* The speech route: the gallery of everything synthesized.
 *
 * Filters live in the URL rather than in component state, so a narrowed view is
 * shareable — the same reason the images gallery is its own route.
 */
import { useCallback, useState } from "react";
import type { JSX } from "react";
import { SpeechGallery } from "@components/speech/speech-gallery.tsx";
import {
	speechFiltersFromSearch,
	speechFiltersToSearch,
	type SpeechFilters,
} from "@models/speech/gallery-filters.ts";

export function SpeechPage({ onOpenLab }: { onOpenLab?: () => void }): JSX.Element {
	const [filters, setFilters] = useState<SpeechFilters>(() =>
		speechFiltersFromSearch(typeof window === "undefined" ? "" : window.location.search),
	);

	/* replaceState, not pushState: narrowing a filter is not a navigation, and
	 * making each keystroke a history entry would turn Back into an undo of the
	 * search box rather than a way out of the gallery. */
	const applyFilters = useCallback((next: SpeechFilters) => {
		setFilters(next);
		if (typeof window !== "undefined") {
			window.history.replaceState(null, "", `/speech${speechFiltersToSearch(next)}`);
		}
	}, []);

	return <SpeechGallery filters={filters} onFilters={applyFilters} onOpenLab={onOpenLab} />;
}
