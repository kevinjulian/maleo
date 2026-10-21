/* The reference entity as it crosses the wire.
 *
 * The API used to answer with database rows: routes returned what the query
 * returned, so `is_primary: number`, `tags_json: string` and `canonical_image_url`
 * became the client's vocabulary, and the web re-declared those columns by hand.
 * A column rename then fanned out through three packages, and the client carried
 * JSON-parsing for a field the server had already parsed once.
 *
 * This is the shape both sides agree on instead: a domain object, with the
 * booleans as booleans and the tags as an array. The server maps its rows into it
 * (`apps/api/src/lib/wire/reference-entity.ts`); the client consumes it. */
import type { Role } from "./generation-cast.ts";

/** How an entity's image came to exist. */
export type ReferenceEntityOrigin = "generated" | "linked";

export interface ReferenceEntityWire {
	id: string;
	/** The cast-axis role. Constrained at write time, so it does not need a
	 *  fallback here. */
	role: Role;
	label: string;
	/** Free text describing the subject; drives the prompt's reference map. */
	description: string;
	/** The entity's canonical image, absent when its portrait never generated. */
	imageUrl: string | null;
	tags: string[];
	/** The project's lead subject. One per project. */
	primary: boolean;
	origin: ReferenceEntityOrigin;
}

/** A project note as it crosses the wire: text guidance an operator attaches to
 *  the project or a scene. Not a reference entity — it carries no image and
 *  cannot be cast into a frame. */
export interface ProjectNoteWire {
	id: string;
	label: string;
	body: string;
	tags: string[];
	/** Applied to every scene rather than one. */
	isDefault: boolean;
}

/** A voice identity. Also not a reference entity: a speaker is audio. */
export interface ProjectSpeakerWire {
	/** The voice this speaker uses. It is also the speaker's identity in the
	 *  editor, which is why the row's `voice_key` used to be read twice. */
	voiceKey: string;
	name: string;
	hue: number | null;
	/** Available on every scene without being cast. */
	isDefault: boolean;
}
