/* Reference images attached to the next generation, capped at MAX_REFS. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchContentCatalogue } from "@api/workspace-catalogue.ts";
import type { RefImage } from "@maleo/shared";
import { absUrl, toggleReference } from "@models/image-lab/image-job.ts";

export interface ReferencePickerModel {
	catalogueImages: RefImage[];
	selectedRefIds: string[];
	selectedRefs: RefImage[];
	/** Absolute URLs, which is what the generation service is given. */
	referenceUrls: string[];
	open: boolean;
	setOpen: (v: boolean) => void;
	toggle: (id: string) => void;
}

export function useReferencePicker(): ReferencePickerModel {
	const [catalogueImages, setCatalogueImages] = useState<RefImage[]>([]);
	const [selectedRefIds, setSelectedRefIds] = useState<string[]>([]);
	const [open, setOpen] = useState(false);

	useEffect(() => {
		let alive = true;
		void fetchContentCatalogue()
			.then((catalogue) => {
				if (alive && catalogue) setCatalogueImages(catalogue.images.filter((r) => r.imageUrl));
			})
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, []);

	const selectedRefs = useMemo(
		() => catalogueImages.filter((r) => selectedRefIds.includes(r.id)),
		[catalogueImages, selectedRefIds],
	);

	return {
		catalogueImages,
		selectedRefIds,
		selectedRefs,
		referenceUrls: selectedRefs.map((r) => absUrl(r.imageUrl!)),
		open,
		setOpen,
		toggle: useCallback((id: string) => setSelectedRefIds((prev) => toggleReference(prev, id)), []),
	};
}
