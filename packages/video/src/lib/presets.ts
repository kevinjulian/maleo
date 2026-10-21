export type CompositionId =
	| "ProductReel"
	| "ProductSquare"
	| "ProductWide"
	| "StoryboardReel"
	| "StoryboardSquare"
	| "StoryboardWide";

export type PlatformPreset = {
	id: string;
	compositionId: CompositionId;
	maxDurationSec: number;
	videoBitrate: `${number}M` | `${number}K` | `${number}k`;
	audioBitrate: `${number}M` | `${number}K` | `${number}k`;
	codec: "h264" | "h265";
	pixelFormat: "yuv420p" | "yuv420p10le";
};

export const PRESETS: Record<string, PlatformPreset> = {
	tiktok: {
		id: "tiktok",
		compositionId: "ProductReel",
		maxDurationSec: 60,
		videoBitrate: "6M",
		audioBitrate: "128k",
		codec: "h264",
		pixelFormat: "yuv420p",
	},
	reels: {
		id: "reels",
		compositionId: "ProductReel",
		maxDurationSec: 90,
		videoBitrate: "8M",
		audioBitrate: "128k",
		codec: "h264",
		pixelFormat: "yuv420p",
	},
	shorts: {
		id: "shorts",
		compositionId: "ProductReel",
		maxDurationSec: 60,
		videoBitrate: "8M",
		audioBitrate: "192k",
		codec: "h264",
		pixelFormat: "yuv420p",
	},
	"ig-feed": {
		id: "ig-feed",
		compositionId: "ProductSquare",
		maxDurationSec: 60,
		videoBitrate: "6M",
		audioBitrate: "128k",
		codec: "h264",
		pixelFormat: "yuv420p",
	},
	"yt-long": {
		id: "yt-long",
		compositionId: "ProductWide",
		maxDurationSec: 600,
		videoBitrate: "12M",
		audioBitrate: "192k",
		codec: "h264",
		pixelFormat: "yuv420p",
	},
	"storyboard-tiktok": {
		id: "storyboard-tiktok",
		compositionId: "StoryboardReel",
		maxDurationSec: 60,
		videoBitrate: "6M",
		audioBitrate: "128k",
		codec: "h264",
		pixelFormat: "yuv420p",
	},
	"storyboard-reels": {
		id: "storyboard-reels",
		compositionId: "StoryboardReel",
		maxDurationSec: 90,
		videoBitrate: "8M",
		audioBitrate: "128k",
		codec: "h264",
		pixelFormat: "yuv420p",
	},
	"storyboard-shorts": {
		id: "storyboard-shorts",
		compositionId: "StoryboardReel",
		maxDurationSec: 60,
		videoBitrate: "8M",
		audioBitrate: "192k",
		codec: "h264",
		pixelFormat: "yuv420p",
	},
	"storyboard-square": {
		id: "storyboard-square",
		compositionId: "StoryboardSquare",
		maxDurationSec: 60,
		videoBitrate: "6M",
		audioBitrate: "128k",
		codec: "h264",
		pixelFormat: "yuv420p",
	},
	"storyboard-wide": {
		id: "storyboard-wide",
		compositionId: "StoryboardWide",
		maxDurationSec: 600,
		videoBitrate: "12M",
		audioBitrate: "192k",
		codec: "h264",
		pixelFormat: "yuv420p",
	},
};

export type PresetId = keyof typeof PRESETS;

export type PresetAspect = "vertical" | "square" | "horizontal";

// Aspect is implied by the composition: Reel = 9:16, Square = 1:1, Wide = 16:9.
export function presetAspect(compositionId: CompositionId): PresetAspect {
	if (compositionId.endsWith("Square")) return "square";
	if (compositionId.endsWith("Wide")) return "horizontal";
	return "vertical";
}

const ASPECT_RATIO = {
	vertical: "9:16",
	square: "1:1",
	horizontal: "16:9",
} satisfies Record<PresetAspect, string>;

// Human label per preset id. Falls back to a generated label for unknown ids.
const PRESET_LABELS: Record<string, string> = {
	tiktok: "TikTok",
	reels: "Instagram Reels",
	shorts: "YouTube Shorts",
	"ig-feed": "Instagram Feed",
	"yt-long": "YouTube (long-form)",
	"storyboard-tiktok": "Storyboard · TikTok",
	"storyboard-reels": "Storyboard · Reels",
	"storyboard-shorts": "Storyboard · Shorts",
	"storyboard-square": "Storyboard · Square",
	"storyboard-wide": "Storyboard · Wide",
};

export interface PresetDescriptor {
	id: string;
	compositionId: CompositionId;
	maxDurationSec: number;
	codec: string;
	videoBitrate: string;
	// Presentational metadata for the picker UI.
	label: string;
	aspect: PresetAspect;
	aspectRatio: string;
	/** One-line "what is this for" hint, e.g. "9:16 · up to 60s". */
	hint: string;
}

// Enrich a preset with picker-facing metadata (label, aspect, duration hint).
export function describePreset(p: PlatformPreset): PresetDescriptor {
	const aspect = presetAspect(p.compositionId);
	const ratio = ASPECT_RATIO[aspect];
	const dur =
		p.maxDurationSec >= 120 ? `${Math.round(p.maxDurationSec / 60)}min` : `${p.maxDurationSec}s`;
	return {
		id: p.id,
		compositionId: p.compositionId,
		maxDurationSec: p.maxDurationSec,
		codec: p.codec,
		videoBitrate: p.videoBitrate,
		label: PRESET_LABELS[p.id] ?? p.id,
		aspect,
		aspectRatio: ratio,
		hint: `${ratio} · up to ${dur}`,
	};
}
