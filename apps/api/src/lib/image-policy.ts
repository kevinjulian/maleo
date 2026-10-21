// Per-workspace image-generation policy.
//
// This block now holds ONLY infrastructure / limits / provider knobs.
// Per-kind mode/probability/aspect lives in:
//   - channels.<id>.activations  (which content types are active)
//   - behavior.content.mix       (weighted pick when ≥2 active)
//   - channels.<id>.overrides.image_aspect (per-channel aspect)
//
// Legacy fields (post_mode, reply_mode, post_image_prob,
// reply_image_prob, post_aspect, reply_aspect, per_channel) are
// ignored at read time and stripped at write time.

import YAML from "yaml";
import {
	DEFAULT_IMAGE_POLICY,
	evaluateGate,
	parseImagePolicy,
	type ImagePolicyCore,
	type GateResult as SharedGateResult,
} from "@maleo/shared";
import type { Workspace } from "./workspace/schema.ts";
import {
	readWorkspaceConfig,
	readWorkspaceConfigText,
	writeWorkspaceConfigText,
} from "./config-yaml.ts";
import {
	listImageGenerationsToday,
	lastImageGenerationAt,
	recordImageGeneration,
	resetImageGenerationLog,
} from "@maleo/db/generation-log";

export type { FallbackMode, GateResult } from "@maleo/shared";
export type Kind = "post" | "reply";
export type Channel = "threads" | "instagram";

export type ImagePolicy = ImagePolicyCore;

const DEFAULT_POLICY: ImagePolicy = { ...DEFAULT_IMAGE_POLICY };

export async function readImagePolicy(workspace: string): Promise<ImagePolicy> {
	let cfg: Workspace;
	try {
		cfg = await readWorkspaceConfig(workspace);
	} catch {
		return { ...DEFAULT_POLICY };
	}
	return parseImagePolicy(cfg.image_policy);
}

// Write policy back, stripping any legacy keys that may still linger
// in YAML so they don't keep re-appearing.
const LEGACY_KEYS = [
	"post_mode",
	"reply_mode",
	"post_image_prob",
	"reply_image_prob",
	"post_aspect",
	"reply_aspect",
	"per_channel",
];

export async function writeImagePolicy(workspace: string, policy: ImagePolicy): Promise<void> {
	const text = await readWorkspaceConfigText(workspace);
	const doc = YAML.parseDocument(text);
	doc.setIn(["image_policy"], policy);
	for (const k of LEGACY_KEYS) {
		try {
			if (doc.hasIn(["image_policy", k])) doc.deleteIn(["image_policy", k]);
		} catch {
			/* ignore */
		}
	}
	await writeWorkspaceConfigText(workspace, String(doc));
}

// Strip legacy image_policy keys from a workspace's config.yaml without
// touching any other fields. Used by GET /image-policy so just opening
// the editor (re)cleans the file. Idempotent + safe — no-op if
// nothing to strip.
export async function stripLegacyImagePolicy(workspace: string): Promise<boolean> {
	let text: string;
	try {
		text = await readWorkspaceConfigText(workspace);
	} catch {
		return false;
	}
	const doc = YAML.parseDocument(text);
	let touched = false;
	for (const k of LEGACY_KEYS) {
		try {
			if (doc.hasIn(["image_policy", k])) {
				doc.deleteIn(["image_policy", k]);
				touched = true;
			}
		} catch {
			/* not a map — skip */
		}
	}
	if (touched) await writeWorkspaceConfigText(workspace, String(doc));
	return touched;
}

export interface GenerationStats {
	today: number;
	last_hour: number;
	last_at: number | null;
	cost_today_usd: number;
	by_channel: Record<string, number>;
}

export async function getGenerationStats(workspace: string): Promise<GenerationStats> {
	const rows = await listImageGenerationsToday(workspace);
	const hourMs = Date.now() - 3_600_000;
	let costToday = 0;
	const byChannel: Record<string, number> = {};
	let lastHour = 0;
	for (const r of rows) {
		if (r.cost_usd) costToday += r.cost_usd;
		const ch = r.channel ?? "other";
		byChannel[ch] = (byChannel[ch] ?? 0) + 1;
		if (r.created_at >= hourMs) lastHour++;
	}
	return {
		today: rows.length,
		last_hour: lastHour,
		last_at: await lastImageGenerationAt(workspace),
		cost_today_usd: Math.round(costToday * 10000) / 10000,
		by_channel: byChannel,
	};
}

export async function canGenerate(workspace: string): Promise<SharedGateResult> {
	return evaluateGate(await readImagePolicy(workspace), await getGenerationStats(workspace));
}

export async function recordGeneration(
	workspace: string,
	kind: Kind,
	opts?: { channel?: Channel; cost_usd?: number },
): Promise<void> {
	const policy = await readImagePolicy(workspace);
	await recordImageGeneration({
		workspace,
		kind,
		channel: opts?.channel ?? null,
		cost_usd: opts?.cost_usd ?? policy.cost_per_image_usd ?? 0,
	});
}

export function resetGenerationLog(workspace: string): Promise<number> {
	return resetImageGenerationLog(workspace);
}
