/* Caption configuration — a persisted, render-affecting part of the storyboard.
 *
 * This lived in `apps/web/.../editor-captions.tsx` beside the panel that edits it,
 * which meant the render projection could not name it: `render-storyboard.ts`
 * typed the field `object` and worked around the absence in a comment. It is not
 * editor-local state — it persists inside `storyboard_json` and changes what is
 * rendered, so by the placement test in CONTEXT.md it belongs to the document, and
 * the document's type has to be reachable from every package that reads one.
 *
 * The panel keeps its presets and its UI; only the shape and its default move. */

export type CaptionPresetKey =
	| "standard"
	| "yellow"
	| "highlight"
	| "blackOnWhite"
	| "documentary"
	| "tiktokPunch"
	| "education"
	| "karaoke";

export type CaptionMotion = "None" | "Fade" | "Pop" | "Slide Up";

export interface CaptionConfig {
	enabled: boolean;
	fontFamily: string;
	fontSize: number;
	weight: string;
	italic: boolean;
	allCaps: boolean;
	style: string;
	lines: "Single Line" | "Two Lines";
	chunkDuration: string;
	maxWords: number;
	maxChars: number;
	maxPauseMs: number;
	/** 0–100 (% from top). */
	verticalPosition: number;
	/** 0–100 (% of canvas). */
	maxWidth: number;
	fill: string;
	activeColor: string;
	stroke: string;
	background: string;
	shadow: string;
	shadowOpacity: number;
	shadowBlur: number;
	shadowDistance: number;
	shadowAngle: number;
	inactiveOpacity: number;
	motion: CaptionMotion;
	preset: CaptionPresetKey;
}

export const DEFAULT_CAPTIONS: CaptionConfig = {
	// On by default: narrated video reads better with kinetic captions (sound-off
	// retention). Word timings are derived at render from the voiceover audio.
	enabled: true,
	fontFamily: "Inter",
	fontSize: 72,
	weight: "Black",
	italic: false,
	allCaps: false,
	style: "Standard",
	lines: "Single Line",
	chunkDuration: "1,2",
	maxWords: 4,
	maxChars: 26,
	maxPauseMs: 260,
	verticalPosition: 100,
	maxWidth: 86,
	fill: "#ffffff",
	activeColor: "#ffd400",
	stroke: "transparent",
	background: "transparent",
	shadow: "transparent",
	shadowOpacity: 78,
	shadowBlur: 18,
	shadowDistance: 5,
	shadowAngle: 90,
	inactiveOpacity: 55,
	motion: "Fade",
	preset: "standard",
};
