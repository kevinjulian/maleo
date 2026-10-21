import { z } from "zod";
import { libraryFixtureFieldsSchema } from "./library-fixture.ts";
import { EMOTIONS, type Emotion } from "./video-style.ts";
import type { TextPreset } from "./timeline-model.ts";

export const TIMELINE_SCENE_TRANSITIONS = [
	"cut",
	"fade",
	"slide",
	"zoom",
	"wipe",
	"flip",
	"clock_wipe",
	"pixel",
] as const;
const timelineAssetUrlSchema = z
	.string()
	.trim()
	.max(2048)
	.refine(
		(value) => !value || value.startsWith("/") || /^https?:\/\//i.test(value),
		"SFX asset URL must be HTTP(S) or a managed relative path",
	);

export const TIMELINE_MUSIC_POLICIES = ["single", "per_emotion"] as const;
export type TimelineMusicPolicy = (typeof TIMELINE_MUSIC_POLICIES)[number];

/* One emotion's music: a searchable cue plus the exact asset an operator picked for
 * it, the same pair the SFX fields carry. The url is what makes a per-emotion choice
 * deterministic — keyword search can find a track ABOUT the right words but not
 * reliably one of the right tone ("melancholic slow piano" resolves to "Slow Piano
 * Horror"), so auditioning and pinning is the only way to be sure.
 *
 * A bare string is accepted and read as a cue with no pinned asset, so entries
 * written before the url existed keep working. */
const musicEmotionCueSchema = z.preprocess(
	(value) => (typeof value === "string" ? { cue: value } : value),
	z
		.object({
			cue: z.string().trim().max(160).default(""),
			url: timelineAssetUrlSchema.default(""),
		})
		.strict(),
);

/* Sparse on purpose: an operator fills only the emotions they care about and
 * everything else falls back to `musicCue`, so a template never has to restate the
 * whole vocabulary. */
const musicEmotionCuesSchema = z
	.object(
		// SAFETY: built from EMOTIONS, so the object has exactly one key per Emotion.
		Object.fromEntries(EMOTIONS.map((emotion) => [emotion, musicEmotionCueSchema.optional()])) as {
			[K in Emotion]: z.ZodOptional<typeof musicEmotionCueSchema>;
		},
	)
	.strict()
	.partial();

export interface TimelineMusicEmotionCue {
	cue: string;
	url: string;
}
export type TimelineMusicEmotionCues = Partial<Record<Emotion, TimelineMusicEmotionCue>>;

/* The shipped palette, and the schema default.
 *
 * Defaulting to the palette rather than `{}` is what lets a template stored before
 * this field existed pick the cues up on read, with no backfill — the whole map is
 * missing from its persisted JSON, so the default applies. Templates saved since
 * always write the key explicitly, so an operator's own map (including one they
 * emptied) is preserved rather than re-seeded.
 *
 * Cues are one or two words because the providers match on tags and titles, not
 * prose: auditioned against the live catalogue, three-word cues like "low tense
 * drone" or "uplifting rising strings" returned nothing, and a cue that resolves to
 * nothing silently drops its bed. Every cue here was verified to return playable
 * results. */
export const DEFAULT_MUSIC_EMOTION_CUES: Readonly<Required<TimelineMusicEmotionCues>> = {
	calm: { cue: "soft ambient pad", url: "" },
	curiosity: { cue: "playful pizzicato", url: "" },
	suspense: { cue: "suspense ambient", url: "" },
	tension: { cue: "dark driving pulse", url: "" },
	shock: { cue: "dramatic impact", url: "" },
	sadness: { cue: "melancholic slow piano", url: "" },
	relief: { cue: "warm ambient", url: "" },
	hope: { cue: "hopeful ambient", url: "" },
	victory: { cue: "triumphant orchestral swell", url: "" },
	chaos: { cue: "distorted chaos", url: "" },
};

/* Keys this schema used to carry, still present in every row written before they
 * were retired. A template persists as ONE `template_json` blob, not as columns
 * (`core/db/timeline-templates.ts`), and the object below is `.strict()` — so an old
 * blob would throw on read, and `ensureDefaultTimelineTemplate` runs on every list
 * and get, which makes that one throw the whole template panel rather than one bad
 * row.
 *
 * `.strict()` stays: it is what catches a typo'd key in a hand-edited template
 * instead of silently ignoring it. The normaliser below reconciles old blobs ahead
 * of it rather than loosening it.
 *
 * DELETE THIS, and the normaliser, once no environment holds a row written by an
 * older build; until then such a row still parses. */
const RETIRED_TEMPLATE_KEYS = [
	// Written, never read at render. Render takes its background from the project's
	// own settings, which is the single owner of that value.
	"backgroundFill",
	// Merged into a run's generation lock, then filtered out again: the ids resolve
	// against the project's ROSTER and nothing attached a template's references to
	// one, so the field never reached a render.
	"referenceIds",
] as const;

/* Fields renamed because they named the wrong entity: both resolve through
 * `resolveTimelineIntroTextPreset` to a text preset and have no relationship with
 * the `MotionPreset` entity (`motion-preset.ts`). */
const RENAMED_TEMPLATE_KEYS: Readonly<Record<string, string>> = {
	introMotionPreset: "introTextPreset",
	sectionMotionPreset: "sectionTextPreset",
};

/** Reconcile a stored blob with the current field set: drop retired keys, and move a
 *  renamed key's value onto its new name when only the old name is present. A blob
 *  that already carries the new name is left alone, so this is a no-op after the
 *  migration has run. */
function normalizeStoredTemplate(value: unknown): unknown {
	if (!value || typeof value !== "object" || Array.isArray(value)) return value;
	// SAFETY: checked above to be a non-null, non-array object; it is only read by key.
	const source = value as Record<string, unknown>;
	const touches =
		RETIRED_TEMPLATE_KEYS.some((key) => key in source) ||
		Object.keys(RENAMED_TEMPLATE_KEYS).some((key) => key in source);
	if (!touches) return value;

	const next: Record<string, unknown> = { ...source };
	for (const key of RETIRED_TEMPLATE_KEYS) delete next[key];
	for (const [oldKey, newKey] of Object.entries(RENAMED_TEMPLATE_KEYS)) {
		if (!(oldKey in next)) continue;
		const carried = next[oldKey];
		delete next[oldKey];
		// A blob holding both names is mid-migration; the new name is authoritative.
		if (!(newKey in next)) next[newKey] = carried;
	}
	return next;
}

const timelineTemplateFieldsSchema = z
	.object({
		name: z.string().trim().min(1).max(80),
		description: z.string().trim().max(240).default(""),
		introTextPreset: z.string().trim().max(80).default("chapter"),
		introEntrySfx: z.string().trim().max(160).default("subtle transition stinger"),
		introEntrySfxUrl: timelineAssetUrlSchema.default(""),
		introLeadInSec: z.number().nonnegative().default(0.6),
		introTitleDurationSec: z.number().positive().default(4),
		introEntrySfxVolume: z.number().min(0).max(1).default(0.6),
		introEntrySfxOffsetSec: z.number().nonnegative().default(0),
		sectionGapSec: z.number().nonnegative().default(0.6),
		sectionTitlePolicy: z.enum(["none", "first_only", "every_section"]).default("every_section"),
		sectionTextPreset: z.string().trim().max(80).default("chapter"),
		sceneEntrySfx: z.string().trim().max(160).default(""),
		sceneEntrySfxUrl: timelineAssetUrlSchema.default(""),
		// Background music, shaped like the SFX fields above: a cue resolved against the
		// royalty-free libraries, a pinned url that overrides every cue, and a gain.
		// `single` keeps one bed for the whole video (the historical behaviour);
		// `per_emotion` resolves a cue per section from musicEmotionCues.
		musicCue: z.string().trim().max(160).default("calm ambient background"),
		musicUrl: timelineAssetUrlSchema.default(""),
		musicVolume: z.number().min(0).max(1).default(1),
		musicPolicy: z.enum(TIMELINE_MUSIC_POLICIES).default("single"),
		musicEmotionCues: musicEmotionCuesSchema.default(() =>
			structuredClone(DEFAULT_MUSIC_EMOTION_CUES),
		),
		sentenceVoiceoverPauseSec: z.number().nonnegative().default(0.15),
		sceneVoiceoverPauseSec: z.number().nonnegative().default(0.35),
		maxVisualBeatSec: z.number().min(2).max(15).default(6),
		maxVoiceoverSegmentSec: z.number().min(3).max(20).default(8),
		staticSceneMovement: z.boolean().default(false),
		overrideSceneTransition: z.boolean().default(false),
		sceneTransition: z.enum(TIMELINE_SCENE_TRANSITIONS).default("fade"),
		useData: z.boolean().default(true),
		imageGuidancePrompt: z.string().trim().max(2000).default(""),
	})
	.strict();

/** Read/write shape for a template's config. The normaliser runs ahead of the
 *  object so a blob written before the retirements and the rename still parses;
 *  `.strict()` still rejects a key that is neither current nor accounted for. */
export const timelineTemplateInputSchema = z.preprocess(
	normalizeStoredTemplate,
	timelineTemplateFieldsSchema,
);

export const timelineTemplateSchema = z.preprocess(
	normalizeStoredTemplate,
	timelineTemplateFieldsSchema
		.extend({
			id: z.string().min(1),
			createdAt: z.number().int().nonnegative(),
			updatedAt: z.number().int().nonnegative(),
		})
		.extend(libraryFixtureFieldsSchema.shape),
);

export type TimelineTemplateInput = z.infer<typeof timelineTemplateInputSchema>;
export type TimelineTemplate = z.infer<typeof timelineTemplateSchema>;

export const DEFAULT_TIMELINE_TEMPLATE_ID = "timeline-default-documentary";
export const ANIMATED_SYSTEMS_EXPLAINER_TEMPLATE_ID = "timeline-animated-systems-explainer";
export const STORY_TITLE_ID_BASE = 51_000_000;
export const DEFAULT_TIMELINE_TEMPLATE: TimelineTemplateInput = {
	name: "Documentary flow",
	description: "Narration-first sections with chapter motion, entry accents, and data when useful.",
	introTextPreset: "chapter",
	introEntrySfx: "subtle transition stinger",
	introEntrySfxUrl: "",
	introLeadInSec: 0.6,
	introTitleDurationSec: 4,
	introEntrySfxVolume: 0.6,
	introEntrySfxOffsetSec: 0,
	sectionGapSec: 0.6,
	sectionTitlePolicy: "every_section",
	sectionTextPreset: "chapter",
	sceneEntrySfx: "",
	sceneEntrySfxUrl: "",
	musicCue: "calm ambient background",
	musicUrl: "",
	musicVolume: 1,
	// Policy stays `single` so an untouched template renders exactly as before; the
	// palette ships populated anyway, so flipping to `per_emotion` yields a real
	// score rather than ten copies of one bed.
	musicPolicy: "single",
	musicEmotionCues: structuredClone(DEFAULT_MUSIC_EMOTION_CUES),
	sentenceVoiceoverPauseSec: 0.15,
	sceneVoiceoverPauseSec: 0.35,
	maxVisualBeatSec: 6,
	maxVoiceoverSegmentSec: 8,
	staticSceneMovement: false,
	overrideSceneTransition: false,
	sceneTransition: "fade",
	useData: true,
	imageGuidancePrompt:
		"Illustrate {{section.title}} in direct support of this narration: {{section.narration}}",
};

export const ANIMATED_SYSTEMS_EXPLAINER_TEMPLATE: TimelineTemplateInput = {
	name: "Animated systems explainer",
	description:
		"Question-led sections with clear diagrams, symbolic animation, and explanatory visual beats.",
	introTextPreset: "section-card",
	introEntrySfx: "soft whoosh",
	introEntrySfxUrl: "",
	introLeadInSec: 0.4,
	introTitleDurationSec: 3,
	introEntrySfxVolume: 0.55,
	introEntrySfxOffsetSec: 0,
	sectionGapSec: 0.45,
	sectionTitlePolicy: "every_section",
	sectionTextPreset: "section-card",
	sceneEntrySfx: "subtle pop",
	sceneEntrySfxUrl: "",
	musicCue: "playful pizzicato",
	musicUrl: "",
	musicVolume: 0.85,
	musicPolicy: "per_emotion",
	musicEmotionCues: structuredClone(DEFAULT_MUSIC_EMOTION_CUES),
	sentenceVoiceoverPauseSec: 0.12,
	sceneVoiceoverPauseSec: 0.3,
	maxVisualBeatSec: 4,
	maxVoiceoverSegmentSec: 7,
	staticSceneMovement: false,
	overrideSceneTransition: true,
	sceneTransition: "slide",
	useData: true,
	imageGuidancePrompt:
		"Create flat editorial animation for {{section.title}}. Use diagrams, maps, flows, scales, timelines, or object metaphors that directly explain this narration: {{section.narration}}",
};

/* The shipped Video Templates, as fixture definitions.
 *
 * `slug` is the identity bootstrap finds them by. `legacyId` is the id they were
 * seeded with before fixtures existed, back when a shipped template was inserted with
 * a hardcoded primary key — it is how the migration recognises an existing row as this
 * fixture and adopts it, keeping the id every preset and project already references.
 * New databases assign a fresh id and never use the legacy one. */
export interface TimelineTemplateFixture {
	slug: string;
	legacyId: string;
	template: TimelineTemplateInput;
}

export const DEFAULT_TIMELINE_TEMPLATE_SLUG = "timeline-default-documentary";
export const ANIMATED_SYSTEMS_EXPLAINER_TEMPLATE_SLUG = "timeline-animated-systems-explainer";

export const TIMELINE_TEMPLATE_FIXTURES: readonly TimelineTemplateFixture[] = [
	{
		slug: DEFAULT_TIMELINE_TEMPLATE_SLUG,
		legacyId: DEFAULT_TIMELINE_TEMPLATE_ID,
		template: DEFAULT_TIMELINE_TEMPLATE,
	},
	{
		slug: ANIMATED_SYSTEMS_EXPLAINER_TEMPLATE_SLUG,
		legacyId: ANIMATED_SYSTEMS_EXPLAINER_TEMPLATE_ID,
		template: ANIMATED_SYSTEMS_EXPLAINER_TEMPLATE,
	},
];

/* Derived with `Extract` rather than written out, so the subset relation to
 * `TextPreset` is enforced instead of coincidental. It was already a subset —
 * which is why the three `as TextPreset` casts at the call sites narrowed
 * nothing — but nothing said so, and dropping a member from `TEXT_PRESETS` would
 * have left this naming a preset that no longer exists. */
export type TimelineIntroTextPreset = Extract<
	TextPreset,
	"chapter" | "rve-cinematic-title-intro" | "section-card" | "rve-countdown-intro"
>;

export function resolveTimelineIntroTextPreset(preset: string): TimelineIntroTextPreset {
	if (preset === "cinematic-title-intro") return "rve-cinematic-title-intro";
	if (preset === "countdown-intro") return "rve-countdown-intro";
	if (preset === "section-card") return "section-card";
	return "chapter";
}

export function isStoryTitleOverlayId(id: number | undefined): boolean {
	return typeof id === "number" && id >= STORY_TITLE_ID_BASE && id < STORY_TITLE_ID_BASE + 100_000;
}

export function resolveTimelineImageGuidance(
	prompt: string,
	context: { projectBrief?: string; sectionTitle: string; sectionNarration: string },
): string {
	return prompt
		.replaceAll("{{project.brief}}", context.projectBrief ?? "")
		.replaceAll("{{section.title}}", context.sectionTitle)
		.replaceAll("{{section.narration}}", context.sectionNarration)
		.trim();
}
