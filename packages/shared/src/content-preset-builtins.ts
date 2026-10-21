/* The Project Presets that ship with the product, as fixture DEFINITIONS.
 *
 * These used to be virtual: read out of this file and merged into every workspace's
 * preset list, never stored. That made them upgradeable — retuning one reached every
 * workspace at once — but it also meant a built-in did not look like it contained
 * anything when inspected, because its Materials were inlined here rather than being
 * Material records, and because nothing in the database corresponded to it.
 *
 * They are now bootstrapped into real rows, found and rewritten by immutable slug. The
 * upgradeability survives: the row is rewritten from these definitions on every boot,
 * and an operator edit is a DIFFERENT row, because editing a fixture forks it.
 *
 * Nothing here names an id. Ids are local to one database and assigned at bootstrap;
 * the slug is what stays the same everywhere.
 *
 * Each preset carries style knobs, the settings a style implies (aspect, language), a
 * creative direction, and the Materials it seeds. `projectRefs` stays empty: references
 * are workspace-owned data and cannot be shipped in code.
 */
import {
	ANIMATED_SYSTEMS_EXPLAINER_TEMPLATE_SLUG,
	DEFAULT_TIMELINE_TEMPLATE_SLUG,
} from "./timeline-template.ts";
import { presetBundle, type ContentPresetBundle } from "./content-preset.ts";
import { type StyleKnobs } from "./video-style.ts";
import { EMPTY_CREATIVE_DIRECTION, type CreativeDirection } from "./creative-direction.ts";
import { MATERIAL_GROUPS, type MaterialGroup } from "./project-materials.ts";

/* The knobs each shipped style carries. These are the builtins' OWN data now:
 * there is no registry to read them from, and no identifier that names them. */
const KNOBS: Record<string, StyleKnobs> = {
	"dark-documentary": {
		pacing: "medium",
		avgSceneDurationSec: 4,
		cameraIntensity: 0.5,
		transitionIntensity: 0.3,
		textDensity: 0.4,
		sfxDensity: 0.5,
		musicMood: "minimal",
		musicDescription: "dark, tense, cinematic drone",
		voiceSpeed: 0.92,
		colorMood: "low contrast, warm shadows, desaturated",
	},
	"history-short": {
		pacing: "medium",
		avgSceneDurationSec: 5,
		cameraIntensity: 0.45,
		transitionIntensity: 0.35,
		textDensity: 0.5,
		sfxDensity: 0.4,
		musicMood: "luxury",
		musicDescription: "epic orchestral, solemn strings",
		voiceSpeed: 0.95,
		colorMood: "warm sepia, aged film grain",
	},
	"news-explainer": {
		pacing: "medium",
		avgSceneDurationSec: 3.5,
		cameraIntensity: 0.4,
		transitionIntensity: 0.5,
		textDensity: 0.8,
		sfxDensity: 0.3,
		musicMood: "chill",
		musicDescription: "neutral underscore, light percussion",
		voiceSpeed: 1.0,
		colorMood: "clean, bright, high clarity",
	},
	"finance-drama": {
		pacing: "medium",
		avgSceneDurationSec: 4,
		cameraIntensity: 0.6,
		transitionIntensity: 0.5,
		textDensity: 0.7,
		sfxDensity: 0.6,
		musicMood: "energetic",
		musicDescription: "tense rising synth, ticking pulse",
		voiceSpeed: 1.0,
		colorMood: "cool blue, sharp contrast",
	},
	"high-energy-challenge": {
		pacing: "fast",
		avgSceneDurationSec: 2,
		cameraIntensity: 0.9,
		transitionIntensity: 0.9,
		textDensity: 0.9,
		sfxDensity: 0.9,
		musicMood: "energetic",
		musicDescription: "high-energy, hype, driving beat",
		voiceSpeed: 1.08,
		colorMood: "punchy saturation, high contrast",
	},
	"editorial-map-explainer": {
		pacing: "medium",
		avgSceneDurationSec: 3.5,
		cameraIntensity: 0.4,
		transitionIntensity: 0.5,
		textDensity: 0.85,
		sfxDensity: 0.3,
		musicMood: "upbeat",
		musicDescription: "curious, light indie underscore",
		voiceSpeed: 1.0,
		colorMood: "editorial, balanced, slightly warm",
	},
	"bright-systems-animation": {
		pacing: "medium",
		avgSceneDurationSec: 4,
		cameraIntensity: 0.35,
		transitionIntensity: 0.4,
		textDensity: 0.6,
		sfxDensity: 0.5,
		musicMood: "upbeat",
		musicDescription: "playful, hopeful, electronic",
		voiceSpeed: 1.0,
		colorMood: "vivid flat color, bright palette",
	},
	"animated-explainer-essay": {
		pacing: "medium",
		avgSceneDurationSec: 4,
		cameraIntensity: 0.4,
		transitionIntensity: 0.45,
		textDensity: 0.78,
		sfxDensity: 0.35,
		musicMood: "upbeat",
		musicDescription: "curious, playful, warm light percussion",
		voiceSpeed: 1.05,
		colorMood: "warm editorial flat illustration, clean contrast, paper-cutout texture",
		// Was reachable only by an id comparison in video-blueprint.ts; now data,
		// so any preset can adopt the motif.
		transitionSystem: {
			motif: "paper timeline thread",
			plates: [
				{
					id: "thread",
					reusable: true,
					prompt: "flat editorial timeline thread on warm paper, empty center label area",
				},
			],
		},
	},
	"animated-systems-explainer": {
		pacing: "medium",
		avgSceneDurationSec: 4,
		cameraIntensity: 0.45,
		transitionIntensity: 0.55,
		textDensity: 0.7,
		sfxDensity: 0.35,
		musicMood: "upbeat",
		musicDescription: "curious, light percussion, clear explanatory momentum",
		voiceSpeed: 1.02,
		colorMood: "bright editorial contrast, clean flat shapes, focused diagram colors",
		transitionSystem: {
			motif: "systems map path",
			plates: [
				{
					id: "map-path",
					reusable: true,
					prompt:
						"flat editorial systems map path with empty label areas and clean directional arrows",
				},
			],
		},
	},
	"cinematic-story": {
		pacing: "slow",
		avgSceneDurationSec: 6,
		cameraIntensity: 0.55,
		transitionIntensity: 0.25,
		textDensity: 0.25,
		sfxDensity: 0.5,
		musicMood: "luxury",
		musicDescription: "emotional cinematic score, swelling strings",
		voiceSpeed: 0.9,
		colorMood: "teal-orange, filmic, soft highlights",
	},
};

interface BuiltinSpec {
	name: string;
	description: string;
	/** Aspect ratio the style is composed for. */
	aspectRatio: string;
	/** Narration language hint ("" = provider default). */
	language: string;
	/** Video Template fixture this Project Preset selects, by slug. */
	videoTemplateSlug?: string;
	direction: Partial<CreativeDirection>;
	materials?: Partial<Record<MaterialGroup, string>>;
}

// Only the axes a style genuinely implies. Voice and provider stay empty: those
// are workspace/account choices, and guessing them would override a real setting.
const SPECS: Record<string, BuiltinSpec> = {
	"dark-documentary": {
		name: "Dark Documentary",
		description: "Slow, ominous, cinematic. Heavy mood, sparse text.",
		aspectRatio: "9:16",
		language: "",
		direction: {
			story:
				"Open on the unsettling detail, withhold the explanation, and let the weight land before resolving.",
			visual: "Long lenses, heavy negative space, faces half in shadow. Restraint over spectacle.",
			voice: "Low, measured, unhurried. Let silences do work.",
		},
	},
	"history-short": {
		name: "History Short",
		description: "Epic narration over slow reveals and archival texture.",
		aspectRatio: "9:16",
		language: "",
		direction: {
			story:
				"Anchor each beat to a date or a place. Move chronologically unless a reveal earns a jump.",
			visual: "Archival texture, aged paper, period-accurate detail. Slow reveals over cuts.",
			voice: "Solemn and authoritative, with room between clauses.",
		},
	},
	"news-explainer": {
		name: "News Explainer",
		description: "Clear, brisk, information-dense. Lots of stats and labels.",
		aspectRatio: "9:16",
		language: "",
		direction: {
			story:
				"Lead with what changed, then why it matters, then what happens next. No burying the point.",
			visual: "Clean framing, legible labels, charts that read at a glance on a phone.",
			voice: "Brisk and neutral. Inform, do not editorialise.",
		},
	},
	"finance-drama": {
		name: "Finance Drama",
		description: "Tense, building, money-on-the-line energy.",
		aspectRatio: "9:16",
		language: "",
		direction: {
			story: "Frame every beat as stakes rising. Name the number, then what it costs.",
			visual: "Cool palette, sharp contrast, tickers and figures as compositional elements.",
			voice: "Tense and building, tightening toward the turn.",
		},
	},
	"high-energy-challenge": {
		name: "High-Energy Challenge",
		description: "Maximal energy: fast cuts, huge text, constant SFX.",
		aspectRatio: "9:16",
		language: "",
		direction: {
			story: "Hook in the first two seconds, escalate every beat, never let the stakes plateau.",
			visual:
				"Saturated, high contrast, huge on-screen text. Faces and reactions front and centre.",
			voice: "Loud, fast, constantly building.",
		},
	},
	"editorial-map-explainer": {
		name: "Editorial Map Explainer",
		description: "Smart, structured, maps and annotations over clean visuals.",
		aspectRatio: "16:9",
		language: "",
		direction: {
			story: "Pose the question the viewer already half-asked, then answer it with structure.",
			visual: "Maps, annotations, and overlays on clean footage. Every graphic earns its place.",
			voice: "Curious and precise, explaining rather than performing.",
		},
	},
	"bright-systems-animation": {
		name: "Bright Systems Animation",
		description: "Bright, playful, flat-illustration optimism with smooth motion.",
		aspectRatio: "16:9",
		language: "",
		direction: {
			story:
				"Build from one simple premise to a surprising implication, staying optimistic throughout.",
			visual: "Flat vector illustration, bright saturated palette, smooth continuous motion.",
			voice: "Warm, clear, faintly wry.",
		},
	},
	"animated-explainer-essay": {
		name: "Animated Explainer Essay",
		description:
			"Question-led educational essay with flat illustrations, fact cards, diagrams, and soft humor.",
		aspectRatio: "16:9",
		language: "",
		direction: {
			story:
				"Lead each section with a question, answer it with a claim plus evidence, then hand off to the next.",
			visual:
				"Warm paper texture, flat cutout illustration, fact cards and diagrams over photography.",
			voice: "Conversational and lightly humorous, never lecturing.",
		},
	},
	"animated-systems-explainer": {
		name: "Animated Systems Explainer",
		description:
			"Question-led animated explainer with diagrams, metaphors, and clear system reveals.",
		aspectRatio: "16:9",
		language: "",
		videoTemplateSlug: ANIMATED_SYSTEMS_EXPLAINER_TEMPLATE_SLUG,
		direction: {
			story:
				"Open with one concrete question, map the pieces the viewer needs, build each piece with evidence, reveal the system turn, then leave one simple mental model.",
			visual:
				"Flat editorial animation with symbolic characters, diagrams, maps, flows, scales, timelines, and object metaphors. Every visual should explain, compare, locate, count, transform, or reveal.",
			voice:
				"Calm, precise, and curious. Use short sentences for hard ideas, with small breaths at section turns.",
		},
		materials: {
			story:
				"Use a systems-explainer structure: question -> map -> build pieces -> surprising turn -> simple mental model -> consequence. Keep each section anchored to one concrete viewer question.",
			visual:
				"Use flat editorial animation, simplified objects, symbolic characters, charts as scene objects, maps, flows, scales, timelines, and object metaphors. Every visual must carry explanation, not decoration.",
			voice:
				"Narration is calm, precise, and curious. Use short sentences for hard ideas. Add brief breaths at section turns and keep the tone explanatory rather than hype-driven.",
			rules:
				"Do not imitate a specific creator or channel identity. Do not request protected characters, exact artwork, or copied scripts. Each scene must reveal, compare, locate, count, transform, or explain.",
		},
	},
	"cinematic-story": {
		name: "Cinematic Story",
		description: "Slow, emotional, film-grade framing and long holds.",
		aspectRatio: "16:9",
		language: "",
		direction: {
			story: "Follow one character or one object. Hold on moments longer than feels comfortable.",
			visual: "Filmic grade, shallow depth, deliberate composition. Few cuts, long holds.",
			voice: "Quiet and emotional, close to the microphone.",
		},
	},
};

/* ── Fixture definitions ────────────────────────────────────────────────────
 *
 * Derived from KNOBS and SPECS above rather than restated, so the values a fixture
 * ships with are the same values the virtual built-ins served, by construction. A
 * second hand-written copy would be free to drift, and drift here would report every
 * existing project as diverged from the preset it was created from. */

/** The material body a preset supplies for a group, or null when it supplies none.
 *
 *  The direction fallback is the rule the virtual path used: a preset with no explicit
 *  material text for story/visual/voice seeded its creative direction instead. Keeping
 *  it means the fixture Materials carry exactly the text operators were already
 *  getting. */
function specMaterialBody(spec: BuiltinSpec, group: MaterialGroup): string | null {
	const explicit = spec.materials?.[group];
	const fallback =
		group === "story"
			? spec.direction.story
			: group === "visual"
				? spec.direction.visual
				: group === "voice"
					? spec.direction.voice
					: undefined;
	const body = (explicit ?? fallback ?? "").trim();
	return body || null;
}

const GROUP_LABELS = {
	story: "Story",
	visual: "Visual",
	voice: "Voice",
	rules: "Rules",
} satisfies Record<MaterialGroup, string>;

export interface MaterialFixture {
	slug: string;
	group: MaterialGroup;
	name: string;
	description: string;
	body: string;
}

export interface PresetFixture {
	slug: string;
	name: string;
	description: string;
	/** Video Template fixture selected by this preset, by slug. */
	videoTemplateSlug: string;
	/** Material fixtures this preset names per group, by slug. */
	materialSlugs: Partial<Record<MaterialGroup, string>>;
	/** Everything about the bundle that does NOT depend on local ids. Bootstrap fills
	 *  in `materials` and `videoTemplateId` once the slugs above resolve. */
	bundle: ContentPresetBundle;
}

function presetFixture(slug: string): PresetFixture {
	const knobs = KNOBS[slug];
	const spec = SPECS[slug];
	if (!knobs || !spec) throw new Error(`fixture preset ${slug} is missing knobs or spec`);
	const materialSlugs: Partial<Record<MaterialGroup, string>> = {};
	for (const group of MATERIAL_GROUPS) {
		if (specMaterialBody(spec, group)) materialSlugs[group] = `${slug}-${group}`;
	}
	return {
		slug,
		name: spec.name,
		description: spec.description,
		videoTemplateSlug: spec.videoTemplateSlug ?? DEFAULT_TIMELINE_TEMPLATE_SLUG,
		materialSlugs,
		bundle: presetBundle({
			style: knobs,
			settings: { aspectRatio: spec.aspectRatio, language: spec.language },
			direction: { ...EMPTY_CREATIVE_DIRECTION, ...spec.direction },
		}),
	};
}

/** The shipped presets, in picker order. The array order IS the authored order that
 *  bootstrap stores as `fixture_rank`. */
export const PRESET_FIXTURES: readonly PresetFixture[] = Object.keys(SPECS).map(presetFixture);

/** The shipped Materials, one per preset group that supplies a body. */
export const MATERIAL_FIXTURES: readonly MaterialFixture[] = Object.entries(SPECS).flatMap(
	([slug, spec]) =>
		MATERIAL_GROUPS.flatMap((group) => {
			const body = specMaterialBody(spec, group);
			if (!body) return [];
			return [
				{
					slug: `${slug}-${group}`,
					group,
					name: `${spec.name} — ${GROUP_LABELS[group]}`,
					description: `${GROUP_LABELS[group]} material shipped with the ${spec.name} preset.`,
					body,
				},
			];
		}),
);

export function findPresetFixture(slug: string): PresetFixture | null {
	return PRESET_FIXTURES.find((fixture) => fixture.slug === slug) ?? null;
}

/* The identity virtual built-ins were referenced by, before they were rows.
 *
 * Default pointers, active-preset references and provenance recorded inside project
 * blobs still hold these. They are resolved through this alias rather than rewritten:
 * the pointers are few and are migrated for real, but provenance lives inside every
 * project's editor state, and rewriting those blobs would mean touching every project
 * to change a string that can just as well be translated on read. */
export const LEGACY_BUILTIN_PRESET_PREFIX = "builtin:";

/** Old shipped fixture slugs translated during upgrade. Keep only as migration data. */
export const LEGACY_FIXTURE_SLUG_RENAMES = {
	mrbeast: "high-energy-challenge",
	vox: "editorial-map-explainer",
	kurzgesagt: "bright-systems-animation",
} as const;

/** The fixture slug a legacy `builtin:` id refers to, or null when it names something
 *  that never shipped. */
export function fixtureSlugForLegacyBuiltinId(id: string): string | null {
	if (!id.startsWith(LEGACY_BUILTIN_PRESET_PREFIX)) return null;
	const raw = id.slice(LEGACY_BUILTIN_PRESET_PREFIX.length);
	// SAFETY: unknown keys yield undefined and deliberately fall back to raw.
	const slug = LEGACY_FIXTURE_SLUG_RENAMES[raw as keyof typeof LEGACY_FIXTURE_SLUG_RENAMES] ?? raw;
	return findPresetFixture(slug) ? slug : null;
}
