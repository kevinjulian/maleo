/* The shapes that cross between the API and the web.
 *
 * These were declared twice — once in the web's HTTP client and once on the
 * server, structurally identical and free to drift — or, worse, typed as
 * `Record<string, unknown>` on the server while the client had a real interface.
 * One declaration means a change to a payload is a compile error on the side that
 * has not caught up rather than a runtime surprise.
 *
 * Field names here are the wire's, which today still mirror the database's
 * columns in places (`brief_json`, `is_default`, `voice_key`). Turning those into
 * domain shapes is a separate step; see `ReferenceEntityWire` for the pattern
 * they are moving towards. */
import type { StyleKnobs } from "./video-style.ts";

/** The project brief, stored as `brief_json`. */
export interface ContentProjectBrief {
	goal?: string | null;
	workspace_profile?: string | null;
	image_reference_notes?: string | null;
	audio_reference_notes?: string | null;
	/** Style knobs snapshotted from the content preset at project creation.
	 *  A string here is a pre-knobs identifier that the backfill has not yet
	 *  converted; readers report it as unresolved rather than trusting it. */
	style_preset?: StyleKnobs | string | null;
	/** Name + description of the preset the knobs came from. */
	style_preset_name?: string | null;
	style_preset_description?: string | null;
}

/** A voice identity as the create-project request sends it. A speaker carries no
 *  image and cannot be cast into a frame — it is not a reference entity. */
export interface SpeakerPayload {
	voice_key: string;
	name: string;
	hue: number | null;
	is_default: boolean;
}

/* A TTS provider's registry id.
 *
 * Was a closed union over a literal array, and the array was the problem. Every
 * surface that rendered a provider switched on those two members, so the set of
 * TTS providers was restated in the wire types, in three arrays in the web app,
 * and in a per-provider boolean on the status payload — and adding one meant
 * editing all of them. The registry is the only list; a stored id that names no
 * registered provider resolves to the default rather than failing validation. */
export type TtsProviderId = string;

export interface TtsVoiceOption {
	id: string;
	name: string;
	desc: string;
	/** Upper-cased BCP-47-ish tag. Pickers group by it, which is what makes a
	 *  provider offering dozens of voices navigable. */
	lang?: string;
	gender?: "male" | "female";
	/** The colour this voice is drawn with, derived server-side by one rule so a
	 *  voice looks the same on every surface. The API has always sent it; the type
	 *  did not carry it, so a surface reading this shape had to invent its own. */
	hue?: number;
	/** Public url of this voice's prebaked audition clip, or null when it has not
	 *  been baked. Null is the normal state for an environment that never ran the
	 *  bake, and every picker reads it as "no play control" rather than an error.
	 *
	 *  For a cloned voice this is the recording it was created from: the bake runs
	 *  ahead of time over the voices declared in the repository and cannot contain
	 *  a voice created after it. */
	sampleUrl?: string | null;
	/** True when this voice is a clone belonging to the calling workspace rather
	 *  than a speaker the provider declares. A surface may label it and may offer
	 *  to remove it; nothing branches on it to decide whether the voice is usable,
	 *  because a clone is selected and synthesized exactly like any other voice. */
	cloned?: boolean;
}

/** One registered TTS provider, as a surface offering a choice renders it. */
export interface TtsProviderOption {
	id: TtsProviderId;
	label: string;
	health: "ready" | "unconfigured" | "down";
	voices: TtsVoiceOption[];
	/** True when this provider speaks cloned voices rather than declared ones, so
	 *  a surface knows where offering to create one is meaningful. Its `voices`
	 *  being empty is then the ordinary state, not a provider with nothing to
	 *  speak with. */
	clones?: boolean;
}

/** TTS readiness and the provider choice, shaped like the image provider's
 *  status: a derived list, never a field named after a particular provider. */
export interface TtsStatus {
	/** Every registered TTS provider, in display order. */
	providers: TtsProviderOption[];
	/** The stored app-wide choice, or null when nothing is selected. */
	selected_provider: TtsProviderId | null;
	/** The provider that would actually run, or null when none can. */
	effective_provider: TtsProviderId | null;
	/** Why nothing can run, when `effective_provider` is null. */
	selection_error: string | null;
	source: "global" | "env" | "default";
	ready: boolean;
	/** The effective provider's voices — empty when none is configured, because a
	 *  list of choices that cannot be synthesized is worse than no list. */
	voices: TtsVoiceOption[];
}

/** A persisted product record offered as a `product`-role entity. */
export interface CatalogueProduct {
	id: string;
	label: string;
	kind: "product";
	src: string;
	note: string;
	price: number | null;
	url: string;
	seed: number;
	category_path?: string | null;
}

/** A workspace-library image in the catalogue response. */
export interface CatalogueImage {
	id: string;
	label: string;
	tags: string[];
	kind: string;
	note: string;
	seed: number;
	default: boolean;
	src: string;
	workspace: string;
	collection: string;
	item_id: string;
}

export interface ProductCataloguePage {
	items: CatalogueProduct[];
	total: number;
	limit: number;
	offset: number;
	has_more: boolean;
	next_offset: number | null;
}

export interface ProductCategoryEntry {
	category: string;
	count: number;
}
