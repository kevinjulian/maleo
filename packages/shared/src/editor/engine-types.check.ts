/* Compile-time agreement between generated Rust boundary fields and TS domain
 * payload refinements (`migrate-editor-to-shared-rust-core`, task 4.10).
 *
 * For every field the engine types, the domain field and the generated
 * one must each be assignable to the other, so neither side can drift alone.
 * A field the engine still carries as opaque JSON (`unknown`) is skipped: it has
 * nothing to compare until a port types it, and then it is checked here too.
 * Nested engine types are compared by their own assertion, so an opaque field
 * inside one cannot hide a typed one beside it.
 *
 * Nothing here runs; `bun run typecheck` is the check. */
import type * as Engine from "./engine-types.generated.ts";
import type { Clip, ClipType } from "../timeline-doc.ts";
import type { CaptionCue } from "../caption-cues.ts";
import type { EditorCommand } from "./commands.ts";
import type { EditorDoc, EditScope } from "./scope.ts";

type Agree<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Opaque<T> = unknown extends T
	? true
	: T extends readonly (infer Item)[]
		? unknown extends Item
			? true
			: false
		: false;
type TypedKeys<T, Skip extends keyof T> = Exclude<
	{ [K in keyof T]-?: Opaque<T[K]> extends true ? never : K }[keyof T],
	Skip
>;
/* Typed Rust fields remain intact when opaque payloads are refined. */
type Matches<Hand, Gen, Skip extends keyof Gen = never> =
	Exclude<TypedKeys<Gen, Skip>, keyof Hand> extends never
		? Agree<Pick<Hand, Extract<TypedKeys<Gen, Skip>, keyof Hand>>, Pick<Gen, TypedKeys<Gen, Skip>>>
		: false;
type Assert<T extends true> = T;
type Variant<K extends EditorCommand["type"]> = Extract<EditorCommand, { type: K }>;
type EngineVariant<K extends Engine.EditorCommand["type"]> = Extract<
	Engine.EditorCommand,
	{ type: K }
>;

export type EngineTypesAgree = [
	Assert<Matches<Variant<"caption.edit">, EngineVariant<"caption.edit">>>,
	Assert<Agree<ClipType, Engine.ClipType>>,
	Assert<Matches<CaptionCue, Engine.CaptionCue>>,
	Assert<Matches<Clip, Engine.Clip>>,
	Assert<Matches<EditorDoc, Engine.EditorDoc, "clips">>,
	Assert<Agree<EditorDoc["clips"], Engine.EditorDoc["clips"]>>,
	Assert<Matches<EditScope, Engine.EditScope, "doc">>,
	Assert<Matches<Variant<"clip.replace">, EngineVariant<"clip.replace">, "clip">>,
	Assert<Agree<Variant<"clip.replace">["clip"], EngineVariant<"clip.replace">["clip"]>>,
	Assert<Matches<Variant<"clip.move">, EngineVariant<"clip.move">>>,
	Assert<Matches<Variant<"clip.trim-before">, EngineVariant<"clip.trim-before">>>,
	Assert<Matches<Variant<"clip.trim-after">, EngineVariant<"clip.trim-after">>>,
	Assert<Matches<Variant<"noop">, EngineVariant<"noop">>>,
	Assert<Matches<Variant<"media.update">, EngineVariant<"media.update">>>,
	Assert<Matches<Variant<"media.admit">, EngineVariant<"media.admit">>>,
	Assert<Matches<Variant<"clip.insert">, EngineVariant<"clip.insert">, "clip">>,
	Assert<Agree<Variant<"clip.insert">["clip"], EngineVariant<"clip.insert">["clip"]>>,
	Assert<Matches<Variant<"clip.remove">, EngineVariant<"clip.remove">>>,
	Assert<Matches<Variant<"clip.update">, EngineVariant<"clip.update">>>,
	Assert<Matches<Variant<"clip.resize">, EngineVariant<"clip.resize">>>,
	/* `property` is a string on the wire and the registry union in TS; the engine
	 * refuses a name outside the registry when it validates the track. */
	Assert<Matches<Variant<"clip.setKeys">, EngineVariant<"clip.setKeys">, "property">>,
	Assert<Matches<Variant<"marker.upsert">, EngineVariant<"marker.upsert">>>,
	Assert<Matches<Variant<"marker.remove">, EngineVariant<"marker.remove">>>,
	Assert<Matches<Variant<"marker.update">, EngineVariant<"marker.update">>>,
	Assert<Matches<Variant<"bookmark.set">, EngineVariant<"bookmark.set">>>,
	Assert<Matches<Variant<"bookmark.upsert">, EngineVariant<"bookmark.upsert">>>,
	Assert<Matches<Variant<"bookmark.remove">, EngineVariant<"bookmark.remove">>>,
	Assert<Matches<Variant<"doc.setCaptions">, EngineVariant<"doc.setCaptions">>>,
	Assert<Matches<Variant<"doc.setProjectReferences">, EngineVariant<"doc.setProjectReferences">>>,
	Assert<Matches<Variant<"doc.setMaterials">, EngineVariant<"doc.setMaterials">>>,
	Assert<Matches<Variant<"doc.setTrackFlags">, EngineVariant<"doc.setTrackFlags">>>,
	Assert<Matches<Variant<"slide.insert">, EngineVariant<"slide.insert">>>,
	Assert<Matches<Variant<"slide.remove">, EngineVariant<"slide.remove">>>,
	Assert<Matches<Variant<"slide.update">, EngineVariant<"slide.update">>>,
	Assert<Matches<Variant<"post.insert">, EngineVariant<"post.insert">>>,
	Assert<Matches<Variant<"post.remove">, EngineVariant<"post.remove">>>,
	Assert<Matches<Variant<"post.update">, EngineVariant<"post.update">>>,
	/* `commands` is the command union itself, whose variants are each asserted
	 * above; the unions cannot agree as wholes because the engine carries some
	 * fields as opaque JSON. `scope` is the EditScope already asserted above. */
	Assert<Matches<Variant<"batch">, EngineVariant<"batch">, "commands">>,
	Assert<Matches<Variant<"scope.replace">, EngineVariant<"scope.replace">, "scope">>,
];

/* The check itself can fail: a field typed differently on each side, and a
 * typed engine field the domain type lacks, are both rejected. */
// @ts-expect-error a drifted field type does not agree
export type DriftedTypeIsRejected = Assert<Matches<{ startSec: string }, { startSec: number }>>;
// @ts-expect-error a field only the engine has does not agree
export type MissingFieldIsRejected = Assert<Matches<{ id: string }, { id: string; track: number }>>;
// An opaque engine field is skipped rather than compared.
export type OpaqueFieldIsSkipped = Assert<
	Matches<{ id: string; markers: { id: number }[] }, { id: string; markers: unknown[] }>
>;
