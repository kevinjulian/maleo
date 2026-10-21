/* What the Project Materials drawer needs besides the project's own materials:
 * the reusable library it can point at, and the preset it can reset to.
 *
 * Both are library reads, not project state, which is why they are fetched here
 * rather than threaded down from the editor shell. The preset is fetched by id
 * rather than passed as an object because the editor only persists
 * `active_preset_id` — resolving it anywhere else would mean a second place that
 * knows how to turn that id into a preset.
 */
import { useCallback, useEffect, useState } from "react";
import { type ContentPreset, type MaterialRecord } from "@maleo/shared";
import { listContentMaterials } from "@api/materials.ts";
import { listContentPresets } from "@api/presets.ts";

export interface ProjectMaterialsContext {
	library: MaterialRecord[];
	/** The preset the project is on, or null when it is on none or it is gone. */
	preset: ContentPreset | null;
	/** Re-read the library, after a save-as-reusable adds or updates a row. */
	reload: () => void;
}

export function useProjectMaterialsContext(activePresetId: string): ProjectMaterialsContext {
	const [library, setLibrary] = useState<MaterialRecord[]>([]);
	const [preset, setPreset] = useState<ContentPreset | null>(null);
	const [nonce, setNonce] = useState(0);

	useEffect(() => {
		let alive = true;
		// Both are optional: the drawer works with no library and no preset, it just
		// offers fewer actions. Neither failure should keep the drawer from opening.
		void listContentMaterials()
			.then((list) => {
				if (alive) setLibrary(list);
			})
			.catch(() => {
				/* library is optional */
			});
		return () => {
			alive = false;
		};
	}, [nonce]);

	useEffect(() => {
		let alive = true;
		if (!activePresetId) {
			setPreset(null);
			return () => {
				alive = false;
			};
		}
		/* Listed rather than fetched by id: the list merges builtins, which have no
		 * row behind them, so a GET by id would 404 for exactly the presets that ship
		 * with the product. */
		void listContentPresets()
			.then(({ items }) => {
				if (!alive) return;
				setPreset(items.find((item) => item.id === activePresetId) ?? null);
			})
			.catch(() => {
				/* preset resolution is best-effort */
			});
		return () => {
			alive = false;
		};
	}, [activePresetId]);

	return { library, preset, reload: useCallback(() => setNonce((n) => n + 1), []) };
}
