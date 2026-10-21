// Concrete capability modules. Each one knows what secrets it needs,
// where its policy lives, and how to compute its status.

import { readWorkspaceSecrets } from "../workspace-secrets.ts";
import { readWorkspaceConfig } from "../config-yaml.ts";
import { readImagePolicy, getGenerationStats } from "../image-policy.ts";
import { readVideoPolicy, getVideoStats } from "../video-policy.ts";
import { refreshableKeys } from "../secret-refresh.ts";
import type { CapabilityId, CapabilityModule } from "./types.ts";
import { keysOf } from "@maleo/shared";

function presentSecrets(workspace: string, keys: string[]) {
	const s = readWorkspaceSecrets(workspace);
	const present: string[] = [];
	const missing: string[] = [];
	for (const k of keys) {
		if (s[k] && s[k].length > 0) present.push(k);
		else missing.push(k);
	}
	return { present, missing };
}

const threads: CapabilityModule = {
	id: "threads",
	group: "channels",
	label: "Threads",
	description: "Post + reply on Threads via Meta Graph API",
	required_secrets: ["THREADS_ACCESS_TOKEN", "THREADS_USER_ID"],
	policy_key: null,
	async inspect(workspace) {
		const { present, missing } = presentSecrets(workspace, this.required_secrets);
		if (missing.length > 0) {
			return { status: "missing_secret", status_detail: `missing: ${missing.join(", ")}` };
		}
		const s = readWorkspaceSecrets(workspace);
		const issuedAt = parseInt(s.THREADS_TOKEN_ISSUED_AT ?? "0", 10);
		const expiresIn = parseInt(s.THREADS_TOKEN_EXPIRES_IN ?? "0", 10);
		if (issuedAt > 0 && expiresIn > 0) {
			const expiresAt = issuedAt + expiresIn * 1000;
			const daysLeft = Math.floor((expiresAt - Date.now()) / 86_400_000);
			if (daysLeft < 0) {
				return { status: "expired", status_detail: `token expired ${-daysLeft}d ago` };
			}
			return {
				status: "ok",
				status_detail: `token valid, refresh in ${daysLeft}d`,
				metrics: { token_days_left: daysLeft },
			};
		}
		return { status: "ok", status_detail: `token present (${present.length} secrets)` };
	},
};

const instagram: CapabilityModule = {
	id: "instagram",
	group: "channels",
	label: "Instagram",
	description: "Post on Instagram via Meta Graph API",
	required_secrets: ["IG_ACCESS_TOKEN", "IG_BUSINESS_ID"],
	policy_key: null,
	async inspect(workspace) {
		const { missing } = presentSecrets(workspace, this.required_secrets);
		if (missing.length > 0) {
			return { status: "missing_secret", status_detail: `missing: ${missing.join(", ")}` };
		}
		return { status: "ok" };
	},
};

const telegram: CapabilityModule = {
	id: "telegram",
	group: "ops",
	label: "Telegram approvals",
	description: "Approve/reject drafts + receive alerts via Telegram",
	required_secrets: ["TELEGRAM_BOT_TOKEN"],
	policy_key: null,
	async inspect(workspace) {
		const { missing } = presentSecrets(workspace, this.required_secrets);
		if (missing.length > 0) {
			return { status: "missing_secret", status_detail: `missing: ${missing.join(", ")}` };
		}
		/* Secrets is the only source. This used to check
		 * `config.yaml`'s `approval.telegram_chat_id` first — a field that is in
		 * none of the workspace configs, written by nothing, and matches nowhere
		 * else in the repo but a DB column. That branch has never returned a
		 * value; every read fell through to here. */
		const chatId = readWorkspaceSecrets(workspace).TELEGRAM_CHAT_ID ?? null;
		if (!chatId) {
			return {
				status: "not_configured",
				status_detail: "TELEGRAM_CHAT_ID not set in secrets",
			};
		}
		return { status: "ok", status_detail: `chat ${String(chatId).slice(0, 6)}…` };
	},
};

const imageGen: CapabilityModule = {
	id: "image_gen",
	group: "content",
	label: "Image generation",
	description: "Generate images via maleo-image (Gemini canvas / API / fal)",
	required_secrets: [],
	policy_key: "image_policy",
	async inspect(workspace) {
		const policy = await readImagePolicy(workspace);
		const stats = await getGenerationStats(workspace);
		// "enabled" now derived from channel activations matrix —
		// image_gen counts as in-use when any channel activates image.
		const channelsActive = await anyChannelActivatesImage(workspace);
		if (!channelsActive) {
			return {
				status: "disabled",
				status_detail: "no channel activates image — toggle in channels → activations",
				policy,
				metrics: {
					today: stats.today,
					last_hour: stats.last_hour,
					cost_today_usd: stats.cost_today_usd,
				},
			};
		}
		const limitHit = policy.daily_limit > 0 && stats.today >= policy.daily_limit;
		return {
			status: limitHit ? "rate_limited" : "ok",
			status_detail: limitHit
				? `daily limit hit (${stats.today}/${policy.daily_limit})`
				: `${stats.today} today${policy.daily_limit ? ` / ${policy.daily_limit}` : ""}`,
			policy,
			metrics: {
				today: stats.today,
				last_hour: stats.last_hour,
				cost_today_usd: stats.cost_today_usd,
			},
		};
	},
};

async function anyChannelActivatesImage(workspace: string): Promise<boolean> {
	try {
		const channels = (await readWorkspaceConfig(workspace)).channels;
		if (!channels) return false;
		for (const ch of Object.values(channels)) {
			const acts = ch.activations;
			if (acts?.post?.image || acts?.reply?.image) return true;
		}
		return false;
	} catch {
		return false;
	}
}

const videoGen: CapabilityModule = {
	id: "video_gen",
	group: "content",
	label: "Video generation",
	description: "Render videos via maleo-video (Remotion + presets)",
	required_secrets: [],
	policy_key: "video_policy",
	async inspect(workspace) {
		const policy = await readVideoPolicy(workspace);
		const stats = await getVideoStats(workspace);
		const enabled = policy.post_mode !== "disabled" || policy.reply_mode !== "disabled";
		if (!process.env.MALEO_VIDEO_URL) {
			return {
				status: "not_configured",
				status_detail: "MALEO_VIDEO_URL not set in dashboard env",
				policy,
				metrics: {
					today: stats.today,
					last_hour: stats.last_hour,
					cost_today_usd: stats.cost_today_usd,
				},
			};
		}
		if (!enabled) {
			return {
				status: "disabled",
				status_detail: "both modes disabled",
				policy,
				metrics: {
					today: stats.today,
					last_hour: stats.last_hour,
					cost_today_usd: stats.cost_today_usd,
				},
			};
		}
		const limitHit = policy.daily_limit > 0 && stats.today >= policy.daily_limit;
		return {
			status: limitHit ? "rate_limited" : "ok",
			status_detail: limitHit
				? `daily limit hit (${stats.today}/${policy.daily_limit})`
				: `${stats.today} today${policy.daily_limit ? ` / ${policy.daily_limit}` : ""}`,
			policy,
			metrics: {
				today: stats.today,
				last_hour: stats.last_hour,
				cost_today_usd: stats.cost_today_usd,
			},
		};
	},
};

const MODULES = {
	threads,
	instagram,
	telegram,
	image_gen: imageGen,
	video_gen: videoGen,
} satisfies Record<CapabilityId, CapabilityModule>;

export function listModules(): CapabilityModule[] {
	return Object.values(MODULES);
}

/** Every capability id, from the table itself rather than a second list that can
 *  drift from it. `MODULES` uses `satisfies`, so its keys stay literal. */
export const CAPABILITY_IDS = keysOf(MODULES);

export function getModule(id: CapabilityId): CapabilityModule | null {
	return MODULES[id] ?? null;
}

export function refreshableForCapability(cap: CapabilityModule): string[] {
	const refs = new Set(refreshableKeys());
	return cap.required_secrets.filter((k) => refs.has(k));
}
