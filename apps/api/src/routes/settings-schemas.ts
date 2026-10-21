/* Request-body schemas for the settings routes.
 *
 * Each one reproduces what its handler already accepted, which is not always
 * the same as what its old assertion claimed. Two shapes recur:
 *
 *   COERCED — `typeof body.x === "string" ? body.x.trim() : null` treats a
 *   non-string as "clear it". That is a decision the route makes, so the schema
 *   makes it too, and a client relying on it keeps working.
 *
 *   UNCHECKED — `daily_limit: body.daily_limit ?? current.daily_limit` writes
 *   whatever arrived into stored config. That is not tolerance, it is the
 *   defect this change exists to close: `daily_limit: "lots"` is persisted
 *   today. Those fields get a real type and a 400.
 */
import { z } from "zod";
import { WRITER_STYLES } from "@maleo/shared";

/** A field the route clears on anything that is not a string. */
const coercedString = z.unknown().transform((v) => (typeof v === "string" ? v.trim() : null));

export const imageProviderBody = z.object({ provider_id: coercedString.optional() });
/* The TTS twin. Same shape on purpose: an absent or empty `provider_id` clears
 * the selection, which is how an operator returns to the registry default. */
export const ttsProviderBody = z.object({ provider_id: coercedString.optional() });
export const textProviderKeyBody = z.object({ value: coercedString.optional() });
export const textProviderBody = z.object({
	provider_id: coercedString.optional(),
	model: coercedString.optional(),
	thinking: coercedString.optional(),
});

/* `updates` was already rejected with 400 when absent or not an object; the
 * schema says the same and adds that its values are strings, which
 * `updateDashboardEnv` has always assumed. */
export const globalEnvBody = z.object({ updates: z.record(z.string(), z.string()) });

/* `key` and `value` were defaulted to "" and then checked by hand. The schema
 * keeps the default so a missing field still produces the same 400 message from
 * the handler rather than a different one from the parser. */
export const workspaceSecretBody = z.object({
	key: z.string().default(""),
	value: z.string().default(""),
});

export const capabilityToggleBody = z.object({ enabled: z.boolean() });

const fallbackMode = z.enum(["degrade", "skip"]);
const allowedHours = z.tuple([z.number(), z.number()]).nullable();

export const imagePolicyPatch = z
	.object({
		daily_limit: z.number(),
		hourly_limit: z.number(),
		gap_seconds: z.number(),
		allowed_hours: allowedHours,
		cost_per_image_usd: z.number(),
		max_daily_cost_usd: z.number(),
		on_limit_hit: fallbackMode,
		notify_on_limit: z.boolean(),
	})
	.partial();

export const videoPolicyPatch = z
	.object({
		post_mode: z.enum(["disabled", "enabled", "mixed"]),
		reply_mode: z.enum(["disabled", "enabled", "mixed"]),
		post_prob: z.number(),
		reply_prob: z.number(),
		default_preset: z.enum(["tiktok", "reels", "shorts", "yt-long", "ig-feed"]).nullable(),
		default_template: z.string().nullable(),
		daily_limit: z.number(),
		hourly_limit: z.number(),
		gap_seconds: z.number(),
		allowed_hours: allowedHours,
		cost_per_render_usd: z.number(),
		max_daily_cost_usd: z.number(),
		on_limit_hit: fallbackMode,
	})
	.partial();

/* The narration writer style, validated against the live library rather than
 * accepted as any string. This is the WRITE path, where an unknown key would be
 * an operator mistake worth rejecting — unlike the READ path, which tolerates a
 * retired key so a workspace that stored one still loads.
 *
 * `null` clears the selection and must stay reachable: unset is a real state
 * meaning "plan as this workspace did before writer styles existed". */
export const writerStylePatch = z.object({
	writerStyle: z.enum(WRITER_STYLES).nullable(),
});

const activationRow = z
	.object({ text: z.boolean(), image: z.boolean(), video: z.boolean() })
	.partial();
const aspect = z.enum(["1:1", "16:9", "9:16", "4:5"]).nullable();

export const channelActivationsPatch = z
	.object({
		post: activationRow,
		reply: activationRow,
		overrides: z.object({ image_aspect: aspect, video_aspect: aspect }).partial(),
	})
	.partial();

const mix = z.record(z.enum(["text", "image", "video"]), z.number());
const behaviorRule = z
	.object({
		id: z.string(),
		when: z
			.object({
				hour_between: z.tuple([z.number(), z.number()]),
				topic_equals: z.string(),
				tone_equals: z.string(),
				last_n_types: z.object({ n: z.number(), equals: z.enum(["text", "image", "video"]) }),
				channel_equals: z.string(),
				kind_equals: z.enum(["post", "reply"]),
			})
			.partial(),
		prefer: z.enum(["text", "image", "video"]).optional(),
	})
	.passthrough();

export const contentBehaviorPatch = z
	.object({
		mix: z.record(z.string(), mix),
		rules: z.array(behaviorRule),
	})
	.partial();
