import type { Storyboard } from "@maleo/video/composition";

/** 1x1 transparent GIF used by studio previews with no base scene image. */
export const STUDIO_BLANK_PIXEL =
	"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

export interface StudioBaseStoryboardInput {
	durationSec: number;
	accentColor: string;
	bgColor: string;
	fgColor: string;
	/** Overlay layers to render (Motion Studio maps its layers here). */
	textOverlays?: Storyboard["textOverlays"];
}

/** Neutral single-scene preview storyboard for web-owned studio adapters. */
export function studioBaseStoryboard({
	durationSec,
	accentColor,
	bgColor,
	fgColor,
	textOverlays,
}: StudioBaseStoryboardInput): Storyboard {
	return {
		scenes: [
			{
				image: STUDIO_BLANK_PIXEL,
				durationSec,
				label: "",
				movement: "Static",
				transition: "cut",
				voiceover: "",
				visual: "",
				camera: "",
				vignette: false,
				grain: false,
			},
		],
		accentColor,
		bgColor,
		fgColor,
		musicMood: "minimal",
		showLabels: false,
		hideBase: true,
		muteBase: true,
		textOverlays: textOverlays ?? [],
		audioOverlays: [],
		videoOverlays: [],
		effects: [],
	};
}
