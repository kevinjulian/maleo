import { z } from "zod";
import { type CreativeDirection } from "./creative-direction.ts";
import {
	defaultReferenceUseForRole,
	REFERENCE_USES,
	ROLES,
	type ReferenceUse,
	type Role,
} from "./generation-cast.ts";
import { normalizeProjectSelection } from "./project-selection.ts";
import { keysOf } from "./object-keys.ts";

/* Project Materials: the operator-facing generation context for a project.
 *
 * This is one surface over inputs that were previously four unrelated shapes with
 * four different owners — `projectReferences` (the entity lock), `direction` (the
 * routed story/visual/voice channels), the generated style bible (a project
 * reference note written by the agent), and the preset bundle's style and
 * pacing blobs. Operators had to know which internal record held which knob
 * before they could steer a generation.
 *
 * Four groups, chosen to match what a person is actually deciding:
 *   - story  → narrative source and framing (notes, transcripts, claims, audience)
 *   - visual → assets and look (images, logos, brand look, image-prompt guidance)
 *   - voice  → narration and speech guidance (tone, pronunciation, voice style)
 *   - rules  → hard constraints every applicable stage must obey
 *
 * Groups are ROUTED, not concatenated: story generation never sees visual-only
 * instructions. `materialRoutingFor` is the single place that mapping is written.
 *
 * Provenance is NOT stored here. It lives in the existing element-source sidecar
 * keyed by `MATERIAL_ELEMENT_PATHS`, so materials reuse the same preset/operator
 * precedence machinery as every other seeded element rather than inventing a
 * second one. What IS stored per group is `materialId`: which reusable material
 * record supplied the body, which the sidecar's `defaulterId` cannot carry because
 * that names the PRESET a group was seeded from, not the material it resolved to.
 */

export const MATERIAL_GROUPS = ["story", "visual", "voice", "rules"] as const;

export type MaterialGroup = (typeof MATERIAL_GROUPS)[number];

/** Element-source sidecar paths, one per group. Materials carry one source per
 *  group rather than per field: a group is authored and seeded as a unit. */
export const MATERIAL_ELEMENT_PATHS = {
	story: "materials.story",
	visual: "materials.visual",
	voice: "materials.voice",
	rules: "materials.rules",
} as const satisfies Record<MaterialGroup, `materials.${MaterialGroup}`>;

export type MaterialElementPath = (typeof MATERIAL_ELEMENT_PATHS)[MaterialGroup];

export const VISUAL_REFERENCE_STATES = [
	"missing",
	"generated",
	"user-set",
	"preset-set",
	"locked",
] as const;
export type VisualReferenceState = (typeof VISUAL_REFERENCE_STATES)[number];

export const visualReferenceStateSchema = z.enum(VISUAL_REFERENCE_STATES);
export const referenceUseSchema = z.enum(REFERENCE_USES);

export const visualMaterialReferenceSchema = z
	.object({
		entityId: z.string().min(1),
		role: z.enum(ROLES).nullable().default(null),
		referenceUse: referenceUseSchema.nullable().default(null),
		selectionHint: z.string().trim().max(500).default(""),
		state: visualReferenceStateSchema.default("user-set"),
		locked: z.boolean().default(false),
	})
	.strict();

export type VisualMaterialReference = z.infer<typeof visualMaterialReferenceSchema>;

/** One group's value. `assetIds` are `reference_entity` ids; they are meaningful
 *  for every group (story evidence, visual refs, voice samples) even though the
 *  visual group is the one that attaches them to image providers. */
export const materialGroupValueSchema = z
	.object({
		body: z.string().trim().max(8000).default(""),
		assetIds: z.array(z.string().min(1)).default([]),
		referenceSettings: z.array(visualMaterialReferenceSchema).default([]),
		/** The reusable material record this body came from, when one supplied it.
		 *  Retained across project-local edits so the UI can offer "reset to source"
		 *  and "save back" without a second lookup. */
		materialId: z.string().min(1).nullable().default(null),
	})
	.strict();

type ParsedMaterialGroupValue = z.infer<typeof materialGroupValueSchema>;
export type MaterialGroupValue = Omit<ParsedMaterialGroupValue, "referenceSettings"> & {
	referenceSettings?: ParsedMaterialGroupValue["referenceSettings"];
};

export const EMPTY_MATERIAL_GROUP = {
	body: "",
	assetIds: [],
	referenceSettings: [],
	materialId: null,
} satisfies ParsedMaterialGroupValue;

/* The style bible is generated from Visual materials but is EDITABLE, so it needs a
 * lock: without one, the next regeneration silently discards a hand-written bible.
 * `locked` is set when a person edits the body and cleared only by an explicit
 * regenerate action, which is why it is stored rather than inferred from whether
 * the body differs from the last generated text — that comparison cannot tell a
 * deliberate re-type of the generated text from an untouched one. */
export const styleBibleMaterialSchema = z
	.object({
		body: z.string().trim().max(8000).default(""),
		locked: z.boolean().default(false),
	})
	.strict();

export type StyleBibleMaterial = z.infer<typeof styleBibleMaterialSchema>;

export const EMPTY_STYLE_BIBLE: StyleBibleMaterial = { body: "", locked: false };

export const projectMaterialsSchema = z
	.object({
		story: materialGroupValueSchema.default(EMPTY_MATERIAL_GROUP),
		visual: materialGroupValueSchema.default(EMPTY_MATERIAL_GROUP),
		voice: materialGroupValueSchema.default(EMPTY_MATERIAL_GROUP),
		rules: materialGroupValueSchema.default(EMPTY_MATERIAL_GROUP),
		/** Derived Visual material. Presented inside the Visual group, stored beside the
		 *  groups because its lock is its own and it is written by the agent, not the
		 *  operator's group edit. */
		styleBible: styleBibleMaterialSchema.default(EMPTY_STYLE_BIBLE),
	})
	.strict();

type ParsedProjectMaterials = z.infer<typeof projectMaterialsSchema>;
export type ProjectMaterials = Omit<ParsedProjectMaterials, MaterialGroup> &
	Record<MaterialGroup, MaterialGroupValue>;

export const EMPTY_PROJECT_MATERIALS = {
	story: EMPTY_MATERIAL_GROUP,
	visual: EMPTY_MATERIAL_GROUP,
	voice: EMPTY_MATERIAL_GROUP,
	rules: EMPTY_MATERIAL_GROUP,
	styleBible: EMPTY_STYLE_BIBLE,
} satisfies ParsedProjectMaterials;

/** True when a group carries nothing a prompt could use. */
export function isEmptyMaterialGroup(value: MaterialGroupValue | null | undefined): boolean {
	return (
		!value ||
		(!value.body.trim() &&
			value.assetIds.length === 0 &&
			(value.referenceSettings?.length ?? 0) === 0)
	);
}

/** True when no group carries content — stages can skip material layers entirely. */
export function isEmptyMaterials(materials: ProjectMaterials | null | undefined): boolean {
	if (!materials) return true;
	return (
		MATERIAL_GROUPS.every((group) => isEmptyMaterialGroup(materials[group])) &&
		!materials.styleBible.body.trim()
	);
}

/* Which groups each generation stage consumes.
 *
 * `rules` appears in every stage because a hard constraint that reaches only some
 * stages is not a constraint. `story` appears in visual and voice because a scene
 * image and a narration both need to know what the scene is ABOUT; the reverse is
 * deliberately absent, so image-prompt guidance cannot redirect research. */
const MATERIAL_ROUTING = {
	story: ["story", "rules"],
	visual: ["visual", "story", "rules"],
	voice: ["voice", "story", "rules"],
} as const satisfies Record<string, readonly MaterialGroup[]>;

export type GenerationStage = keyof typeof MATERIAL_ROUTING;

export const GENERATION_STAGES: GenerationStage[] = keysOf(MATERIAL_ROUTING);

/** The material groups a stage may read, in prompt-layer order. The order is part
 *  of the contract: prompt composition concatenates in exactly this sequence. */
export function materialRoutingFor(stage: GenerationStage): readonly MaterialGroup[] {
	return MATERIAL_ROUTING[stage];
}

/** The routed groups that actually carry content, in layer order. */
export function routedMaterials(
	materials: ProjectMaterials,
	stage: GenerationStage,
): ReadonlyArray<readonly [MaterialGroup, MaterialGroupValue]> {
	return materialRoutingFor(stage)
		.map((group) => [group, materials[group]] as const)
		.filter(([, value]) => !isEmptyMaterialGroup(value));
}

/** Reference-entity ids a stage may attach, deduplicated in routed-group order so
 *  the same input set always produces the same provider attachment order. */
export function routedAssetIds(materials: ProjectMaterials, stage: GenerationStage): string[] {
	const seen = new Set<string>();
	for (const [, value] of routedMaterials(materials, stage)) {
		for (const id of value.assetIds) seen.add(id);
	}
	return [...seen];
}

export function visualReferenceSettings(materials: ProjectMaterials): VisualMaterialReference[] {
	const byId = new Map(
		(materials.visual.referenceSettings ?? []).map((setting) => [setting.entityId, setting]),
	);
	return materials.visual.assetIds.map(
		(entityId) =>
			byId.get(entityId) ?? {
				entityId,
				role: null,
				referenceUse: null,
				selectionHint: "",
				state: "user-set",
				locked: false,
			},
	);
}

export function referenceUseForVisualMaterial(
	materials: ProjectMaterials,
	entityId: string,
	role?: Role | null,
): ReferenceUse {
	const setting = (materials.visual.referenceSettings ?? []).find(
		(ref) => ref.entityId === entityId,
	);
	if (setting?.referenceUse) return setting.referenceUse;
	const resolvedRole = setting?.role ?? role ?? null;
	return resolvedRole ? defaultReferenceUseForRole(resolvedRole) : "exact";
}

function normalizeHintText(value: string): string {
	return value
		.toLocaleLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function selectionHintTerms(selectionHint: string | null | undefined): string[] {
	const seen = new Set<string>();
	const terms: string[] = [];
	for (const raw of (selectionHint ?? "").split(/[,;\n]+/u)) {
		const term = normalizeHintText(raw);
		if (!term || seen.has(term)) continue;
		seen.add(term);
		terms.push(term);
	}
	return terms;
}

export interface SelectionHintMatch {
	entityId: string;
	role: Role | null;
	terms: string[];
}

export interface SelectionHintResolution {
	selectedIds: string[];
	matches: SelectionHintMatch[];
	ambiguous: SelectionHintMatch[];
}

export function resolveSelectionHints(
	settings: readonly VisualMaterialReference[],
	text: string,
	role?: Role | null,
): SelectionHintResolution {
	const haystack = ` ${normalizeHintText(text)} `;
	const matches = settings.flatMap((setting): SelectionHintMatch[] => {
		const resolvedRole = setting.role ?? null;
		if (role && resolvedRole !== role) return [];
		const terms = selectionHintTerms(setting.selectionHint).filter((term) =>
			haystack.includes(` ${term} `),
		);
		return terms.length > 0 ? [{ entityId: setting.entityId, role: resolvedRole, terms }] : [];
	});
	const byRole = new Map<Role | "unknown", SelectionHintMatch[]>();
	for (const match of matches) {
		const key = match.role ?? "unknown";
		byRole.set(key, [...(byRole.get(key) ?? []), match]);
	}
	const selectedIds: string[] = [];
	const ambiguous: SelectionHintMatch[] = [];
	for (const group of byRole.values()) {
		if (group.length === 1) selectedIds.push(group[0]!.entityId);
		else ambiguous.push(...group);
	}
	return { selectedIds, matches, ambiguous };
}

/** Read any persisted shape into materials. Unknown input normalises to empty
 *  rather than throwing: this runs on load for documents written before materials
 *  existed, and a parse failure there would make the project unopenable. */
export function normalizeProjectMaterials(raw: unknown): ProjectMaterials {
	const parsed = projectMaterialsSchema.safeParse(raw);
	return parsed.success ? parsed.data : EMPTY_PROJECT_MATERIALS;
}

/** Return materials with one group replaced. Callers record the operator source in
 *  the sidecar separately; this only owns the value. */
export function withMaterialGroup(
	materials: ProjectMaterials,
	group: MaterialGroup,
	value: MaterialGroupValue,
): ProjectMaterials {
	return { ...materials, [group]: value };
}

/* ---- Compatibility adapters ------------------------------------------------ */

/** Inputs a pre-materials project or preset can supply. Every field is optional
 *  because the three generations that wrote them shipped at different times. */
export interface LegacyMaterialSources {
	/** Routed creative direction (story/visual/voice channels plus raw). */
	direction?: CreativeDirection | null;
	/** `projectReferences` — the flat or four-bucket entity selection. Its `prompt`
	 *  is visual guidance, which is why it lands in the visual group. */
	projectReferences?: unknown;
	/** The persisted generated style bible text. */
	styleBible?: string | null;
}

/** Build materials from pre-materials fields.
 *
 *  Routing follows what each legacy field actually steered, not its name:
 *  `direction.visual` and `projectReferences.prompt` both fed image generation, so
 *  both become visual material. `direction.raw` is deliberately NOT folded in — it
 *  is the unrouted original, and concatenating it into a group would re-introduce
 *  the leak the channels exist to prevent. Rules start empty because no legacy
 *  field expressed a hard constraint. */
export function materialsFromLegacy(sources: LegacyMaterialSources): ProjectMaterials {
	const selection = normalizeProjectSelection(sources.projectReferences ?? {});
	const direction = sources.direction ?? null;

	const visualBody = joinBodies([direction?.visual ?? "", selection.prompt]);

	return {
		story: { ...EMPTY_MATERIAL_GROUP, body: (direction?.story ?? "").trim() },
		visual: { ...EMPTY_MATERIAL_GROUP, body: visualBody, assetIds: selection.entityIds },
		voice: { ...EMPTY_MATERIAL_GROUP, body: (direction?.voice ?? "").trim() },
		rules: EMPTY_MATERIAL_GROUP,
		styleBible: { body: (sources.styleBible ?? "").trim(), locked: false },
	};
}

/** Materials if the project has them, otherwise the legacy fields read as materials.
 *
 *  Presence is decided by CONTENT, not by whether the key exists: a project written
 *  after materials shipped but never edited carries an empty materials object beside
 *  populated legacy fields, and trusting the key would blank its guidance. */
export function resolveProjectMaterials(
	raw: unknown,
	legacy: LegacyMaterialSources,
): ProjectMaterials {
	const materials = normalizeProjectMaterials(raw);
	return isEmptyMaterials(materials) ? materialsFromLegacy(legacy) : materials;
}

/* Join material bodies, once each.
 *
 * The same guidance reaches generation through more than one compatibility
 * field — a preset stores its visual direction in `direction.visual` AND in
 * `projectReferences.prompt`, and the style bible is a Visual material that can
 * repeat the Visual body it was generated from. Concatenating them verbatim put
 * the identical paragraph in the provider prompt twice, which reads to a model
 * as emphasis rather than as duplication.
 *
 * Compared after trimming, so trailing-whitespace differences do not defeat it,
 * and case-insensitively, because the same sentence re-cased is the same
 * instruction. First occurrence wins, so the order the layers declare is kept. */
function joinBodies(parts: readonly string[]): string {
	const seen = new Set<string>();
	const kept: string[] = [];
	for (const part of parts) {
		const trimmed = part.trim();
		if (!trimmed) continue;
		const key = trimmed.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		kept.push(trimmed);
	}
	return kept.join("\n\n");
}

/* ---- Routing materials into the wire shape the stages read ---------------- */

/** Project Materials as routed creative-direction channels.
 *
 *  The stages consume `CreativeDirection`, and they should keep consuming exactly
 *  one shape: a second parallel path for materials would mean every stage had two
 *  places to look and one of them would eventually be forgotten. So materials are
 *  the AUTHORING model and direction is the WIRE model, and this is the single
 *  conversion between them.
 *
 *  `raw` is emptied deliberately. It exists to be split by the LLM router when the
 *  operator typed one blob; materials are already routed, so leaving text in `raw`
 *  would invite a second, contradictory split. */
export function directionFromMaterials(materials: ProjectMaterials): CreativeDirection {
	return {
		raw: "",
		story: materials.story.body.trim(),
		// The style bible is a derived Visual material, so it layers with the visual
		// group rather than travelling on a channel of its own.
		visual: joinBodies([materials.visual.body, materials.styleBible.body]),
		voice: materials.voice.body.trim(),
		rules: materials.rules.body.trim(),
	};
}

/** True when materials carry nothing any stage would read. */
export function hasRoutableMaterials(materials: ProjectMaterials): boolean {
	return !isEmptyMaterials(materials);
}

/* ---- Resolving editor mentions before a provider sees them ---------------- */

/** The minimum a reference must expose to be named in prompt text. */
export interface MentionableReference {
	id: string;
	label: string;
	description?: string;
}

export interface ResolvedMentions {
	/** The body with every known `@Label` replaced by the plain label. */
	text: string;
	/** Entity ids the text actually mentions, in first-appearance order. */
	entityIds: string[];
	/** `@tokens` naming nothing this project can resolve. */
	unresolved: string[];
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* Turn editor mention syntax into prose a provider can read.
 *
 * `@Sketch Stickman` is an editor affordance: it links a span of material text
 * to a reference entity, and the entity travels separately as an attached
 * reference image. The `@` never meant anything to an image model — it reached
 * the provider verbatim, so the prompt asked for a subject spelled with a stray
 * sigil while the reference map named the same subject properly beside it.
 *
 * Longest label first, so `@Sketch Stickman` is not consumed by a shorter
 * `@Sketch`. The label is kept rather than swapped for the description: the
 * reference map already carries the description, and substituting it here would
 * say the same thing twice in one prompt — the duplication this pass exists to
 * remove.
 *
 * Anything still carrying an `@` afterwards named a reference the project
 * cannot resolve. That is returned, not stripped: silently deleting it would
 * lose the operator's instruction, and it is the same failure the roster
 * preflight blocks on. */
export function resolveMaterialMentions(
	text: string,
	references: readonly MentionableReference[],
): ResolvedMentions {
	if (!text.trim()) return { text, entityIds: [], unresolved: [] };

	const byLength = [...references]
		.filter((ref) => (ref.label || "").trim())
		.sort((a, b) => b.label.trim().length - a.label.trim().length);

	const entityIds: string[] = [];
	let out = text;
	for (const ref of byLength) {
		const label = ref.label.trim();
		const pattern = new RegExp(
			`(^|[\\s([{"'])@${escapeRegExp(label)}(?=$|[\\s,).!?;:"'\\]}])`,
			"giu",
		);
		if (!pattern.test(out)) continue;
		if (!entityIds.includes(ref.id)) entityIds.push(ref.id);
		out = out.replace(pattern, `$1${label}`);
	}

	// What is left is a mention of something not in the resolvable set. Matched
	// on the same boundary rule the editor writes with, so an email address or a
	// mid-word `@` is not read as a mention.
	const unresolved: string[] = [];
	for (const match of out.matchAll(/(?:^|[\s([{"'])@([\p{L}\p{N}][\p{L}\p{N} _'-]*)/gu)) {
		const token = match[1]?.trim();
		if (token && !unresolved.includes(token)) unresolved.push(token);
	}

	return { text: out, entityIds, unresolved };
}
