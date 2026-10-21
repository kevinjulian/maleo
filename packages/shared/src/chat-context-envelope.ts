/* The context envelope — everything one project chat command is allowed to read,
 * captured once before planning begins.
 *
 * Before this, a chat request was a dozen loose fields assembled at the call site,
 * which meant every caller could assemble a slightly different project and no run
 * could explain what it had actually seen. One typed envelope replaces them: the
 * client builds it from live editor state, the API validates it and freezes it on
 * the run, and the trace reports it. A run reads the envelope or it reads nothing.
 *
 * Two properties matter more than the field list.
 *
 * IDENTITY IS STABLE, NEVER POSITIONAL. Every entity referenced here is named by
 * an id that survives generation, reordering, and reload. Fencing compares those
 * ids, so a positional id ("the second slide") would make a reorder during a run
 * silently apply a result to the wrong entity — worse than no fencing, because it
 * looks like it worked.
 *
 * DETAIL IS BOUNDED, ACCESS IS NOT. Every run gets compact indexes of the whole
 * project plus full records for what it is actually working on. That keeps prompt
 * size tied to the task rather than to project size, with no embeddings and no
 * retrieval service. */
import { z } from "zod";
import { conversationMemorySchema } from "./conversation-memory.ts";
import { creativeDirectionSchema } from "./creative-direction.ts";
import { projectMaterialsSchema } from "./project-materials.ts";
import { styleKnobsSchema } from "./video-style.ts";

/* What kind of thing an id names.
 *
 * `clip` covers every timeline clip type — the clip id already encodes its source
 * (`scene:3`, `audio:7`), so splitting the kind here would duplicate that and let
 * the two disagree. `project` is the whole-project fallback and carries no id. */
export const CHAT_ENTITY_KINDS = [
	"project",
	"section",
	"beat",
	"scene",
	"clip",
	"slide",
	"post",
	"material",
	"reference",
	"asset",
] as const;
export type ChatEntityKind = (typeof CHAT_ENTITY_KINDS)[number];

/* A pointer to one project entity.
 *
 * Ids are strings even where the underlying model counts in numbers, because a
 * single comparable form across scenes, clips, slides, materials, and references
 * is what makes fencing one code path instead of six. */
export const chatEntityRefSchema = z.object({
	kind: z.enum(CHAT_ENTITY_KINDS),
	id: z.string().min(1),
});
export type ChatEntityRef = z.infer<typeof chatEntityRefSchema>;

/** The whole-project scope. Its id is fixed so a ref is always comparable. */
export const WHOLE_PROJECT_REF: ChatEntityRef = { kind: "project", id: "project" };

/* An entity as the envelope captured it: what it is, plus a hash of its canonical
 * record at capture time.
 *
 * The hash is what makes a conflict detectable without storing a second copy of
 * the document. At apply time the entity is re-hashed and compared: equal means
 * untouched, different means someone edited it while the run was working. An
 * entity edited and reverted hashes equal and correctly does not conflict, which
 * a revision counter would get wrong. */
export const entityFingerprintSchema = chatEntityRefSchema.extend({
	hash: z.string().min(1),
	sourceClipIds: z.array(z.string().min(1)).optional(),
});
export type EntityFingerprint = z.infer<typeof entityFingerprintSchema>;

/* One line in a compact index: enough to know the entity exists, what it is, and
 * whether it is the one being talked about. Not enough to render it.
 *
 * `label` is what a human would call it. `summary` is a short description where
 * one is cheap — never the full record, which is what `detail` is for. */
export const chatIndexEntrySchema = chatEntityRefSchema.extend({
	label: z.string(),
	summary: z.string().optional(),
	startSec: z.number().optional(),
	durationSec: z.number().optional(),
});
export type ChatIndexEntry = z.infer<typeof chatIndexEntrySchema>;

/* The whole project, compactly.
 *
 * Present on every run regardless of focus. A command scoped to one clip still
 * needs to know the project has eleven others and what they are, or it cannot
 * reason about pacing, continuity, or whether its edit belongs. */
export const chatProjectIndexSchema = z.object({
	story: z.array(chatIndexEntrySchema),
	timeline: z.array(chatIndexEntrySchema),
	materials: z.array(chatIndexEntrySchema),
	references: z.array(chatIndexEntrySchema),
	assets: z.array(chatIndexEntrySchema),
});
export type ChatProjectIndex = z.infer<typeof chatProjectIndexSchema>;

export const EMPTY_CHAT_PROJECT_INDEX: ChatProjectIndex = {
	story: [],
	timeline: [],
	materials: [],
	references: [],
	assets: [],
};

/* Where the focus came from.
 *
 * Recorded rather than inferred because the precedence rule is only testable if
 * the winning source is visible in the output. It is also what a context chip
 * displays, and what removing that chip removes. */
export const CHAT_FOCUS_SOURCES = ["mention", "selection", "playhead", "named", "project"] as const;
export type ChatFocusSource = (typeof CHAT_FOCUS_SOURCES)[number];

/* What the command is about.
 *
 * `entities` may hold several targets: explicitly naming three clips is one
 * command over three entities, not three commands, and collapsing that to one
 * target would silently narrow what the user asked for. */
export const resolvedChatFocusSchema = z.object({
	source: z.enum(CHAT_FOCUS_SOURCES),
	entities: z.array(chatEntityRefSchema),
});
export type ResolvedChatFocus = z.infer<typeof resolvedChatFocusSchema>;

export const WHOLE_PROJECT_FOCUS: ResolvedChatFocus = {
	source: "project",
	entities: [WHOLE_PROJECT_REF],
};

/* A question the run is parked on, carried so a new command knows the
 * conversation is mid-decision rather than idle. */
export const chatPendingActionSchema = z.object({
	actionId: z.string(),
	kind: z.enum(["approval", "clarification"]),
	question: z.string(),
});
export type ChatPendingAction = z.infer<typeof chatPendingActionSchema>;

/* The prompt inputs a command runs under.
 *
 * These used to be loose top-level request fields — brief here, direction there,
 * a `context` bag with twelve more. Every caller could assemble a slightly
 * different set and nothing validated the combination, so what a run had been
 * told was only discoverable by reading the call site that sent it.
 *
 * They live in the envelope because they are context in exactly the sense the
 * envelope exists for: things the run is governed by rather than things it
 * edits. The document itself — scenes, clips, slides, posts — stays outside, in
 * the request proper. That split is deliberate: the envelope describes what the
 * run was told, the request carries what it works on, and folding the second
 * into the first would be nesting rather than structure. */
export const chatCommandInputsSchema = z.object({
	brief: z.string().optional(),
	aspect: z.string().optional(),
	/** Resolved server-side from the project's own entities; a client-supplied
	 *  URL is never trusted as a fetch target. */
	styleImageUrl: z.string().optional(),
	referenceIds: z.array(z.string()).default([]),
	direction: creativeDirectionSchema.optional(),
	materials: projectMaterialsSchema.optional(),
	audience: z.string().optional(),
	targetDurationSec: z.number().optional(),
	slideCount: z.number().optional(),
	platform: z.string().optional(),
	thread: z.boolean().optional(),
	voiceProvider: z.string().optional(),
	voice: z.string().optional(),
	language: z.string().optional(),
	style: z.string().optional(),
	styleKnobs: styleKnobsSchema.optional(),
	styleName: z.string().optional(),
	timelineTemplateId: z.string().optional(),
});
export type ChatCommandInputs = z.infer<typeof chatCommandInputsSchema>;

export const EMPTY_CHAT_COMMAND_INPUTS: ChatCommandInputs = { referenceIds: [] };

/* The envelope.
 *
 * `capturedAt` and `documentHash` are advisory: they make a trace readable and
 * let two envelopes be compared at a glance. No correctness depends on them —
 * fencing works entirely from per-entity fingerprints, because a document-wide
 * value would report a conflict for every unrelated edit. */
export const chatContextEnvelopeSchema = z.object({
	projectId: z.string().min(1),
	capturedAt: z.number(),
	documentHash: z.string().optional(),
	index: chatProjectIndexSchema,
	/** Full records for the resolved focus and the neighbours it needs. Opaque
	 *  here: their shape belongs to the content type, not to the envelope. */
	detail: z.array(z.unknown()).default([]),
	fingerprints: z.array(entityFingerprintSchema).default([]),
	focus: resolvedChatFocusSchema,
	memory: conversationMemorySchema,
	inputs: chatCommandInputsSchema.default({ referenceIds: [] }),
	pendingAction: chatPendingActionSchema.optional(),
});
export type ChatContextEnvelope = z.infer<typeof chatContextEnvelopeSchema>;

/* What a settled result claims it changed.
 *
 * A result declares its touched ids and nothing else is written. The declaration
 * is load-bearing: application takes values from the result only for these ids
 * and copies every other entity from current state, so an entity the model
 * rewrote without declaring keeps the user's version. */
export const touchedResultScopeSchema = z.object({
	touched: z.array(chatEntityRefSchema),
	fingerprints: z.array(entityFingerprintSchema).default([]),
});
export type TouchedResultScope = z.infer<typeof touchedResultScopeSchema>;

/** Stable key for a ref, for map lookups and set membership. */
export function entityKey(ref: ChatEntityRef): string {
	return `${ref.kind}:${ref.id}`;
}

/** True when both refs name the same entity. */
export function sameEntity(a: ChatEntityRef, b: ChatEntityRef): boolean {
	return a.kind === b.kind && a.id === b.id;
}
