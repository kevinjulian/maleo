// Channel + media types shared between core (decideContent) and dashboard
// (settings UI, channel-caps manifest). Single source of truth — neither
// repo redefines these.

/* Each union is derived from its member array, so a boundary can CHECK a value
 * — a plugin manifest's `channel_id`, a stored media type — rather than assert
 * it, and the list cannot drift from the type. */
export const MEDIA_TYPES = ["text", "image", "video"] as const;

export type MediaType = (typeof MEDIA_TYPES)[number];

export const ASPECTS = ["1:1", "16:9", "9:16", "4:5"] as const;

export type Aspect = (typeof ASPECTS)[number];

export const CHANNEL_IDS = [
	"threads",
	"instagram",
	"tiktok",
	"reels",
	"shorts",
	"yt-long",
] as const;

export type ChannelId = (typeof CHANNEL_IDS)[number];

// Platform-plugin capability manifest. Plugins declare this in their
// manifest.supports block; both core and dashboard read it.
export interface ChannelSupports {
	channel_id: string;
	label: string;
	content_types: MediaType[];
	max_text_chars: number;
	max_image_count: number;
	max_video_duration_sec: number;
	image_aspect_ratios: Aspect[];
	video_aspect_ratios: Aspect[];
	requires_image?: boolean;
	requires_video?: boolean;
}

// Dashboard's "ChannelManifest" is the same shape with id locked to the
// ChannelId enum. Kept as alias so existing callers compile unchanged.
export interface ChannelManifest extends Omit<ChannelSupports, "channel_id"> {
	id: ChannelId;
}

export function pickAspect(v: unknown): Aspect | null {
	if (v === "1:1" || v === "16:9" || v === "9:16" || v === "4:5") return v;
	return null;
}
