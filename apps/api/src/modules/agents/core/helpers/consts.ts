/* Shared taxonomies + default values used by tool handlers.
 * Defaults live here (not inline) so they are named, discoverable, and consistent
 * across handlers rather than magic literals. */
import type { AgentClipLayout } from "../model.ts";

// Text Director roles the add_text tool accepts.
export const TEXT_PRESETS: ReadonlySet<string> = new Set([
	"title",
	"subtitle",
	"lower-third",
	"stat",
	"quote",
	"location",
	"timeline",
	"chapter",
	"explainer-card",
	"section-card",
]);

// Non-voiceover audio cue kinds the add_audio tool accepts.
export const AUDIO_OVERLAY_KINDS = ["sfx", "ambient", "accent_hit", "music"] as const;

// Default clip durations (seconds) when the agent omits one.
export const DEFAULT_SCENE_DUR_SEC = 4;
export const DEFAULT_TEXT_DUR_SEC = 2;
export const DEFAULT_OVERLAY_DUR_SEC = 3;
export const DEFAULT_AUDIO_DUR_SEC = 2;
export const DEFAULT_ACCENT_HIT_DUR_SEC = 0.6;

// Speaking rate used to estimate a voiceover clip's duration from its word count.
export const WORDS_PER_SEC = 2.6;

// Fallback TTS voice tag when the agent gives none.
export const DEFAULT_VOICE = "M1";

// Default on-canvas placement (percent of frame) for generated clips. Overrides
// from args merge on top.
export const DEFAULT_OVERLAY_LAYOUT: AgentClipLayout = {
	xPct: 52,
	yPct: 10,
	widthPct: 42,
	fit: "cover",
};

// Served directory for synthesized/generated assets.
export const UPLOADS_DIR = "public/uploads";
