// Per-workspace video-generation policy. Pure shape + gate logic in
// @maleo/shared; this module owns the dashboard's IO (config YAML
// read, video_generation_log DB writes).

import {
	DEFAULT_VIDEO_POLICY,
	evaluateVideoGate,
	parseVideoPolicy,
	type GateResult,
	type VideoChannel,
	type VideoPolicyCore,
} from "@maleo/shared";
import type { Workspace } from "./workspace/schema.ts";
import { readWorkspaceConfig } from "./config-yaml.ts";
import {
	listVideoGenerationsToday,
	lastVideoGenerationAt,
	recordVideoGeneration,
	resetVideoGenerationLog,
} from "@maleo/db/generation-log";

export type { VideoChannel, VideoMode, VideoPolicyCore } from "@maleo/shared";
export type Channel = VideoChannel;
export type Kind = "post" | "reply";
export type VideoPolicy = VideoPolicyCore;
export type VideoGate = GateResult;

const DEFAULT: VideoPolicy = { ...DEFAULT_VIDEO_POLICY };

export async function readVideoPolicy(workspace: string): Promise<VideoPolicy> {
	let cfg: Workspace;
	try {
		cfg = await readWorkspaceConfig(workspace);
	} catch {
		return { ...DEFAULT };
	}
	return parseVideoPolicy(cfg.video_policy);
}

export interface VideoStats {
	today: number;
	last_hour: number;
	last_at: number | null;
	cost_today_usd: number;
}

export async function getVideoStats(workspace: string): Promise<VideoStats> {
	const rows = await listVideoGenerationsToday(workspace);
	const hourMs = Date.now() - 3_600_000;
	let cost = 0;
	let lastHour = 0;
	for (const r of rows) {
		if (r.cost_usd) cost += r.cost_usd;
		if (r.created_at >= hourMs) lastHour++;
	}
	return {
		today: rows.length,
		last_hour: lastHour,
		last_at: await lastVideoGenerationAt(workspace),
		cost_today_usd: Math.round(cost * 10000) / 10000,
	};
}

export async function canRenderVideo(workspace: string): Promise<VideoGate> {
	return evaluateVideoGate(await readVideoPolicy(workspace), await getVideoStats(workspace));
}

export async function recordVideoRender(
	workspace: string,
	kind: Kind,
	opts?: { channel?: Channel; cost_usd?: number; from_cache?: boolean },
): Promise<void> {
	// A cache hit spent nothing, so it neither counts against the quota nor costs.
	if (opts?.from_cache) return;
	const policy = await readVideoPolicy(workspace);
	await recordVideoGeneration({
		workspace,
		kind,
		channel: opts?.channel ?? null,
		cost_usd: opts?.cost_usd ?? policy.cost_per_render_usd ?? 0,
	});
}

export function resetVideoLog(workspace: string): Promise<number> {
	return resetVideoGenerationLog(workspace);
}
