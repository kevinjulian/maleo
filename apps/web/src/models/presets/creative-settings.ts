/* The editor's global settings shape, its default, and the pure fold of a
 * document's persisted presentation back over it. Types and pure functions
 * only: the panel that edits them lives in ui/editor-settings.tsx. */
import { z } from "zod";
import type { RenderPresentation, TtsProviderId } from "@maleo/shared";

export interface GlobalSettings {
	aspectRatio: string;
	/** Selected workspace-global timeline template id ("" = default template). */
	timelineTemplateId: string;
	/** Reference image id whose look is applied to every generation ("" = none). */
	globalStyleRefId: string;
	/** A registered TTS provider's id; "" follows the app-wide default. */
	voiceProvider: TtsProviderId;
	/** "" = provider's default voice. */
	voice: string;
	/** BCP-47-ish language hint for narration TTS ("" = provider default). */
	language: string;
	/** Brand kit ("" = off): accent drives the render palette, font drives
	 *  captions (unless user-overridden), logo renders as a pinned watermark. */
	brandAccent: string;
	brandFont: string;
	brandLogoUrl: string;
	/** CSS color or gradient used as the Remotion storyboard background. */
	backgroundFill: string;
	/** Render backend: "" = server default, "local" = in-process worker,
	 *  "lambda" = Remotion Lambda (needs the deployed function + serve url). */
	renderBackend: "" | "local" | "lambda";
}

/** Fold a document's persisted presentation back over the editor's settings, so a
 *  restored version opens with the aspect and brand it rendered with. */
export function settingsWithPresentation(
	settings: GlobalSettings,
	presentation: RenderPresentation | null,
): GlobalSettings {
	if (!presentation) return settings;
	return {
		...settings,
		aspectRatio: presentation.aspectRatio ?? settings.aspectRatio,
		brandAccent: presentation.brand?.accentColor ?? settings.brandAccent,
		brandFont: presentation.brand?.fontFamily ?? settings.brandFont,
		brandLogoUrl: presentation.brand?.logoUrl ?? settings.brandLogoUrl,
		backgroundFill: presentation.backgroundFill ?? settings.backgroundFill,
	};
}

export const DEFAULT_BACKGROUND_FILL = "#0B0B0F";
export const DEFAULT_SETTINGS: GlobalSettings = {
	aspectRatio: "9:16",
	timelineTemplateId: "",
	globalStyleRefId: "",
	voiceProvider: "",
	voice: "",
	language: "",
	brandAccent: "",
	brandFont: "",
	brandLogoUrl: "",
	backgroundFill: DEFAULT_BACKGROUND_FILL,
	renderBackend: "",
};

/* A stored preset bundle's `settings` block, parsed into this app's type.
 *
 * `contentPresetBundleSchema` in `@maleo/shared` types this field
 * `z.record(z.unknown())` on purpose: `GlobalSettings` is declared HERE, so
 * naming it there would make that package import from its own consumer. The
 * openness is right; what was wrong is that every reader then asserted
 * `bundle.settings as Partial<GlobalSettings>` — six times across three files —
 * which claims the shape without checking it.
 *
 * The parse belongs on this side, where the domain type lives. It follows the
 * pattern already used at `parse-loaded-project.ts` for `creativeDirectionSchema`
 * and `styleKnobsSchema`: a shared-owned schema, `safeParse`, and a fallback.
 *
 * Every field is optional and `.catch()`-guarded, because a bundle is a SNAPSHOT
 * — it may predate a field, or carry one written by a build that disagreed about
 * its type. A block that fails wholesale must not make a preset unapplyable, so
 * an unreadable field is dropped rather than throwing. `.passthrough()` keeps a
 * key added by a later build instead of silently stripping it on the next save.
 *
 * The `.catch()` is PER FIELD, not on the object. A whole-object guard fails the
 * entire parse on one bad value, so a bundle with a numeric `aspectRatio` would
 * have lost its `voice` too — which the tests caught. */
const optionalStr = z.string().optional().catch(undefined);

const globalSettingsSnapshotSchema = z
	.object({
		aspectRatio: optionalStr,
		timelineTemplateId: optionalStr,
		globalStyleRefId: optionalStr,
		/* Any string, checked against the registry at use rather than here. It was
		 * an enum over two provider names, so a document stored before a provider
		 * was retired failed to parse and lost every other setting with it. An id
		 * naming nothing registered now falls back to the effective provider. */
		voiceProvider: optionalStr,
		voice: optionalStr,
		language: optionalStr,
		brandAccent: optionalStr,
		brandFont: optionalStr,
		brandLogoUrl: optionalStr,
		backgroundFill: optionalStr,
		renderBackend: z.enum(["", "local", "lambda"]).optional().catch(undefined),
	} satisfies Record<keyof GlobalSettings, z.ZodTypeAny>)
	.passthrough();

/** The `settings` block of a preset bundle, as this app's settings. */
export function presetSettings(raw: unknown): Partial<GlobalSettings> {
	const parsed = globalSettingsSnapshotSchema.safeParse(raw);
	return parsed.success ? parsed.data : {};
}
