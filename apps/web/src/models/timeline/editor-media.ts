/* Maleo — Content-First Create · Data, helpers, constants, types */

import { type Scene, type EffectKind, type TransitionType } from "@maleo/shared";

export const MEDIA_DND_MIME = "text/maleo-media-url";

export const MEDIA_DND_ID = "text/maleo-media-id";

export const MEDIA_DND_KIND = "text/maleo-media-kind";

export const MEDIA_DND_DUR = "text/maleo-media-dur";

export const MEDIA_DND_LABEL = "text/maleo-media-label";

export const MEDIA_DND_SOURCE = "text/maleo-media-source";

export const MEDIA_DND_THUMB = "text/maleo-media-thumb";

/** Which audio track a dragged bed or effect belongs on. Carried separately from
 *  the media kind, which only says "audio" — without it every audio drop landed
 *  as music, so a sound effect dragged from Stock became a music clip. */
export const MEDIA_DND_AUDIO_KIND = "text/maleo-media-audio-kind";

/** The workspace entity a dragged reference image belongs to, so the asset the
 *  drop admits can record where it came from. */
export const MEDIA_DND_REF_ENTITY = "text/maleo-media-ref-entity";

// Drag-and-drop payload for dragging a clip template (Templates panel) onto the
// timeline. Carries the same discriminated shape as ClipTemplateDef so the drop
// handler can create the right overlay kind without re-deriving it.

export const CLIP_TEMPLATE_DND_MIME = "text/maleo-clip-template";

export type { MediaAsset } from "@maleo/shared/editor";

export const EFFECT_DEFS: ReadonlyArray<{
	kind: EffectKind;
	label: string;
	desc: string;
	dur: number;
}> = [
	{ kind: "fade_in", label: "Fade In", desc: "Fade in from black", dur: 1 },
	{ kind: "fade_out", label: "Fade Out", desc: "Fade out to black", dur: 1 },
	{
		kind: "zoom_out_from_black",
		label: "Zoom Out from Black",
		desc: "Black frame, then zoom out from close-up to normal",
		dur: 1.5,
	},
	// Pattern interrupts — short attention-reset spikes (retention devices).
	{ kind: "flash", label: "Flash", desc: "Quick white flash — pattern interrupt", dur: 0.35 },
	{ kind: "zoom_punch", label: "Zoom Punch", desc: "Fast zoom-in snap that eases back", dur: 0.5 },
	{ kind: "whip_pan", label: "Whip Pan", desc: "Fast lateral whip across the frame", dur: 0.45 },
];

// TTS voice ids understood by configured provider.

export function preserveAgentSceneTimeline(
	previous: Scene | undefined,
	contentDurationSec: number | undefined,
): Pick<Scene, "start" | "track" | "contentDur"> {
	return {
		start: previous?.start,
		track: previous?.track,
		contentDur: contentDurationSec ?? previous?.contentDur,
	};
}

export const STUDIO_SHOTS = [
	"Wide Shot",
	"Medium Wide",
	"Medium Shot",
	"Medium Close Up",
	"Close Up",
	"Macro",
	"Product Hero",
	"Overhead",
	"Low Angle",
	"POV",
];

export const STUDIO_MOVES = [
	"Static",
	"Slow Pan",
	"Slow Pan Left",
	"Slow Pan Right",
	"Slow Zoom In",
	"Slow Zoom Out",
	"Slight Push In",
	"Slight Pull Out",
	"Follow / Tracking",
	"Tilt Up",
	"Tilt Down",
	"Handheld",
	"Orbit",
	"Glitch",
];

export const STUDIO_TRANSITIONS: TransitionType[] = [
	"cut",
	"fade",
	"slide",
	"zoom",
	"wipe",
	"flip",
	"clock_wipe",
	"pixel",
];

/* ════ Content types ════ */
