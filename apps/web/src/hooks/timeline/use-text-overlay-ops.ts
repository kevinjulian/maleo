/* Maleo — patch, remove and resolve the selected text overlay.
 *
 * Removal clears the selection when it was the removed overlay, because a
 * selection pointing at a deleted id leaves the inspector rendering controls for
 * something that is no longer on the timeline. */
import type { Dispatch, SetStateAction } from "react";
import type { TextOverlay } from "@maleo/shared";

export interface TextOverlayOps {
	updateOverlay: (id: number, patch: Partial<TextOverlay>) => void;
	removeOverlay: (id: number) => void;
	selectedOverlay: TextOverlay | null;
}

export function useTextOverlayOps(args: {
	overlays: TextOverlay[];
	setOverlays: Dispatch<SetStateAction<TextOverlay[]>>;
	selectedOverlayId: number | null;
	clearSelection: () => void;
}): TextOverlayOps {
	const { overlays, setOverlays, selectedOverlayId, clearSelection } = args;

	const updateOverlay = (id: number, patch: Partial<TextOverlay>): void =>
		setOverlays((o) => o.map((x) => (x.id === id ? { ...x, ...patch } : x)));

	const removeOverlay = (id: number): void => {
		setOverlays((o) => o.filter((x) => x.id !== id));
		if (selectedOverlayId === id) clearSelection();
	};

	return {
		updateOverlay,
		removeOverlay,
		selectedOverlay: overlays.find((o) => o.id === selectedOverlayId) ?? null,
	};
}
