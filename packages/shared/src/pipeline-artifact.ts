/* Pipeline artifacts — what one stage hands the next.
 *
 * A stage used to reach the next one by mutating the run in place, so nothing
 * could say what a stage needed, whether an input came from this run, or what it
 * actually consumed. An artifact is the explicit handoff: a common envelope
 * (identity, provenance, content hash) around a payload that each kind validates
 * with its own schema.
 *
 * Two things are deliberately separate:
 *  - structural validity (Zod: the envelope and the kind's payload parse), and
 *  - readiness (the kind's predicate: a downstream stage may consume it now).
 * A generation batch that parses but is still running is valid and not ready.
 *
 * `contentHash` is provenance — proof of which exact content a consumer read —
 * never a cache key. See the change's design for why reuse keys stay where they
 * are (per-asset input hashes in `asset-staleness.ts`). */
import { z } from "zod";
import { stableInputHash } from "./asset-staleness.ts";
import { stableStringify } from "./entity-fingerprint.ts";

const opaqueId = z.string().min(1);

/** Points at one exact artifact content. The hash is what makes a later revision
 *  of the same id distinguishable from the content that was actually read. */
export const artifactRefSchema = z.object({
	id: opaqueId,
	kind: opaqueId,
	schemaVersion: z.number().int().min(1),
	contentHash: opaqueId,
});
export type ArtifactRef = z.infer<typeof artifactRefSchema>;

export const artifactStatusSchema = z.enum(["in_progress", "complete", "failed"]);
export type ArtifactStatus = z.infer<typeof artifactStatusSchema>;

/* Who produced an artifact. Stages and tools run inside a run and carry its id;
 * the operator editing in the editor is outside any run and has none. Putting the
 * run id on the producer rather than the envelope means it cannot be missing where
 * it applies or invented where it does not. */
export const artifactProducerSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("stage"), stage: opaqueId, runId: opaqueId }),
	z.object({ type: z.literal("tool"), tool: opaqueId, runId: opaqueId }),
	z.object({ type: z.literal("editor") }),
]);
export type ArtifactProducer = z.infer<typeof artifactProducerSchema>;

/** The envelope every kind shares. `payload` is checked by the kind, not here. */
export const artifactEnvelopeSchema = z.object({
	id: opaqueId,
	kind: opaqueId,
	schemaVersion: z.number().int().min(1),
	status: artifactStatusSchema,
	producer: artifactProducerSchema,
	projectId: opaqueId,
	/** Revision of this artifact id, starting at 1. */
	revision: z.number().int().min(1),
	inputRefs: z.array(artifactRefSchema),
	/** The external context the producing stage declared, each fingerprinted when
	 *  the stage began — so whether an artifact was made against context that has
	 *  since changed can be answered after the fact. Absent outside a stage. */
	context: z.array(z.object({ key: opaqueId, hash: opaqueId })).optional(),
	contentHash: opaqueId,
	createdAt: z.string().datetime(),
	payload: z.unknown(),
});

export type ArtifactContextSnapshot = NonNullable<ArtifactEnvelope["context"]>;
export type ArtifactEnvelope = z.infer<typeof artifactEnvelopeSchema>;

/** A validated artifact of one kind. */
export interface PipelineArtifact<TPayload = unknown> extends Omit<ArtifactEnvelope, "payload"> {
	payload: TPayload;
}

export function artifactContentHash(kind: string, schemaVersion: number, payload: unknown): string {
	return stableInputHash(["pipeline-artifact-v1", kind, schemaVersion, stableStringify(payload)]);
}

export function artifactRefOf(
	artifact: Pick<PipelineArtifact, "id" | "kind" | "schemaVersion" | "contentHash">,
): ArtifactRef {
	return {
		id: artifact.id,
		kind: artifact.kind,
		schemaVersion: artifact.schemaVersion,
		contentHash: artifact.contentHash,
	};
}

/* ── Kinds ─────────────────────────────────────────────────────────────────── */

export interface ArtifactKind<TPayload = unknown> {
	kind: string;
	schemaVersion: number;
	payload: z.ZodType<TPayload, z.ZodTypeDef, unknown>;
	/** One per artifact list: a new write replaces the existing one (and advances
	 *  its revision) rather than appending. */
	singleton?: boolean;
	/** Whether a downstream stage may consume this artifact now. Method syntax on
	 *  purpose: it lets kinds with different payloads share one registry. */
	isReady(artifact: PipelineArtifact<NoInfer<TPayload>>): boolean;
}

export function defineArtifactKind<TPayload>(kind: ArtifactKind<TPayload>): ArtifactKind<TPayload> {
	return kind;
}

export class ArtifactKindRegistrationError extends Error {}

export interface ArtifactKindRegistry {
	get(kind: string): ArtifactKind | undefined;
	readonly kinds: readonly string[];
}

/** One entry per kind. Adding a kind adds an entry; no existing kind changes. */
export function createArtifactKindRegistry(
	kinds: ReadonlyArray<ArtifactKind>,
): ArtifactKindRegistry {
	const byKind = new Map<string, ArtifactKind>();
	for (const kind of kinds) {
		if (byKind.has(kind.kind))
			throw new ArtifactKindRegistrationError(
				`artifact kind ${kind.kind} registered more than once`,
			);
		byKind.set(kind.kind, kind);
	}
	return { get: (kind) => byKind.get(kind), kinds: [...byKind.keys()] };
}

export type ArtifactParseResult =
	| { ok: true; artifact: PipelineArtifact }
	| {
			ok: false;
			reason: "envelope" | "unknown_kind" | "schema_version" | "payload" | "content_hash";
			message: string;
	  };

/** Validate an envelope and its payload against the kind it names. Rejects before
 *  anything persists or runs downstream. */
export function parseArtifact(registry: ArtifactKindRegistry, value: unknown): ArtifactParseResult {
	const envelope = artifactEnvelopeSchema.safeParse(value);
	if (!envelope.success) return { ok: false, reason: "envelope", message: envelope.error.message };
	const kind = registry.get(envelope.data.kind);
	if (!kind)
		return {
			ok: false,
			reason: "unknown_kind",
			message: `unknown artifact kind ${envelope.data.kind}`,
		};
	if (envelope.data.schemaVersion !== kind.schemaVersion) {
		return {
			ok: false,
			reason: "schema_version",
			message: `${kind.kind} is at schema version ${kind.schemaVersion}, artifact has ${envelope.data.schemaVersion}`,
		};
	}
	const payload = kind.payload.safeParse(envelope.data.payload);
	if (!payload.success)
		return {
			ok: false,
			reason: "payload",
			message: `${kind.kind} payload: ${payload.error.message}`,
		};
	if (
		artifactContentHash(kind.kind, kind.schemaVersion, payload.data) !== envelope.data.contentHash
	) {
		return {
			ok: false,
			reason: "content_hash",
			message: `${kind.kind} ${envelope.data.id}: content hash does not match its payload`,
		};
	}
	return { ok: true, artifact: { ...envelope.data, payload: payload.data } };
}

export function isArtifactReady(
	registry: ArtifactKindRegistry,
	artifact: PipelineArtifact,
): boolean {
	const kind = registry.get(artifact.kind);
	return Boolean(kind && artifact.status !== "failed" && kind.isReady(artifact));
}

/* ── Writing ───────────────────────────────────────────────────────────────── */

export class ArtifactWriteError extends Error {}

export interface ArtifactWrite {
	kind: string;
	payload: unknown;
	producer: ArtifactProducer;
	projectId: string;
	/** Rewrite this artifact. Without it, a singleton kind rewrites its existing
	 *  artifact and any other kind appends a new one. */
	id?: string;
	status?: ArtifactStatus;
	inputRefs?: ArtifactRef[];
	context?: ArtifactContextSnapshot;
}

export interface ArtifactWriteResult {
	artifacts: PipelineArtifact[];
	artifact: PipelineArtifact;
}

export interface ArtifactWriteDeps {
	now?: () => string;
	newId?: () => string;
}

/* The one way an artifact enters or changes in a list. It validates the payload
 * against its kind, sets the next revision, and computes the content hash, so no
 * write can leave an artifact whose hash disagrees with its payload. Returns a new
 * list; the input is not mutated. */
export function writeArtifact(
	registry: ArtifactKindRegistry,
	artifacts: readonly PipelineArtifact[],
	write: ArtifactWrite,
	deps: ArtifactWriteDeps = {},
): ArtifactWriteResult {
	const kind = registry.get(write.kind);
	if (!kind) throw new ArtifactWriteError(`unknown artifact kind ${write.kind}`);
	const payload = kind.payload.safeParse(write.payload);
	if (!payload.success)
		throw new ArtifactWriteError(`${write.kind} payload: ${payload.error.message}`);
	const producer = artifactProducerSchema.safeParse(write.producer);
	if (!producer.success)
		throw new ArtifactWriteError(`${write.kind} producer: ${producer.error.message}`);
	const index =
		write.id !== undefined
			? artifacts.findIndex((artifact) => artifact.id === write.id)
			: kind.singleton
				? artifacts.findIndex((artifact) => artifact.kind === write.kind)
				: -1;
	const previous = index >= 0 ? artifacts[index] : undefined;
	if (previous && previous.kind !== write.kind)
		throw new ArtifactWriteError(`artifact ${previous.id} is ${previous.kind}, not ${write.kind}`);
	const artifact: PipelineArtifact = {
		id: previous?.id ?? write.id ?? (deps.newId ?? (() => crypto.randomUUID()))(),
		kind: kind.kind,
		schemaVersion: kind.schemaVersion,
		status: write.status ?? "complete",
		producer: producer.data,
		projectId: write.projectId,
		revision: (previous?.revision ?? 0) + 1,
		inputRefs: write.inputRefs ?? [],
		...(write.context ? { context: write.context } : {}),
		contentHash: artifactContentHash(kind.kind, kind.schemaVersion, payload.data),
		createdAt: (deps.now ?? (() => new Date().toISOString()))(),
		/* A copy: the caller keeps working with its own objects, and a later in-place
		 * change to them must not alter the stored payload under its hash. */
		payload: structuredClone(payload.data),
	};
	const next =
		index >= 0
			? artifacts.map((existing, i) => (i === index ? artifact : existing))
			: [...artifacts, artifact];
	return { artifacts: next, artifact };
}

/** The artifacts of one kind, narrowed to that kind's payload. */
export function artifactsOfKind<TPayload>(
	artifacts: readonly PipelineArtifact[],
	kind: ArtifactKind<TPayload>,
): Array<PipelineArtifact<TPayload>> {
	return artifacts.filter(
		(artifact): artifact is PipelineArtifact<TPayload> => artifact.kind === kind.kind,
	);
}

/** One artifact's payload if it is of this kind, else undefined. */
export function payloadOfKind<TPayload>(
	artifact: PipelineArtifact | undefined,
	kind: ArtifactKind<TPayload>,
): TPayload | undefined {
	// SAFETY: an artifact's payload was validated against its kind's schema when it
	// was written or parsed, so a matching kind means the payload is `TPayload`.
	return artifact?.kind === kind.kind
		? (artifact as PipelineArtifact<TPayload>).payload
		: undefined;
}

/* ── Resolving references ──────────────────────────────────────────────────── */

export type ArtifactResolveResult =
	| { ok: true; artifact: PipelineArtifact }
	| { ok: false; reason: "missing" | "kind" | "stale"; message: string };

/** Resolve a reference against whatever currently holds that id. A reference whose
 *  hash no longer matches is refused: the artifact gained a revision since the
 *  reference was taken, and silently reading the new content would lie about
 *  what was consumed. */
export function resolveArtifactRef(
	ref: ArtifactRef,
	lookup: (id: string) => PipelineArtifact | undefined,
): ArtifactResolveResult {
	const artifact = lookup(ref.id);
	if (!artifact) return { ok: false, reason: "missing", message: `artifact ${ref.id} not found` };
	if (artifact.kind !== ref.kind || artifact.schemaVersion !== ref.schemaVersion) {
		return {
			ok: false,
			reason: "kind",
			message: `artifact ${ref.id} is ${artifact.kind}@${artifact.schemaVersion}, reference expects ${ref.kind}@${ref.schemaVersion}`,
		};
	}
	if (artifact.contentHash !== ref.contentHash) {
		return {
			ok: false,
			reason: "stale",
			message: `artifact ${ref.id} changed since it was referenced (revision ${artifact.revision})`,
		};
	}
	return { ok: true, artifact };
}

/* ── Stage results ─────────────────────────────────────────────────────────── */

export interface StageFailure {
	code: string;
	message: string;
	retryable: boolean;
}

/* A stage's outcome as data. Each variant forbids the others' fields, so a
 * completed result cannot smuggle an error and a failed one cannot carry outputs
 * — which is exactly what the `"error:"` note prefix allowed. */
export type StageResult =
	| { status: "completed"; outputs: PipelineArtifact[]; draft?: never; error?: never }
	| { status: "awaiting_approval"; draft: PipelineArtifact; outputs?: never; error?: never }
	| { status: "failed"; error: StageFailure; outputs?: never; draft?: never };
