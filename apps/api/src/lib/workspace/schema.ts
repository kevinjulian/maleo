import { z } from "zod";

// Identity anchors carried by a workspace. `character` feeds project references
// and `voice` feeds the style-direction voice layer at generation time.
export const CharacterSchema = z.object({
	type: z.enum(["fictional", "real", "brand", "anon"]).default("real"),
	archetype: z.string().optional(),
	backstory: z.string().optional(),
	lore_constraints: z.array(z.string()).default([]),
});

export const VoiceSchema = z.object({
	signature_laugh: z.string().optional(),
	common_interjections: z.array(z.string()).default([]),
	sentence_endings: z.array(z.string()).default([]),
	forbidden_words: z.array(z.string()).default([]),
	punctuation_style: z.enum(["minimal_caps", "standard", "all_caps", "free"]).default("standard"),
	emoji_usage: z.enum(["none", "rare", "moderate", "heavy"]).default("moderate"),
});

// Dashboard-managed blocks — lib files (image-policy.ts, video-policy.ts,
// content-behavior.ts) own their own validation. Listed here so
// WorkspaceSchema.parse() doesn't strip them.
export const ImagePolicySchema = z.record(z.string(), z.unknown());
export const VideoPolicySchema = z.record(z.string(), z.unknown());
export const ImageStyleSchema = z.record(z.string(), z.unknown());
export const ContentBehaviorSchema = z.object({
	mix: z.record(z.string(), z.record(z.string(), z.number())).optional(),
	rules: z.array(z.unknown()).optional(),
});
export const CapabilitiesSchema = z.record(
	z.string(),
	z.object({ enabled: z.boolean().optional() }).passthrough(),
);

/* Per-channel activation matrix. Read by the dashboard's
 * `channel-activations.ts` and by `capabilities/modules.ts`.
 *
 * The SHAPE is not core's invention: `@maleo/shared/channel-activations.ts`
 * already owns it — `ActivationRow`, `ChannelOverrides`,
 * `parseChannelActivations` — under a header saying both core and dashboard
 * reuse it. Declaring it here reuses that shape rather than pulling a
 * consumer-owned one into core.
 *
 * Every sub-block is optional because the stored files leave them out:
 * `kunti`'s `tiktok` entry carries `automation` alone, with no `activations`
 * and no `overrides`. A schema requiring `activations` would reject a real
 * config. This declares what `parseChannelActivations` already accepts, not a
 * stricter shape it would then have to defend against. */
export const ActivationRowSchema = z
	.object({
		text: z.boolean().optional(),
		image: z.boolean().optional(),
		video: z.boolean().optional(),
	})
	.passthrough();

export const ChannelEntrySchema = z
	.object({
		activations: z
			.object({
				post: ActivationRowSchema.optional(),
				reply: ActivationRowSchema.optional(),
			})
			.passthrough()
			.optional(),
		overrides: z
			.object({
				image_aspect: z.string().nullable().optional(),
				video_aspect: z.string().nullable().optional(),
			})
			.passthrough()
			.optional(),
		automation: z
			.object({
				auto_post: z.boolean().optional(),
				auto_reply: z.boolean().optional(),
			})
			.passthrough()
			.optional(),
	})
	.passthrough();

export const ChannelsSchema = z.record(z.string(), ChannelEntrySchema);

/* `approval` is deliberately NOT declared. Five configs carry it — `mode`,
 * `ttl_seconds`, `on_timeout_post|reply|evolve`, and `gates[]` in sigi — and
 * nothing in `packages` or `apps` reads a single one of those keys. There is no
 * Telegram sender in the repo; `db/approvals.ts` records to a table and the
 * `telegram` capability module only reports status. The block is inert operator
 * text the pivot left behind, like `niche` and `tone` beside it, and passthrough
 * carries it harmlessly. Declaring a dead shape would give it a schema's
 * authority for no reader. */

export const ImageGenerationSchema = z.object({
	enabled: z.boolean().default(false),
	style_prefix: z.string().default(""),
	size: z.enum(["square", "square_hd", "portrait_4_3", "landscape_4_3"]).default("portrait_4_3"),
	min_confidence: z.number().min(0).max(1).default(0.6),
	poll_interval_ms: z.number().int().positive().default(2000),
	poll_max_attempts: z.number().int().positive().default(45),
});

export const BrandingSchema = z.object({
	color: z.string().optional(),
	color_bright: z.string().optional(),
	color_deep: z.string().optional(),
	tagline: z.string().optional(),
	initials: z.string().optional(),
});

/* OPEN, and deliberately so.
 *
 * This declares twelve keys of a `config.yaml` that real workspaces carry
 * twenty-one to twenty-nine of. As a closed object it dropped the rest — 24
 * distinct keys, `veronika` losing 22 of its 29 — and `loadWorkspace` hands the
 * result whole to `tool.run`, so a tool reading `workspace.niche` saw
 * `undefined` with no error.
 *
 * It cannot be completed, either: `collection-files.ts` reads
 * `collections_${collection}`, a key built from a caller's argument, so the key
 * set is not knowable statically. A closed schema over this document is not a
 * stricter version of an open one — it is one that silently deletes what it does
 * not recognise.
 *
 * So passthrough is the accurate description, NOT a shortcut around declaring
 * the blocks. What is declared below is checked; everything else survives the
 * parse typed as `unknown`, which is honest where `undefined` was not. The four
 * dashboard-managed blocks were already declared for exactly this reason — see
 * the comment above them — and that instinct simply stopped after four. */
export const WorkspaceSchema = z
	.object({
		name: z.string().min(1),
		display_name: z.string().optional(),
		branding: BrandingSchema.optional(),
		character: CharacterSchema.default({ type: "real", lore_constraints: [] }),
		voice: VoiceSchema.default({
			common_interjections: [],
			sentence_endings: [],
			forbidden_words: [],
			punctuation_style: "standard",
			emoji_usage: "moderate",
		}),
		image_generation: ImageGenerationSchema.default({
			enabled: false,
			style_prefix: "",
			size: "portrait_4_3",
			min_confidence: 0.6,
			poll_interval_ms: 2000,
			poll_max_attempts: 45,
		}),
		/* Dashboard-managed blocks (validated by their own lib files).
		 *
		 * `.catch(undefined)` on each, and it is load-bearing rather than cosmetic.
		 * `config.yaml` is hand-edited by operators, and every one of these blocks is
		 * read through a lib file that already treats absence as "feature off". A
		 * plain `.optional()` makes a typo in ONE block fail the whole document, so
		 * every other reader loses its config too — a typo in `video_policy` turning
		 * off capabilities, channels and image style is a far worse regression than
		 * the assertions this parse replaces. `.catch(undefined)` keeps the blast
		 * radius at the block that is actually broken, which is exactly what happened
		 * before the parse existed. */
		image_policy: ImagePolicySchema.optional().catch(undefined),
		video_policy: VideoPolicySchema.optional().catch(undefined),
		image_style: ImageStyleSchema.optional().catch(undefined),
		behavior: z
			.object({ content: ContentBehaviorSchema.optional() })
			.passthrough()
			.optional()
			.catch(undefined),
		capabilities: CapabilitiesSchema.optional().catch(undefined),
		channels: ChannelsSchema.optional().catch(undefined),
		/* The narration writer style, stored as the profile KEY and nothing else.
		 *
		 * A key rather than a copy of the profile's craft fields, so a profile can be
		 * corrected or retired in `@maleo/shared` without migrating stored workspaces.
		 * Deliberately a plain string and not an enum of the current library: a config
		 * naming a retired profile must still LOAD, and `resolveWriterStyle` is what
		 * turns an unknown key into "no writer style" at read time. Validating the
		 * closed set here instead would make retiring a profile break every workspace
		 * that had chosen it. */
		writer_style: z.string().optional().catch(undefined),
		/* `tools:` was declared here as a grant list for the deterministic tools a
		 * workspace could run. Its only gate was `GET /api/tools/:name`, which is gone,
		 * so the grant guards nothing and is no longer part of the format — a key that
		 * denies access to a route that does not exist misleads exactly as much as one
		 * that enforces nothing. Configs written before the removal keep the key
		 * through `.passthrough()` below rather than failing to load. */
	})
	.passthrough();

export type Workspace = z.infer<typeof WorkspaceSchema>;

/* The same document, validated strictly — for WRITES.
 *
 * A read tolerates a malformed dashboard block (`.catch(undefined)` above) so
 * one bad block cannot take unrelated readers down. A write has no such
 * reason: configuration is validated before it is stored, so the tolerance
 * would only let a bad block be saved and fail later. Same keys, same
 * passthrough, no `.catch`. */
export const WorkspaceWriteSchema = WorkspaceSchema.extend({
	image_policy: ImagePolicySchema.optional(),
	video_policy: VideoPolicySchema.optional(),
	image_style: ImageStyleSchema.optional(),
	behavior: z.object({ content: ContentBehaviorSchema.optional() }).passthrough().optional(),
	capabilities: CapabilitiesSchema.optional(),
	channels: ChannelsSchema.optional(),
	writer_style: z.string().optional(),
}).passthrough();
