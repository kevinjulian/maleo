/* The workspace's reference material, as one value.
 *
 * The pool (workspace library + this project's roster), the rest of the
 * reference state (notes, speakers, style), the product catalogue, and the media
 * library. They arrive together — one catalogue fetch seeds three of them, and a
 * project load merges its own entities into the same three — so this hook owns
 * the fetch as well as the values.
 *
 * What is NOT here: which entities a project locks for generation. That lives on
 * the document (`projectReferences`), because it is an edit like any other and
 * goes through the command stack. Selecting an entity also has to attach it to
 * the roster, and the container owns both halves of that.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { admitMediaAsset, type MediaAssetSeed } from "@models/timeline/media-admission.ts";
import type { CatalogueProduct, Note, RefImage, RefsState, Speaker } from "@maleo/shared";
import { fetchContentCatalogue } from "@api/workspace-catalogue.ts";
import { mergePool } from "@models/references/pool.ts";
import { hashHue } from "@models/core/measures.ts";
import { INIT_REFS } from "@models/references/reference-vocabulary.ts";
import type { MediaAsset } from "@models/timeline/editor-media.ts";
import { resolveSetState } from "@models/core/set-state.ts";
import { resolvePendingAsset } from "@models/core/pending-media-sources.ts";
import { usePendingMediaVersion } from "./use-pending-media-version.ts";

/** A loaded project's own reference material. */
export interface LoadedReferences {
	mediaAssets: MediaAsset[];
	projImages: RefImage[];
	projNotes: Note[];
	projSpeakers: Speaker[];
}

export interface ReferenceLibraryState {
	/** Notes, speakers and style. Images live in `pool`. */
	refs: RefsState;
	setRefs: Dispatch<SetStateAction<RefsState>>;
	/** Workspace library + this project's roster, with `inRoster` marking the
	 *  attachment. Not persisted — the DB owns these entities. */
	pool: RefImage[];
	setPool: Dispatch<SetStateAction<RefImage[]>>;
	products: CatalogueProduct[];
	mediaAssets: MediaAsset[];
	setMediaAssets: Dispatch<SetStateAction<MediaAsset[]>>;
	getMediaAssets: () => MediaAsset[];
	/** Admit an asset and answer with its identity, so the caller can record it on
	 *  the clip it is about to create. The only way into `mediaAssets`. */
	ensureMediaAsset: (seed: MediaAssetSeed) => string;
	/** Merge a loaded project's own entities back in, so they survive a reload. */
	hydrate: (loaded: LoadedReferences) => void;
}

export function useReferenceLibrary(): ReferenceLibraryState {
	const [refs, setRefs] = useState<RefsState>(() => structuredClone(INIT_REFS));
	const [pool, setPool] = useState<RefImage[]>([]);
	const [products, setProducts] = useState<CatalogueProduct[]>([]);
	const [mediaAssets, setMediaAssetsState] = useState<MediaAsset[]>([]);
	// Admission has to answer with an identity in the same turn the caller
	// creates its clip, so it cannot wait for the state update to land. The
	// mirror is what makes two admissions in one turn agree — reading the
	// render's `mediaAssets` would let the second re-mint an id the first just
	// minted. Every write goes through `setMediaAssets` so the two cannot drift.
	const assetsRef = useRef<MediaAsset[]>(mediaAssets);
	const setMediaAssets = useCallback<Dispatch<SetStateAction<MediaAsset[]>>>((update) => {
		assetsRef.current =
			typeof update === "function" ? resolveSetState(update, assetsRef.current) : update;
		setMediaAssetsState(assetsRef.current);
	}, []);

	const ensureMediaAsset = useCallback(
		(seed: MediaAssetSeed): string => {
			const { assets, id, added } = admitMediaAsset(assetsRef.current, seed);
			if (added) setMediaAssets(assets);
			return id;
		},
		[setMediaAssets],
	);

	// One-shot catalogue load: products, workspace library images, and voices.
	useEffect(() => {
		void fetchContentCatalogue().then((catalogue) => {
			if (!catalogue) return;
			setProducts(catalogue.products);
			// Workspace library entities fill the pool without clobbering the
			// project's own copies — the catalogue can land after the project load.
			setPool((prev) => mergePool(prev, catalogue.images, { mode: "fill" }));
			setRefs((prev) => ({
				...prev,
				speakers: catalogue.voices.map((voice, index) => ({
					id: voice.id,
					name: voice.name,
					voiceId: voice.id,
					voiceDesc: voice.desc,
					hue: voice.hue ?? hashHue(voice.id),
					lang: voice.lang,
					default: index === 0,
				})),
			}));
		});
	}, []);

	/* What every surface reads: a pending asset whose import is ready shows the
	 * server's URL and metadata. The undoable scope (`getMediaAssets`) keeps the
	 * recorded value, so finishing an upload is never an edit. */
	const pendingVersion = usePendingMediaVersion();
	// eslint-disable-next-line react-hooks/exhaustive-deps
	const resolvedAssets = useMemo(
		() => mediaAssets.map(resolvePendingAsset),
		[mediaAssets, pendingVersion],
	);

	return {
		refs,
		setRefs,
		pool,
		setPool,
		products,
		mediaAssets: resolvedAssets,
		setMediaAssets,
		ensureMediaAsset,
		getMediaAssets: () => assetsRef.current,
		hydrate: (loaded: LoadedReferences): void => {
			setMediaAssets(loaded.mediaAssets);
			if (!loaded.projImages.length && !loaded.projNotes.length && !loaded.projSpeakers.length)
				return;
			// The project's own entities ARE its roster — the attachment the server
			// resolves generation through, and what cast defaulting sizes itself on.
			setPool((prev) => mergePool(prev, loaded.projImages, { inRoster: true }));
			setRefs((prev) => ({
				...prev,
				// A loaded project's notes REPLACE the starter set rather than merging
				// with it. `INIT_REFS` seeds four notes keyed n-tone/n-pal/n-music/
				// n-hook for a blank project; the entity migration re-keyed the
				// persisted copies with UUIDs, so merging by id could no longer
				// collide them and every note rendered twice.
				notes: loaded.projNotes.length ? loaded.projNotes : prev.notes,
				// Same rule for speakers: a project's own voice identities replace the
				// catalogue seed rather than merging with it.
				speakers: loaded.projSpeakers.length ? loaded.projSpeakers : prev.speakers,
			}));
		},
	};
}
