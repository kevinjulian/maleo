// Video-render policy: superset of image-policy (adds mode, prob,
// preset, template fields specific to the video pipeline). Shared
// between core (orchestrator) and dashboard (settings UI + gates).
//
// Reuses clampInt/Float, pickFallback, pickHourRange, evaluateGate
// from image-policy.

import {
	clampFloat,
	clampInt,
	evaluateGate,
	pickFallback,
	pickHourRange,
	type FallbackMode,
	type GateResult,
	type GenerationSnapshot,
} from "./image-policy.ts";
import { fieldOf } from "./object-keys.ts";

export type VideoMode = "disabled" | "enabled" | "mixed";

// Channel set is a subset/alias of ChannelId — video-only channels.
export type VideoChannel = "tiktok" | "reels" | "shorts" | "yt-long" | "ig-feed";

export interface VideoPolicyCore {
	post_mode: VideoMode;
	reply_mode: VideoMode;
	post_prob: number; // 0..100 when mixed
	reply_prob: number;
	default_preset: VideoChannel | null;
	default_template: string | null; // "classic" | "split-screen" | …
	daily_limit: number;
	hourly_limit: number;
	gap_seconds: number;
	allowed_hours: [number, number] | null;
	cost_per_render_usd: number;
	max_daily_cost_usd: number;
	on_limit_hit: FallbackMode;
}

export const DEFAULT_VIDEO_POLICY: VideoPolicyCore = {
	post_mode: "disabled",
	reply_mode: "disabled",
	post_prob: 0,
	reply_prob: 0,
	default_preset: null,
	default_template: null,
	daily_limit: 0,
	hourly_limit: 0,
	gap_seconds: 0,
	allowed_hours: null,
	cost_per_render_usd: 0,
	max_daily_cost_usd: 0,
	on_limit_hit: "degrade",
};

function pickVideoMode(v: unknown, fb: VideoMode): VideoMode {
	if (v === "disabled" || v === "enabled" || v === "mixed") return v;
	return fb;
}

function pickPreset(v: unknown): VideoChannel | null {
	if (v === "tiktok" || v === "reels" || v === "shorts" || v === "yt-long" || v === "ig-feed")
		return v;
	return null;
}

function stringOrNull(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

export function parseVideoPolicy(raw: unknown): VideoPolicyCore {
	if (!raw || typeof raw !== "object") return { ...DEFAULT_VIDEO_POLICY };
	// Field by field off the block rather than a declared dictionary: every
	// helper below already treats a wrong type as absent, which is exactly the
	// `unknown` `fieldOf` hands back.
	const field = (key: string): unknown => fieldOf(raw, key);
	return {
		post_mode: pickVideoMode(field("post_mode"), DEFAULT_VIDEO_POLICY.post_mode),
		reply_mode: pickVideoMode(field("reply_mode"), DEFAULT_VIDEO_POLICY.reply_mode),
		post_prob: clampInt(field("post_prob"), 0, 100, 0),
		reply_prob: clampInt(field("reply_prob"), 0, 100, 0),
		default_preset: pickPreset(field("default_preset")),
		// One read, then the check — two `field(...)` calls would not narrow.
		default_template: stringOrNull(field("default_template")),
		daily_limit: clampInt(field("daily_limit"), 0, 10000, 0),
		hourly_limit: clampInt(field("hourly_limit"), 0, 10000, 0),
		gap_seconds: clampInt(field("gap_seconds"), 0, 86400, 0),
		allowed_hours: pickHourRange(field("allowed_hours")),
		cost_per_render_usd: clampFloat(field("cost_per_render_usd"), 0, 100, 0),
		max_daily_cost_usd: clampFloat(field("max_daily_cost_usd"), 0, 100000, 0),
		on_limit_hit: pickFallback(field("on_limit_hit"), DEFAULT_VIDEO_POLICY.on_limit_hit),
	};
}

// Video uses the same gate-eval shape as image, but with the
// cost-per-unit name swapped (cost_per_render_usd vs
// cost_per_image_usd). Adapter wraps evaluateGate.
export function evaluateVideoGate(
	policy: VideoPolicyCore,
	stats: GenerationSnapshot,
	now: number = Date.now(),
): GateResult {
	return evaluateGate(
		{
			daily_limit: policy.daily_limit,
			hourly_limit: policy.hourly_limit,
			gap_seconds: policy.gap_seconds,
			allowed_hours: policy.allowed_hours,
			cost_per_image_usd: policy.cost_per_render_usd,
			max_daily_cost_usd: policy.max_daily_cost_usd,
			on_limit_hit: policy.on_limit_hit,
			notify_on_limit: false,
		},
		stats,
		now,
	);
}
