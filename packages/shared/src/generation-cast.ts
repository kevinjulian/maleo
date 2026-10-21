/* Generation cast selection — resolve a scene's cast (entity ids) against a
 * project roster into two ALIGNED outputs built in one ordered pass:
 *   - refImages:        ordered array attached to the image provider
 *   - referenceMapText: index-keyed prompt block ("Image N = <id> …")
 *
 * The single correctness invariant: refImages[i] and reference-map line i
 * describe the same entity. Both derive from one ordered list so a file can
 * never bind to the wrong subject. Never build the array and the map from two
 * separate iterations. */

/** The scene-role axis for a reference entity. This is the ONLY role vocabulary —
 *  the DB constrains `reference_entity.role` to these values and every consumer
 *  resolves through `roleOf`. Do not add an asset-type value here (note, audio,
 *  research, image, video): conflating the two axes in one field is what forced
 *  five divergent filter/fallback implementations. */
export const ROLES = ["style", "character", "location", "product", "prop"] as const;
export type Role = (typeof ROLES)[number];

const ROLE_SET: ReadonlySet<string> = new Set(ROLES);
const LEGACY_ROLE_ALIASES = { environment: "style" } as const satisfies Record<string, Role>;

/** Narrowing guard for the role axis. */
export function isRole(value: unknown): value is Role {
	return typeof value === "string" && ROLE_SET.has(value);
}

/** The single role resolver. Returns null when the input carries no role on the
 *  role axis, so callers decide explicitly rather than inheriting someone else's
 *  fallback — the UI previously defaulted unknown to "style" while the backend
 *  defaulted it to "character", so one reference rendered as Style and bound as
 *  Character. Never reintroduce a silent default here. */
export function roleOf(value: unknown): Role | null {
	if (isRole(value)) return value;
	if (value === "environment") return LEGACY_ROLE_ALIASES.environment;
	return null;
}

export const REFERENCE_USES = ["exact", "style", "inspiration", "direct_place"] as const;
export type ReferenceUse = (typeof REFERENCE_USES)[number];

const REFERENCE_USE_SET: ReadonlySet<string> = new Set(REFERENCE_USES);

export function isReferenceUse(value: unknown): value is ReferenceUse {
	return typeof value === "string" && REFERENCE_USE_SET.has(value);
}

export function defaultReferenceUseForRole(role: Role): ReferenceUse {
	switch (role) {
		case "style":
		case "location":
			return "style";
		case "product":
		case "prop":
			return "direct_place";
		case "character":
			return "exact";
	}
}

export function requiresGeneratedReferenceApproval(role: Role): boolean {
	return role === "character" || role === "location";
}

export function canGenerateReferenceForRole(role: Role): boolean {
	return role !== "product";
}

export interface CastEntity {
	/** Stable entity id — the value scenes reference in their `cast` list. */
	id: string;
	role: Role;
	imageUrl: string;
	/** Human label ("Stickman"). Used to name the subject in the reference map
	 *  when no description is written — better than falling back to the raw id. */
	label?: string;
	/** Short text description surfaced in the reference map. */
	description: string;
	/** Marks the lead entity; inherited into scenes with an empty cast (roster ≥2). */
	primary?: boolean;
}

/** Roles whose images can blend/mis-assign (people, products) — capped per scene.
 *  `prop` is deliberately excluded: a prop carries no identity that can blend. */
export const SUBJECT_ROLES = ["character", "product"] as const;
export type SubjectRole = (typeof SUBJECT_ROLES)[number];

const SUBJECT_ROLE_SET: ReadonlySet<string> = new Set(SUBJECT_ROLES);

/** The three things cast defaulting asks about an entity. A full `CastEntity`
 *  satisfies it; a caller that holds only the roster's identity does not have to
 *  invent an image url and a description to be heard. */
export interface CastSlot {
	id: string;
	role: Role;
	primary?: boolean;
}

/** Default cap on subject entities attached to a single scene. */
export const DEFAULT_CAST_SUBJECT_CAP = 3;

/** Cap on TOTAL references attached to one scene — the image worker's maximum.
 *  Distinct concept from DEFAULT_CAST_SUBJECT_CAP (which counts only subjects);
 *  both are needed, but neither should be redeclared at a call site. */
export const MAX_REFERENCE_IMAGES = 4;

/** True when a role is a bindable subject (person/product) that counts toward the
 *  per-scene subject cap. Environment/style/prop refs do not blend identities and
 *  are not capped. */
export function isSubjectRole(role: string): boolean {
	return SUBJECT_ROLE_SET.has(role);
}

function isSubject(role: string): boolean {
	return SUBJECT_ROLE_SET.has(role);
}

/** Apply roster-size defaulting to a scene's declared cast:
 *  - roster 0        → [] (text-only)
 *  - roster 1        → the single entity, always (auto-cast)
 *  - roster ≥2       → declared ids validated against the roster (unknown dropped);
 *                      if none remain, the primary entity backfills (else []).
 *  Order-preserving and de-duplicated. */
/** What casting actually reads off a roster entry: an id and whether it leads.
 *  NOT the role — `selectCast` has never looked at one, and typing the parameter
 *  as `CastSlot` made every caller fabricate a `role` to satisfy a field this
 *  function ignores. `resolveSceneRoster` was asserting an unchecked string into
 *  `Role` for exactly that reason, which is the silent default `roleOf` above
 *  forbids. `CastSlot` is unchanged for the callers that do read a role. */
export interface CastCandidate {
	id: string;
	primary?: boolean;
}

export function selectCast(
	declared: readonly string[],
	roster: readonly CastCandidate[],
): string[] {
	if (roster.length === 0) return [];
	if (roster.length === 1) return [roster[0]!.id];

	const byId = new Map(roster.map((e) => [e.id, e]));
	const seen = new Set<string>();
	const valid: string[] = [];
	for (const id of declared) {
		if (byId.has(id) && !seen.has(id)) {
			seen.add(id);
			valid.push(id);
		}
	}
	if (valid.length > 0) return valid;
	const primary = roster.find((e) => e.primary);
	return primary ? [primary.id] : [];
}

/** Keep only the declared ids present in the roster, de-duplicated and
 *  order-preserving. Used to sanitize a planner-emitted cast before it reaches a
 *  scene — hallucinated ids are dropped without the auto-cast/backfill behavior of
 *  `selectCast`. */
export function filterKnownCastIds(
	declared: readonly string[],
	roster: readonly { id: string }[],
): string[] {
	const known = new Set(roster.map((e) => e.id));
	const seen = new Set<string>();
	const out: string[] = [];
	for (const id of declared) {
		if (known.has(id) && !seen.has(id)) {
			seen.add(id);
			out.push(id);
		}
	}
	return out;
}

/** Apply the per-scene subject cap to an ordered cast, in one pass.
 *
 *  Subject entities beyond the cap are dropped, primary-last. Non-subject entities
 *  (location, style, prop) are never capped and — critically — a full subject
 *  quota does NOT stop them being considered: this `continue`s past an over-cap
 *  subject rather than breaking, so a trailing location ref still survives.
 *  The old duplicate in `resolveRefImages` used `break` on total length and could
 *  silently drop the location. */
export function capCastSubjects<T extends { role: string; primary?: boolean }>(
	entities: readonly T[],
	opts?: { subjectCap?: number },
): T[] {
	const cap = opts?.subjectCap ?? DEFAULT_CAST_SUBJECT_CAP;
	const out: T[] = [];
	let subjectCount = 0;
	for (const entity of entities) {
		if (isSubject(entity.role)) {
			if (subjectCount >= cap && !entity.primary) continue;
			subjectCount += 1;
		}
		out.push(entity);
	}
	return out;
}

/** Minimal shape needed to render a reference-map line — satisfied by CastEntity
 *  and by the render path's resolved refs (entity id + role + label). */
export interface ReferenceMapEntry {
	id: string;
	role: string;
	description: string;
}

/** A reference image resolved for a scene, as consumed by the render paths. The
 *  identity fields are optional so a bare style ref still type-checks. */
export interface ResolvedReferenceImage {
	url: string;
	role: string;
	entityId?: string;
	label?: string;
	/** The entity's written description. Preferred over `label` in the reference
	 *  map: a description ("a tall man in a grey coat") binds an image to a subject
	 *  far better than a bare name ("Anna"), and the spec requires the map to name
	 *  each image's description. */
	description?: string;
	/** The project's lead subject — kept when the subject cap trims. */
	primary?: boolean;
	/** How strongly generation should follow this reference. */
	referenceUse?: ReferenceUse;
}

/** Order refs for subject binding: subject refs lead, the global style ref trails.
 *  This ONE ordered array feeds both the provider and the reference map, so the
 *  map's "Image N" always names the ref at provider position N. Urlless refs are
 *  dropped; the list is capped (default 4, the image worker's max). */
export function orderRefsForBinding<T extends ResolvedReferenceImage>(
	refs: readonly T[],
	max = MAX_REFERENCE_IMAGES,
): T[] {
	const usable = refs.filter((r) => r.url);
	return [
		...usable.filter((r) => r.role !== "style"),
		...usable.filter((r) => r.role === "style"),
	].slice(0, max);
}

/** Build the reference map from an already subject-first ordered ref list. Style
 *  refs are excluded (a global style image binds a look, not an indexed subject);
 *  because style trails, excluding it does not shift subject indices. */
export function referenceMapForRefs(orderedRefs: readonly ResolvedReferenceImage[]): string {
	const subjects = orderedRefs.filter((r) => r.role !== "style");
	if (!subjects.length) return "";
	return buildReferenceMap(
		subjects.map((r) => ({
			id: r.entityId ?? r.role,
			role: r.role,
			// Description first, label as fallback: entities carry a real description
			// now, and it is the stronger binding signal.
			description: r.description?.trim() || r.label || r.entityId || r.role,
		})),
	);
}

/** Build the index-keyed reference map from the final ordered entity list.
 *  Index i here is index i in the refImages array by construction. */
export function buildReferenceMap(ordered: readonly ReferenceMapEntry[]): string {
	if (ordered.length === 0) return "";
	const lines = ordered.map((e, i) => {
		const desc = e.description.trim() || e.id;
		return `Image ${i + 1} = ${e.id}: ${desc}. Use ONLY for ${e.id}.`;
	});
	const subjectCount = ordered.filter((e) => isSubject(e.role)).length;
	const antiBlend = subjectCount >= 2 ? "\nDo not blend or swap identities across subjects." : "";
	return `── REFERENCE IMAGES (bind each image to its subject) ──\n${lines.join("\n")}${antiBlend}`;
}
