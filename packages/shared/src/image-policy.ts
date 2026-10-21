import { fieldOf } from "./object-keys.ts";
// Image-policy shape: just the infrastructure/limits knobs that core
// and dashboard both read. IO + per-repo extras stay local.
//
// NOTE: legacy fields (post_mode, reply_mode, post_image_prob,
// reply_image_prob, post_aspect, reply_aspect, per_channel) were
// dropped from the dashboard schema in favour of channel.activations
// + behavior.content.mix. Core's image-policy still references them
// for back-compat with workspaces that haven't migrated; new code
// should only use the fields below.

export type FallbackMode = "degrade" | "skip";

export interface ImagePolicyCore {
	daily_limit: number; // 0 = unlimited
	hourly_limit: number; // 0 = unlimited
	gap_seconds: number; // 0 = no gap between gens
	allowed_hours: [number, number] | null; // [start, end) 0..24; null = any
	cost_per_image_usd: number;
	max_daily_cost_usd: number; // 0 = unlimited
	on_limit_hit: FallbackMode;
	notify_on_limit: boolean;
}

export const DEFAULT_IMAGE_POLICY: ImagePolicyCore = {
	daily_limit: 0,
	hourly_limit: 0,
	gap_seconds: 0,
	allowed_hours: null,
	cost_per_image_usd: 0,
	max_daily_cost_usd: 0,
	on_limit_hit: "degrade",
	notify_on_limit: false,
};

export function clampInt(v: unknown, min: number, max: number, fb: number): number {
	const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
	if (!Number.isFinite(n)) return fb;
	return Math.max(min, Math.min(max, Math.round(n)));
}

export function clampFloat(v: unknown, min: number, max: number, fb: number): number {
	const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
	if (!Number.isFinite(n)) return fb;
	return Math.max(min, Math.min(max, n));
}

export function pickFallback(v: unknown, fb: FallbackMode): FallbackMode {
	if (v === "degrade" || v === "skip") return v;
	return fb;
}

export function pickHourRange(v: unknown): [number, number] | null {
	if (!Array.isArray(v) || v.length !== 2) return null;
	const a = clampInt(v[0], 0, 24, -1);
	const b = clampInt(v[1], 0, 24, -1);
	if (a < 0 || b < 0 || a === b) return null;
	return [a, b];
}

// Parse a raw config block into the canonical ImagePolicyCore shape.
// Returns defaults if block missing/invalid.
export function parseImagePolicy(raw: unknown): ImagePolicyCore {
	if (!raw || typeof raw !== "object") return { ...DEFAULT_IMAGE_POLICY };
	// Read field by field off the block instead of declaring it a dictionary:
	// every clamp below already treats a wrong type as absent, so `fieldOf`
	// handing back `unknown` is the type those helpers were written for.
	const field = (key: string): unknown => fieldOf(raw, key);
	return {
		daily_limit: clampInt(field("daily_limit"), 0, 10000, 0),
		hourly_limit: clampInt(field("hourly_limit"), 0, 10000, 0),
		gap_seconds: clampInt(field("gap_seconds"), 0, 86400, 0),
		allowed_hours: pickHourRange(field("allowed_hours")),
		cost_per_image_usd: clampFloat(field("cost_per_image_usd"), 0, 100, 0),
		max_daily_cost_usd: clampFloat(field("max_daily_cost_usd"), 0, 100000, 0),
		on_limit_hit: pickFallback(field("on_limit_hit"), DEFAULT_IMAGE_POLICY.on_limit_hit),
		notify_on_limit: fieldOf(raw, "notify_on_limit") === true,
	};
}

// Check current usage vs configured limits. Returns first violation or
// null when free to proceed.
export interface GenerationSnapshot {
	today: number;
	last_hour: number;
	last_at: number | null;
	cost_today_usd: number;
}

export type GateResult =
	| { ok: true }
	| { ok: false; reason: "daily_limit"; today: number; limit: number }
	| { ok: false; reason: "hourly_limit"; last_hour: number; limit: number }
	| { ok: false; reason: "gap"; wait_seconds: number }
	| { ok: false; reason: "off_hours"; window: [number, number] }
	| { ok: false; reason: "cost_cap"; cost_today_usd: number; cap: number };

export function evaluateGate(
	policy: ImagePolicyCore,
	stats: GenerationSnapshot,
	now: number = Date.now(),
): GateResult {
	if (policy.allowed_hours) {
		const [start, end] = policy.allowed_hours;
		const h = new Date(now).getHours();
		const inside = start < end ? h >= start && h < end : h >= start || h < end;
		if (!inside) return { ok: false, reason: "off_hours", window: [start, end] };
	}
	if (policy.daily_limit > 0 && stats.today >= policy.daily_limit) {
		return { ok: false, reason: "daily_limit", today: stats.today, limit: policy.daily_limit };
	}
	if (policy.hourly_limit > 0 && stats.last_hour >= policy.hourly_limit) {
		return {
			ok: false,
			reason: "hourly_limit",
			last_hour: stats.last_hour,
			limit: policy.hourly_limit,
		};
	}
	if (
		policy.max_daily_cost_usd > 0 &&
		stats.cost_today_usd + policy.cost_per_image_usd > policy.max_daily_cost_usd
	) {
		return {
			ok: false,
			reason: "cost_cap",
			cost_today_usd: stats.cost_today_usd,
			cap: policy.max_daily_cost_usd,
		};
	}
	if (policy.gap_seconds > 0 && stats.last_at) {
		const elapsed = (now - stats.last_at) / 1000;
		if (elapsed < policy.gap_seconds) {
			return { ok: false, reason: "gap", wait_seconds: Math.ceil(policy.gap_seconds - elapsed) };
		}
	}
	return { ok: true };
}
