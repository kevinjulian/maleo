/* Repairing the project's media record against its document.
 *
 * The record is complete because every writer admits what it introduces. This
 * is the net under that: a clip holding a media URL with no asset identity is
 * admitted and the identity written back, so a writer added later that forgets
 * degrades the record's timeliness rather than its completeness. It is expected
 * to find nothing. Finding something names a writer that is wrong.
 *
 * Pure and separate from the applying hook for two reasons. Convergence is the
 * property the loop-safety rests on — apply a plan, re-plan over the result,
 * get nothing — and proving that should not require mounting a component. And
 * the scan reads five carriers whose disagreement is exactly the class of bug
 * this change exists to close, so it is worth reading in one place.
 *
 * `null`, not an empty plan, when clean. An empty-plan-applied-anyway is
 * precisely the shape that writes on every pass and drives the document change
 * that triggers it. Making "nothing to do" a type-level distinction is what the
 * caller cannot fluff. */
import type { AudioOverlay, Scene, VideoOverlay } from "@maleo/shared";
import type { MediaAsset } from "@models/timeline/editor-media.ts";
import type { MediaAssetSeed } from "@models/timeline/media-admission.ts";
import {
	seedForArtifact,
	seedForGeneratedAudio,
	seedForGeneratedVideo,
	seedForSceneFrame,
} from "@models/timeline/media-seeds.ts";

export interface MediaReconcileInput {
	scenes: Scene[];
	videoOverlays: VideoOverlay[];
	audioOverlays: AudioOverlay[];
	assets: MediaAsset[];
}

/** Which carrier to write an identity onto. One patch per carrier holding an
 *  unattributed URL — two clips sharing a URL are two patches against one seed.
 *
 *  Patches key on the URL rather than on an id, because minting an id is what
 *  admission does and the planner does not admit. The applier admits each seed,
 *  then reads the answer back through the URL. */
export interface MediaReconcilePlan {
	seeds: MediaAssetSeed[];
	patches: {
		scenes: Array<{ id: number; slot: "mediaAssetId" | "endMediaAssetId"; url: string }>;
		visualClips: Array<{ sceneId: number; clipId: string; url: string }>;
		videoOverlays: Array<{ id: number; url: string }>;
		audioOverlays: Array<{ id: number; url: string }>;
	};
}

export function planMediaReconcile({
	scenes,
	videoOverlays,
	audioOverlays,
	assets,
}: MediaReconcileInput): MediaReconcilePlan | null {
	// Already admitted under some identity — a URL in here needs no seed, only a
	// patch pointing the carrier at the asset that already exists.
	const admitted = new Set(assets.map((a) => a.url));
	const seedByUrl = new Map<string, MediaAssetSeed>();
	const patches: MediaReconcilePlan["patches"] = {
		scenes: [],
		visualClips: [],
		videoOverlays: [],
		audioOverlays: [],
	};

	const seed = (url: string, proposal: () => MediaAssetSeed): void => {
		// Collapse within the plan as well as against the record: two clips sharing
		// one URL must yield one seed, or the second admission re-mints an identity
		// the first just minted and the pass never converges.
		if (admitted.has(url) || seedByUrl.has(url)) return;
		seedByUrl.set(url, proposal());
	};

	// The same seed rules the writers use (`media-seeds.ts`), so a repaired asset
	// is indistinguishable from one the writer should have admitted.
	for (const s of scenes) {
		if (s.src && !s.mediaAssetId) {
			seed(s.src, () => seedForSceneFrame({ url: s.src!, sceneName: s.name, slot: "start" }));
			patches.scenes.push({ id: s.id, slot: "mediaAssetId", url: s.src });
		}
		if (s.endSrc && !s.endMediaAssetId) {
			seed(s.endSrc, () => seedForSceneFrame({ url: s.endSrc!, sceneName: s.name, slot: "end" }));
			patches.scenes.push({ id: s.id, slot: "endMediaAssetId", url: s.endSrc });
		}
		for (const v of s.visualClips ?? []) {
			if (!v.url || v.mediaAssetId) continue;
			seed(v.url, () =>
				v.kind === "video"
					? seedForGeneratedVideo({ url: v.url, label: v.label, durationSec: v.durationSec })
					: seedForArtifact({ url: v.url, mediaType: "image", label: v.label }),
			);
			patches.visualClips.push({ sceneId: s.id, clipId: v.id, url: v.url });
		}
	}
	for (const v of videoOverlays) {
		if (!v.url || v.mediaAssetId) continue;
		seed(v.url, () =>
			v.kind === "video"
				? {
						...seedForGeneratedVideo({
							url: v.url,
							label: v.label,
							thumb: v.thumb,
							durationSec: v.dur,
						}),
						source: v.source ?? "generated",
					}
				: {
						...seedForArtifact({
							url: v.url,
							mediaType: "image",
							label: v.label,
							durationSec: v.dur,
						}),
						thumb: v.thumb,
						source: v.source ?? "generated",
					},
		);
		patches.videoOverlays.push({ id: v.id, url: v.url });
	}
	for (const a of audioOverlays) {
		if (!a.url || a.mediaAssetId) continue;
		seed(a.url, () =>
			seedForGeneratedAudio({ url: a.url!, content: a.content, kind: a.kind, durationSec: a.dur }),
		);
		patches.audioOverlays.push({ id: a.id, url: a.url });
	}

	const empty =
		!patches.scenes.length &&
		!patches.visualClips.length &&
		!patches.videoOverlays.length &&
		!patches.audioOverlays.length;
	if (empty) return null;
	return { seeds: [...seedByUrl.values()], patches };
}

/* ── Applying a plan ──
 *
 * Pure array transforms rather than store calls, because the writers a plan is
 * applied through are `setScenes` / `setVideoOverlays` / `setAudioOverlays`
 * updaters anyway — and because convergence (plan, apply, re-plan, get null) is
 * only provable if applying is something a test can do without a component. */

/** URL to the identity admission answered with, for every seed in the plan. */
export type AdmittedIds = ReadonlyMap<string, string>;

export function applySceneReconcile(
	scenes: Scene[],
	plan: MediaReconcilePlan,
	ids: AdmittedIds,
): Scene[] {
	if (!plan.patches.scenes.length && !plan.patches.visualClips.length) return scenes;
	return scenes.map((s) => {
		const frames = plan.patches.scenes.filter((p) => p.id === s.id);
		const visuals = plan.patches.visualClips.filter((p) => p.sceneId === s.id);
		if (!frames.length && !visuals.length) return s;
		let next: Scene = s;
		for (const f of frames) {
			const id = ids.get(f.url);
			if (id) next = { ...next, [f.slot]: id };
		}
		if (visuals.length) {
			next = {
				...next,
				visualClips: (next.visualClips ?? []).map((v) => {
					const patch = visuals.find((p) => p.clipId === v.id);
					const id = patch && ids.get(patch.url);
					return id ? { ...v, mediaAssetId: id } : v;
				}),
			};
		}
		return next;
	});
}

export function applyVideoOverlayReconcile(
	overlays: VideoOverlay[],
	plan: MediaReconcilePlan,
	ids: AdmittedIds,
): VideoOverlay[] {
	if (!plan.patches.videoOverlays.length) return overlays;
	return overlays.map((v) => {
		const patch = plan.patches.videoOverlays.find((p) => p.id === v.id);
		const id = patch && ids.get(patch.url);
		return id ? { ...v, mediaAssetId: id } : v;
	});
}

export function applyAudioOverlayReconcile(
	overlays: AudioOverlay[],
	plan: MediaReconcilePlan,
	ids: AdmittedIds,
): AudioOverlay[] {
	if (!plan.patches.audioOverlays.length) return overlays;
	return overlays.map((a) => {
		const patch = plan.patches.audioOverlays.find((p) => p.id === a.id);
		const id = patch && ids.get(patch.url);
		return id ? { ...a, mediaAssetId: id } : a;
	});
}
