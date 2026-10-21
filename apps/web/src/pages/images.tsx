/* The images route: the gallery of everything generated.
 *
 * Filters live in the URL rather than in component state, so a narrowed view is
 * shareable — which is most of why the gallery is its own route instead of the
 * drawer it used to be.
 */
import { useCallback, useState } from "react";
import type { JSX } from "react";
import { ImagesGallery } from "@components/images/images-gallery.tsx";
import {
	filtersFromSearch,
	filtersToSearch,
	type GalleryFilters,
} from "@models/images/gallery-filters.ts";

export function ImagesPage({
	onOpenProject,
	onOpenLab,
}: {
	onOpenProject?: (projectId: string) => void;
	onOpenLab?: () => void;
}): JSX.Element {
	const [filters, setFilters] = useState<GalleryFilters>(() =>
		filtersFromSearch(typeof window === "undefined" ? "" : window.location.search),
	);

	/* replaceState, not pushState: narrowing a filter is not a navigation, and
	 * making each keystroke a history entry would turn Back into an undo of the
	 * search box rather than a way out of the gallery. */
	const applyFilters = useCallback((next: GalleryFilters) => {
		setFilters(next);
		if (typeof window !== "undefined") {
			window.history.replaceState(null, "", `/images${filtersToSearch(next)}`);
		}
	}, []);

	return (
		<ImagesGallery
			filters={filters}
			onFilters={applyFilters}
			onOpenProject={onOpenProject}
			onOpenLab={onOpenLab}
		/>
	);
}
