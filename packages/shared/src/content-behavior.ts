// behavior.content layer: when ≥2 media types are active for a
// (channel, kind), decides which one. Pure helpers — IO (reading
// config.yaml) stays in each consumer because dashboard and core use
// different config-loading paths.

import { z } from "zod";
import { entriesOf } from "@maleo/shared";
import { fieldOf } from "./object-keys.ts";
import { MEDIA_TYPES, type MediaType } from "./channel.ts";
import { activeMediaTypes, type ChannelActivations, type Kind } from "./channel-activations.ts";

export type Mix = Partial<Record<MediaType, number>>;

export interface ContextSnapshot {
	hour?: number; // 0..23 in workspace timezone
	topic?: string;
	tone?: string;
	last_n_types?: MediaType[]; // most recent first
}

export interface Rule {
	id: string;
	when: {
		hour_between?: [number, number];
		topic_equals?: string;
		tone_equals?: string;
		last_n_types?: { n: number; equals: MediaType };
		channel_equals?: string;
		kind_equals?: Kind;
	};
	prefer?: MediaType;
	force?: MediaType;
	probability?: number; // 0..100; default 100 (always when prefer matches)
}

export interface ContentBehavior {
	mix: Record<string, Mix>; // key = `${channel}.${kind}`
	rules: Rule[];
}

export const DEFAULT_CONTENT_BEHAVIOR: ContentBehavior = { mix: {}, rules: [] };

const mediaType = z.enum(MEDIA_TYPES);
/* A rule as config states it. A malformed rule is dropped rather than trusted:
 * `ruleMatches` reads its fields as their types. */
const ruleSchema: z.ZodType<Rule> = z.object({
	id: z.string(),
	when: z.object({
		hour_between: z.tuple([z.number(), z.number()]).optional(),
		topic_equals: z.string().optional(),
		tone_equals: z.string().optional(),
		last_n_types: z.object({ n: z.number(), equals: mediaType }).optional(),
		channel_equals: z.string().optional(),
		kind_equals: z.enum(["post", "reply"]).optional(),
	}),
	prefer: mediaType.optional(),
	force: mediaType.optional(),
	probability: z.number().optional(),
});

export function parseContentBehavior(raw: unknown): ContentBehavior {
	const content = fieldOf(fieldOf(raw, "behavior"), "content");
	const mixRaw = fieldOf(content, "mix");
	const mix: Record<string, Mix> = {};
	if (mixRaw && typeof mixRaw === "object") {
		for (const [k, row] of Object.entries(mixRaw)) {
			const m: Mix = {};
			for (const t of MEDIA_TYPES) {
				const n = Number(fieldOf(row, t));
				if (Number.isFinite(n) && n > 0) m[t] = Math.max(0, Math.round(n));
			}
			if (Object.keys(m).length > 0) mix[k] = m;
		}
	}
	const rulesRaw = fieldOf(content, "rules");
	const rules = Array.isArray(rulesRaw)
		? rulesRaw.flatMap((rule: unknown) => {
				const parsed = ruleSchema.safeParse(rule);
				return parsed.success ? [parsed.data] : [];
			})
		: [];
	return { mix, rules };
}

export function ruleMatches(
	rule: Rule,
	ctx: ContextSnapshot,
	channel: string,
	kind: Kind,
): boolean {
	const w = rule.when;
	if (w.channel_equals && w.channel_equals !== channel) return false;
	if (w.kind_equals && w.kind_equals !== kind) return false;
	if (w.hour_between && ctx.hour != null) {
		const [s, e] = w.hour_between;
		const inside = s < e ? ctx.hour >= s && ctx.hour < e : ctx.hour >= s || ctx.hour < e;
		if (!inside) return false;
	}
	if (w.topic_equals && ctx.topic !== w.topic_equals) return false;
	if (w.tone_equals && ctx.tone !== w.tone_equals) return false;
	if (w.last_n_types) {
		const recent = (ctx.last_n_types ?? []).slice(0, w.last_n_types.n);
		if (recent.length < w.last_n_types.n) return false;
		if (!recent.every((t) => t === w.last_n_types?.equals)) return false;
	}
	return true;
}

export function weightedPick(mix: Mix, allowed: MediaType[]): MediaType {
	// `Mix` is a Partial, so a present key can still hold `undefined`. The cast
	// this replaced claimed `number` and hid that; the guard narrows it instead.
	const entries = entriesOf(mix).filter(
		(entry): entry is [MediaType, number] =>
			entry[1] !== undefined && entry[1] > 0 && allowed.includes(entry[0]),
	);
	if (entries.length === 0) {
		return allowed[Math.floor(Math.random() * allowed.length)] ?? "text";
	}
	const total = entries.reduce((s, [, w]) => s + w, 0);
	let roll = Math.random() * total;
	for (const [t, w] of entries) {
		roll -= w;
		if (roll <= 0) return t;
	}
	return entries[entries.length - 1]![0];
}

export type ContentDecision =
	| { skip: true; reason: string }
	| { skip: false; type: MediaType; reason: string };

// Decide content given pre-loaded activations + behavior. Use this in
// hot paths to avoid re-reading config per call.
export function decideContentFromBehavior(
	activations: ChannelActivations,
	behavior: ContentBehavior,
	kind: Kind,
	channel: string,
	ctx: ContextSnapshot = {},
): ContentDecision {
	const active = activeMediaTypes(activations, kind);
	if (active.length === 0) return { skip: true, reason: "no_content_active" };
	if (active.length === 1) return { skip: false, type: active[0]!, reason: "only_option" };

	for (const rule of behavior.rules) {
		if (!ruleMatches(rule, ctx, channel, kind)) continue;
		if (rule.force && active.includes(rule.force)) {
			return { skip: false, type: rule.force, reason: `rule:${rule.id}:force` };
		}
		if (rule.prefer && active.includes(rule.prefer)) {
			const prob = rule.probability ?? 100;
			if (Math.random() * 100 < prob) {
				return { skip: false, type: rule.prefer, reason: `rule:${rule.id}` };
			}
		}
	}

	const key = `${channel}.${kind}`;
	const mix = behavior.mix[key] ?? {};
	const picked = weightedPick(mix, active);
	return {
		skip: false,
		type: picked,
		reason: Object.keys(mix).length > 0 ? "mix" : "uniform_fallback",
	};
}
