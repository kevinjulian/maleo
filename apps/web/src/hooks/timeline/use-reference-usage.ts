/* What the reference library shows about a reference, and what deleting one
 * does.
 *
 * The two derivations answer the badge and the delete-impact warning: how many
 * clips and project references attach a logical id, and which media assets a
 * clip still points at. The second no longer counts project references —
 * selecting an entity locks its copied asset through the asset's provenance
 * rather than through a `refmedia:` id alias.
 *
 * Deleting is global: it removes the reference from the library only. The
 * project's own All Media and the clips already using it keep their copies.
 *
 * Split out of `timeline-editor.tsx`.
 */
import { useCallback, useMemo } from "react";
import { deleteGlobalReference } from "@api/workspace-catalogue.ts";
import { removeFromPool } from "@models/references/pool.ts";
import { computeRefUsage, removeSelected } from "@models/references/reference-ops.ts";
import { usedMediaAssetIds } from "@models/timeline/media-usage.ts";
import type { ReferenceLibraryState } from "@hooks/editor/use-reference-library.ts";
import type { DocumentWriters } from "@stores/document-writers.ts";
import type { Scene } from "@maleo/shared";
import type { selectDerivedArrays } from "@stores/timeline-document-store.ts";

type Derived = ReturnType<typeof selectDerivedArrays>;

export interface ReferenceUsageInput {
	scenes: Scene[];
	videoOverlays: Derived["videoOverlays"];
	audioOverlays: Derived["audioOverlays"];
	projectReferences: NonNullable<Derived["projectReferences"]>;
	setPool: ReferenceLibraryState["setPool"];
	setRefs: ReferenceLibraryState["setRefs"];
	setProjectReferences: DocumentWriters["setProjectReferences"];
}

export interface ReferenceUsage {
	refUsage: ReturnType<typeof computeRefUsage>;
	lockedMediaAssetIds: Set<string>;
	deleteRef: (id: string) => Promise<boolean>;
}

export function useReferenceUsage({
	scenes,
	videoOverlays,
	audioOverlays,
	projectReferences,
	setPool,
	setRefs,
	setProjectReferences,
}: ReferenceUsageInput): ReferenceUsage {
	const refUsage = useMemo(
		() => computeRefUsage(scenes, projectReferences.entityIds),
		[scenes, projectReferences],
	);
	// Every placement path, not just the overlay lane: a beat's frame and an
	// audio clip are in use as much as an overlay is, and reading one array was
	// why the set could not see them.
	const lockedMediaAssetIds = useMemo(
		() => usedMediaAssetIds({ scenes, videoOverlays, audioOverlays }),
		[scenes, videoOverlays, audioOverlays],
	);

	const deleteRef = useCallback(
		async (id: string): Promise<boolean> => {
			try {
				await deleteGlobalReference(id);
			} catch {
				return false;
			}
			setPool((entries) => removeFromPool(entries, id));
			setRefs((r) => ({ ...r, notes: r.notes.filter((n) => n.id !== id) }));
			setProjectReferences((p) => removeSelected(p, id));
			return true;
		},
		[setPool, setRefs, setProjectReferences],
	);

	return { refUsage, lockedMediaAssetIds, deleteRef };
}
