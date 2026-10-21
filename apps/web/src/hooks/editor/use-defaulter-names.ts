/* Resolving a recorded defaulterId to something worth showing a person.
 *
 * Sources store an id, not a name: a name would be a copy that goes stale the moment
 * the preset is renamed, and the id is what makes the defaulter openable later. So the
 * annotation needs a lookup, and this is it.
 *
 * One request, on mount, shared by every element in the panel. It resolves to an empty
 * map on failure rather than throwing: an annotation that cannot name its source should
 * degrade to "inherited" rather than take the panel down with it.
 */
import { useEffect, useState } from "react";
import { listContentPresets } from "@api/presets.ts";
import type { ContentPreset } from "@maleo/shared";

export interface Defaulters {
	nameOf: (defaulterId: string | null) => string | undefined;
	/** The preset itself, for reverting an element to what it supplies. */
	presetOf: (defaulterId: string | null) => ContentPreset | undefined;
}

export function useDefaulterNames(enabled: boolean): Defaulters {
	const [presets, setPresets] = useState<Readonly<Record<string, ContentPreset>>>({});

	useEffect(() => {
		if (!enabled) return;
		let live = true;
		void listContentPresets()
			.then((list) => {
				if (!live) return;
				setPresets(Object.fromEntries(list.items.map((preset) => [preset.id, preset])));
			})
			.catch(() => {
				/* naming is an annotation, never a blocker */
			});
		return () => {
			live = false;
		};
	}, [enabled]);

	return {
		nameOf: (defaulterId) => (defaulterId ? presets[defaulterId]?.name : undefined),
		presetOf: (defaulterId) => (defaulterId ? presets[defaulterId] : undefined),
	};
}
