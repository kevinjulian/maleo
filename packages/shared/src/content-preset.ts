import { z } from "zod";
import { creativeDirectionSchema } from "./creative-direction.ts";
import { libraryFixtureFieldsSchema } from "./library-fixture.ts";
import { presetMaterialSelectionSchema } from "./material-record.ts";
import type { PacingDevices } from "./timeline-model.ts";
import { styleKnobsSchema } from "./video-style.ts";

/* Content presets, presented to operators as PROJECT PRESETS.
 *
 * The product contract is one line:
 *
 *     Project Preset = Project Materials + Video Template
 *
 * Everything else in this bundle is legacy surface area. The bundle used to be an
 * open-ended grab bag — style knobs, references, settings, pacing devices,
 * creative direction — which meant a preset overlapped with
 * materials, templates AND project settings, and no operator could say what
 * picking one would change. Those fields are retained as READ-ONLY compatibility:
 * rows written before materials existed still carry them, and `materials`/
 * `videoTemplateId` are derived from them on read when the new fields are unset.
 *
 * `refs` (RefsState) and `settings` (GlobalSettings) are owned by the dashboard
 * client and validated structurally, not by field, so this shared schema stays
 * decoupled from client-only shapes. */

/** global_settings key holding the id of the default content preset. */
export const CONTENT_PRESET_DEFAULT_KEY = "content.preset.default";

/* A style is knobs. A row still holding a pre-knobs identifier reads as NO
 * style — there is no conversion table left to rescue it, and substituting a
 * default would look deliberate. */
const readStyleSchema = styleKnobsSchema
	.nullish()
	.catch(null)
	.transform((value) => value ?? null);

/* One of the three snapshot blocks CAN be named here, and is.
 *
 * The comment above says `refs` and `settings` are owned by the dashboard client
 * — and they are: `GlobalSettings` lives in `apps/web`, so naming it would make
 * this package import from its own consumer. `PacingDevices` does NOT live
 * there. It is declared in
 * `./timeline-model.ts`, in THIS package, so leaving them open bought no
 * decoupling and cost every reader an assertion.
 *
 * Every field is `.optional()` because a bundle stores a snapshot, which may
 * predate a field, and the block is `.passthrough()` so a key added later
 * survives the round trip rather than being silently stripped.
 *
 * The `.catch()` is PER FIELD, and the outer `.catch({})` only catches a block
 * that is not an object at all. Guarding the whole object instead discards every
 * field on one bad value: a bundle holding one bad flag lost every good one
 * too, which reads as a preset that half-applied. That is the
 * same mistake `presetSettings` in `apps/web` made and its tests caught. This
 * schema runs at `content-presets.ts` on every preset read, so a bad field must
 * cost that field and nothing else. */
const pacingDevicesSnapshotSchema = z
	.object({
		chapterPills: z.boolean().optional().catch(undefined),
		progressBar: z.boolean().optional().catch(undefined),
		variant: z.enum(["pill", "minimal"]).optional().catch(undefined),
	} satisfies Record<keyof PacingDevices, z.ZodTypeAny>)
	.passthrough()
	.catch({});

/* Bundles saved before infographics were removed carry `infographicStyle`. The
 * bundle is strict, so the key is dropped before the parse, on read and on
 * write alike, and is never stored again. */
function dropInfographicStyle(value: unknown): unknown {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
	return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "infographicStyle"));
}

const contentPresetBundleObject = z
	.object({
		/* ---- The bundle, as operators see it -------------------------------- */

		/** Which reusable material this preset names per group. This plus
		 *  `videoTemplateId` IS the preset; the fields below are compatibility. */
		materials: presetMaterialSelectionSchema.default({}),
		/** The Video Template this preset selects, by identity. The preset does NOT
		 *  copy the template's fields: a preset that duplicated them would drift from
		 *  the template it was authored against and become a second, invisible editor
		 *  of render policy. Null means the preset selects no template. */
		videoTemplateId: z.string().min(1).nullable().default(null),

		/* ---- Compatibility: written by pre-materials builds, read-only now --- */

		/** Style knobs, or null when the preset seeds no style. */
		style: readStyleSchema.default(null),
		/** ProjectSelection snapshot ({prompt, entityIds}) — the project's generation
		 *  reference lock. Bundles saved before the flattening still carry the
		 *  four-bucket shape, so readers normalise rather than trust the shape. */
		projectRefs: z.record(z.unknown()).default({}),
		/** GlobalSettings snapshot — spans both the Style menu's creative fields
		 *  (brand, background, global style ref) and the Settings menu's mechanics
		 *  (aspect, providers, voice, language, render backend). */
		settings: z.record(z.unknown()).default({}),
		/** PacingDevices snapshot (retention overlays) — part of the Style menu. */
		pacingDevices: pacingDevicesSnapshotSchema.default({}),
		/** Creative direction (story/visual/voice) seeded into new projects. Optional
		 *  for back-compat with bundles saved before direction existed. */
		direction: creativeDirectionSchema.optional(),
	})
	.strict();

export const contentPresetBundleSchema = z.preprocess(
	dropInfographicStyle,
	contentPresetBundleObject,
);

/** Write shape: knobs only. A caller may not persist an identifier. */
export const contentPresetWriteBundleSchema = z.preprocess(
	dropInfographicStyle,
	contentPresetBundleObject.extend({
		style: styleKnobsSchema.nullish().default(null),
	}),
);

export const contentPresetInputSchema = z
	.object({
		name: z.string().trim().min(1).max(80),
		description: z.string().trim().max(240).default(""),
		bundle: contentPresetWriteBundleSchema,
	})
	.strict();

/** Read shape: tolerates a not-yet-backfilled identifier in `style`. */
export const contentPresetSchema = contentPresetInputSchema
	.extend({
		id: z.string().min(1),
		bundle: contentPresetBundleSchema,
		createdAt: z.number().int().nonnegative(),
		updatedAt: z.number().int().nonnegative(),
	})
	.extend(libraryFixtureFieldsSchema.shape);

export type ContentPresetBundle = z.infer<typeof contentPresetBundleSchema>;

/** Build a bundle from the fields a caller cares about, defaulting the rest.
 *
 *  Every bundle field carries a schema default, so a complete bundle is only ever
 *  one parse away — but the INFERRED type is the post-parse shape, where each is
 *  required. Without this, adding a field to the bundle breaks every literal that
 *  constructs one, which is how a compatibility field ends up being spelled out at
 *  a dozen call sites that do not care about it. */
export function presetBundle(partial: Partial<ContentPresetBundle> = {}): ContentPresetBundle {
	return contentPresetBundleSchema.parse(partial);
}

/** The Video Template a preset selects.
 *
 *  Pre-materials bundles expressed the selection as `settings.timelineTemplateId`,
 *  buried in an opaque client blob alongside aspect ratio and render backend. The
 *  explicit field wins when set; the settings blob is the fallback so presets
 *  authored before this ships keep selecting the template they always did. */
export function presetVideoTemplateId(bundle: ContentPresetBundle): string | null {
	if (bundle.videoTemplateId) return bundle.videoTemplateId;
	const legacy = bundle.settings?.timelineTemplateId;
	return typeof legacy === "string" && legacy ? legacy : null;
}

/** The legacy fields a preset can supply as materials, for `materialsFromLegacy`.
 *
 *  A preset names materials by id; those ids resolve against the material library,
 *  which this module cannot reach. What it CAN do is expose the inline legacy
 *  content, so a caller resolves ids first and falls back to this for bundles that
 *  name none. */
/** The two bundle fields the legacy material path still reads.
 *  `projectReferences` stays `unknown`: it is a pre-materials blob whose shape
 *  varied by preset version, and the caller narrows what it needs. */
export interface PresetLegacyMaterialSources {
	direction: ContentPresetBundle["direction"] | null;
	projectReferences: unknown;
}

export function presetLegacyMaterialSources(
	bundle: ContentPresetBundle,
): PresetLegacyMaterialSources {
	return { direction: bundle.direction ?? null, projectReferences: bundle.projectRefs };
}
export type ContentPresetInput = z.infer<typeof contentPresetInputSchema>;
export type ContentPreset = z.infer<typeof contentPresetSchema>;
