/* Scene frame generation: AI image gen (start/end frames) + image-to-video
 * animate, with per-scene busy maps. Extracted verbatim from TimelineEditor; the
 * ref/prompt derivation closures are injected so this hook owns only the gen loop. */
import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { animateClip, generateSceneImage } from "@api/media.ts";
import { resequenceScenes, sceneFrameHash } from "@maleo/shared";
import type { Config, RefImage, RefsState, Scene, VideoOverlay } from "@maleo/shared";
import type { GlobalSettings } from "@models/presets/creative-settings.ts";
import type { MediaAssetSeed } from "@models/timeline/media-admission.ts";
import { seedForGeneratedVideo, seedForSceneFrame } from "@models/timeline/media-seeds.ts";

interface SceneGenerationOptions {
	/** The project a generated frame belongs to. The server resolves the workspace
	 *  from it, and must keep doing so now that an active workspace EXISTS: a
	 *  project's generation is attributed to the project's own tenant, not to
	 *  whichever workspace the operator is currently in. */
	projectId: string | null;
	scenes: Scene[];
	setScenes: Dispatch<SetStateAction<Scene[]>>;
	setGenErr: Dispatch<SetStateAction<string | null>>;
	upd: (id: number, f: keyof Scene, v: unknown) => void;
	settings: GlobalSettings;
	config: Config;
	refs: RefsState;
	sceneStart: (id: number) => number;
	addVideoOverlay: (seed: Partial<VideoOverlay> & { url: string; kind: "image" | "video" }) => void;
	visualPromptFor: (item: Scene) => string;
	refsFor: (item: Scene) => RefImage[];
	characterDesc: (item: Scene) => string | undefined;
	globalStyleRef: RefImage | undefined;
	/** Admission, so a generated frame is media the project holds rather than a
	 *  URL only this scene knows about. Both slots: an end frame has its own
	 *  identity (`Scene.endMediaAssetId`) for the same reason the start frame
	 *  does — without one it can never be read as used. */
	ensureMediaAsset: (seed: MediaAssetSeed) => string;
}

export interface SceneGeneration {
	gen: Record<number, boolean>;
	genEnd: Record<number, boolean>;
	animateBusy: Record<number, boolean>;
	genFrame: (id: number, slot?: "start" | "end") => void;
	genAll: () => void;
	animateScene: (id: number) => Promise<void>;
}

export function useSceneGeneration(opts: SceneGenerationOptions): SceneGeneration {
	const {
		projectId,
		scenes,
		setScenes,
		setGenErr,
		settings,
		config,
		refs,
		sceneStart,
		addVideoOverlay,
		visualPromptFor,
		refsFor,
		characterDesc,
		globalStyleRef,
		ensureMediaAsset,
	} = opts;
	const [gen, setGen] = useState<Record<number, boolean>>({});
	const [genEnd, setGenEnd] = useState<Record<number, boolean>>({});
	const [animateBusy, setAnimateBusy] = useState<Record<number, boolean>>({});

	const genOne = async (item: Scene, slot: "start" | "end" = "start"): Promise<void> => {
		const setter = slot === "end" ? setGenEnd : setGen;
		setter((g) => ({ ...g, [item.id]: true }));
		try {
			const endHint =
				slot === "end"
					? ` Final frame at the end of the shot, after the action completes: ${item.action || "the motion has finished"}.`
					: "";
			const url = await generateSceneImage({
				projectId,
				source: "clip",
				visual: visualPromptFor(item) + endHint,
				aspect: settings.aspectRatio || config.format,
				refs: refsFor(item),
				sceneName: item.name,
				action: item.action,
				shotType: item.shot,
				movement: item.move,
				tone: refs.style.tone,
				colors: refs.style.palette,
				target: config.audience,
				characterDescription: characterDesc(item),
				styleImageUrl: globalStyleRef?.imageUrl,
			});
			const mediaAssetId = ensureMediaAsset(seedForSceneFrame({ url, sceneName: item.name, slot }));
			if (slot === "end") {
				// Two fields, one write: `upd` commits per field, and committing
				// `endSrc` without its identity leaves a window where the reconciler
				// would admit the same URL a second time.
				setScenes((ss) =>
					resequenceScenes(
						ss.map((scene) =>
							scene.id !== item.id
								? scene
								: { ...scene, endSrc: url, endMediaAssetId: mediaAssetId },
						),
					),
				);
			} else {
				setScenes((ss) =>
					resequenceScenes(
						ss.map((scene) =>
							scene.id !== item.id
								? scene
								: {
										...scene,
										src: url,
										mediaAssetId,
										img: true,
										/* What produced this frame, so a later edit to the prompt or the
										 * references can be seen for what it is. Derived from the SCENE, not
										 * from the composed prompt sent to the generator — the staleness check
										 * reads the same fields, and hashing a composed string here would make
										 * every frame read as stale the moment it was written. */
										frameInputHash: sceneFrameHash(scene, { stylePreset: config.styleName }),
										// Generated-frame version history (Edit Timeline Item) — persisted on the scene.
										history: [
											{ id: Date.now(), url, thumb: url, prompt: item.vis, durationSec: item.dur },
											...(scene.history ?? []),
										].slice(0, 12),
										// Replace the primary visual clip (the frame that feeds the render);
										// keep any extra non-primary clips the scene already had.
										visualClips: [
											{
												id: `scene-${item.id}-visual-primary`,
												kind: "image" as const,
												label: scene.name || "Generated visual",
												url,
												mediaAssetId,
												startSec: 0,
												durationSec: scene.dur,
												primary: true,
											},
											...(scene.visualClips ?? []).filter(
												(clip) => !clip.primary && clip.url !== url,
											),
										],
									},
						),
					),
				);
			}
		} catch (err) {
			setGenErr(`Image generation failed: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			setter((g) => ({ ...g, [item.id]: false }));
		}
	};
	const genFrame = (id: number, slot: "start" | "end" = "start"): void => {
		const item = scenes.find((s) => s.id === id);
		if (item) void genOne(item, slot);
	};
	const genAll = (): void => {
		setGenErr(null);
		void (async (): Promise<void> => {
			for (const s of scenes.filter((i) => !i.img)) await genOne(s);
		})();
	};

	// Image-to-video: animate a scene's frame into a video clip on the overlay
	// track over that scene's span (so the render composites it).
	const animateScene = async (id: number): Promise<void> => {
		const s = scenes.find((x) => x.id === id);
		if (!s || !s.src) {
			setGenErr("Generate the scene frame before animating it.");
			return;
		}
		setAnimateBusy((b) => ({ ...b, [id]: true }));
		try {
			const result = await animateClip(s.src, visualPromptFor(s), s.dur, projectId);
			const { url } = result;
			const label = `${s.name} (video)`;
			const mediaAssetId = ensureMediaAsset(
				seedForGeneratedVideo({
					url,
					label,
					durationSec: result.durationSec,
					poster: result.posterUrl,
				}),
			);
			addVideoOverlay({
				url,
				mediaAssetId,
				sourceDurationSec: result.durationSec,
				kind: "video",
				start: sceneStart(id),
				dur: Math.min(s.dur, result.durationSec),
				label,
				source: "generated",
			});
		} catch (e) {
			setGenErr(`Animate failed: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			setAnimateBusy((b) => ({ ...b, [id]: false }));
		}
	};

	return { gen, genEnd, animateBusy, genFrame, genAll, animateScene };
}
