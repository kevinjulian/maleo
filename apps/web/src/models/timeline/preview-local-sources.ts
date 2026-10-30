import type { StoryboardForRender } from "@maleo/shared";

import { STUDIO_BLANK_PIXEL } from "./studio-base-storyboard.ts";

/** Preview-only projection. Never replace arbitrary text or mutate the export storyboard. */
export function withPreviewLocalSources(
	storyboard: StoryboardForRender,
	resolve: (url: string) => string | undefined,
): StoryboardForRender {
	const image = (url: string | null | undefined) =>
		url ? (resolve(url) ?? STUDIO_BLANK_PIXEL) : url;
	const audio = (url: string | undefined) => (url ? resolve(url) : undefined);
	function visual<T extends { url: string; kind?: "image" | "video" }>(value: T): T {
		const local = resolve(value.url);
		return local ? { ...value, url: local } : { ...value, url: STUDIO_BLANK_PIXEL, kind: "image" };
	}
	return {
		...storyboard,
		musicUrl: audio(storyboard.musicUrl),
		scenes: storyboard.scenes.map((scene) => ({
			...scene,
			image: image(scene.image) ?? "",
			endImage: image(scene.endImage),
			sfxUrl: audio(scene.sfxUrl),
			visualClips: scene.visualClips?.map(visual),
			audioClips: scene.audioClips?.map((clip) => ({ ...clip, url: audio(clip.url) })),
			sectionTransition: scene.sectionTransition
				? {
						...scene.sectionTransition,
						plateImageUrl: image(scene.sectionTransition.plateImageUrl) ?? undefined,
					}
				: undefined,
		})),
		videoOverlays: storyboard.videoOverlays?.map((value) => ({
			...visual(value),
			thumb: image(value.thumb) ?? undefined,
		})),
		visualTimeline: storyboard.visualTimeline?.map(visual),
		audioOverlays: storyboard.audioOverlays?.map((value) => ({ ...value, url: audio(value.url) })),
	};
}
