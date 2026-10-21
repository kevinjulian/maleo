/* Compiling the context a run is allowed to read.
 *
 * The client sends what only the client knows — what is selected, where the
 * playhead is, what the live document looks like before autosave catches up, and
 * what the user has decided in this conversation. The server owns everything
 * else, and it does not take the client's word for any of it.
 *
 * That split is the whole design. Editor focus cannot be recovered server-side,
 * so it is accepted.
 *
 * Whatever survives compilation is frozen onto the run. A run reads the context
 * it started with, not the project as it drifts underneath it, which is what
 * makes a result explainable after the fact.
 *
 * Lookups are injected rather than imported so the rules here can be tested
 * without a database. The route supplies the real ones. */
import {
	chatContextEnvelopeSchema,
	conversationDecisionSchema,
	memoryTurnSchema,
	unresolvedQuestionSchema,
	EMPTY_CONVERSATION_MEMORY,
	EMPTY_CHAT_PROJECT_INDEX,
	EMPTY_CHAT_COMMAND_INPUTS,
	WHOLE_PROJECT_FOCUS,
	buildChatProjectIndex,
	entityKey,
	type ChatContextEnvelope,
	type ChatCommandInputs,
	type ConversationMemory,
} from "@maleo/shared";

export interface TrustedChatProjectContext {
	materials: NonNullable<ChatCommandInputs["materials"]>;
	referenceIds: string[];
	references: Array<{ id: string; label: string; imageUrl?: string }>;
}

export interface CompileChatContextInput {
	projectId: string;
	/** `body.envelope` exactly as it arrived. Untrusted. */
	raw: unknown;
	/** Now, injected so a test can pin `capturedAt`. */
	now?: number;
	/* Does this run id belong to this project?
	 *
	 * Memory entries carry provenance back to the run that asked the question. An
	 * entry citing a run from another project is either a bug or an attempt to
	 * smuggle one project's conversation into another's context, and neither is
	 * worth honouring. Absent means the check is skipped — used where run
	 * ownership is not resolvable rather than as a way to opt out. */
	isOwnRun?: (runId: string) => boolean;
	/** Authoritative project records. Required at the HTTP trust boundary; injected
	 * so compiler tests remain database-free. */
	resolveProjectContext?: () => TrustedChatProjectContext;
	/** Legacy wire field, accepted only when it matches an owned reference. */
	claimedStyleImageUrl?: string;
}

export interface CompiledChatContext {
	/** The frozen context. Always present: an unusable envelope compiles to a
	 *  whole-project one rather than failing the command. */
	envelope: ChatContextEnvelope;
	/** Why entries were dropped, for the trace. Never contains user content. */
	rejected: string[];
	/** True when the client sent no envelope and this was built from nothing —
	 *  the legacy path, until every caller is migrated. */
	legacy: boolean;
}

/* Validate memory one entry at a time.
 *
 * Deliberately not all-or-nothing. A single malformed decision written by an
 * older build would otherwise strip the entire conversation from the run, which
 * turns a small data problem into a visibly broken assistant. Dropping the bad
 * entry degrades context; dropping all of it degrades the product. */
function validateMemory(
	raw: unknown,
	isOwnRun: ((runId: string) => boolean) | undefined,
	rejected: string[],
): ConversationMemory {
	if (!raw || typeof raw !== "object") return EMPTY_CONVERSATION_MEMORY;
	// SAFETY: guarded immediately above — `raw` is a non-null object here. Nothing
	// is claimed about its fields; every one is parsed by schema below.
	const input = raw as Record<string, unknown>;

	const ownsProvenance = (provenance: { runId?: string }): boolean => {
		if (!provenance.runId || !isOwnRun) return true;
		if (isOwnRun(provenance.runId)) return true;
		rejected.push("memory_provenance_foreign_run");
		return false;
	};

	const decisions = (Array.isArray(input.decisions) ? input.decisions : []).flatMap((entry) => {
		const parsed = conversationDecisionSchema.safeParse(entry);
		if (!parsed.success) {
			rejected.push("memory_decision_invalid");
			return [];
		}
		return ownsProvenance(parsed.data.provenance) ? [parsed.data] : [];
	});

	const unresolved = (Array.isArray(input.unresolved) ? input.unresolved : []).flatMap((entry) => {
		const parsed = unresolvedQuestionSchema.safeParse(entry);
		if (!parsed.success) {
			rejected.push("memory_question_invalid");
			return [];
		}
		return ownsProvenance(parsed.data.provenance) ? [parsed.data] : [];
	});

	const recentTurns = (Array.isArray(input.recentTurns) ? input.recentTurns : []).flatMap(
		(entry) => {
			const parsed = memoryTurnSchema.safeParse(entry);
			if (!parsed.success) {
				rejected.push("memory_turn_invalid");
				return [];
			}
			return ownsProvenance(parsed.data.provenance) ? [parsed.data] : [];
		},
	);

	return { decisions, unresolved, recentTurns };
}

/** The context a command gets when the client sent nothing usable: the whole
 *  project, no focus, no memory. Correct, just uninformed. */
function emptyEnvelope(projectId: string, now: number): ChatContextEnvelope {
	return {
		projectId,
		capturedAt: now,
		index: EMPTY_CHAT_PROJECT_INDEX,
		detail: [],
		fingerprints: [],
		focus: WHOLE_PROJECT_FOCUS,
		memory: EMPTY_CONVERSATION_MEMORY,
		inputs: EMPTY_CHAT_COMMAND_INPUTS,
	};
}

function withTrustedProjectContext(
	envelope: ChatContextEnvelope,
	input: CompileChatContextInput,
	rejected: string[],
): ChatContextEnvelope {
	const trusted = input.resolveProjectContext?.();
	if (!trusted) return envelope;
	const ownedReferences = new Map(trusted.references.map((reference) => [reference.id, reference]));
	const ownedMaterialIds = new Set(
		buildChatProjectIndex({ materials: trusted.materials }).materials.map((entry) => entry.id),
	);
	const claimedStyle = input.claimedStyleImageUrl ?? envelope.inputs.styleImageUrl;
	const styleImageUrl = claimedStyle
		? trusted.references.find((reference) => reference.imageUrl === claimedStyle)?.imageUrl
		: undefined;
	if (claimedStyle && !styleImageUrl) rejected.push("style_image_unowned");

	const references = trusted.referenceIds.filter((id) => ownedReferences.has(id));
	if (envelope.inputs.referenceIds.some((id) => !references.includes(id)))
		rejected.push("reference_unowned");
	/* The index lists the references this PROJECT selected, not every entity in
	 * the workspace.
	 *
	 * `trusted.references` is the whole library — it exists to answer "does the
	 * caller own this id", which is a question about membership, not about scope.
	 * Indexing all of it made the decider prompt carry the user's entire reference
	 * collection on every ReAct step: measured at 91 entries and ~2.1k tokens for a
	 * project holding no references and no clips, growing with the library rather
	 * than with the project. The index exists to keep prompt size tied to the task,
	 * so it gets the selection, and ownership keeps the library. */
	const selectedReferences = references
		.map((id) => ownedReferences.get(id))
		.filter((reference): reference is NonNullable<typeof reference> => Boolean(reference));
	const authoritativeIndex = buildChatProjectIndex({
		materials: trusted.materials,
		references: selectedReferences.map(({ id, label }) => ({ id, label })),
	});
	const focusEntities = envelope.focus.entities.filter((entity) => {
		if (entity.kind === "reference") return ownedReferences.has(entity.id);
		if (entity.kind === "material") return ownedMaterialIds.has(entity.id);
		return true;
	});
	if (focusEntities.length !== envelope.focus.entities.length)
		rejected.push("focus_entity_unowned");
	const allowedKeys = new Set([
		...trusted.references.map((reference) => entityKey({ kind: "reference", id: reference.id })),
		...Array.from(ownedMaterialIds, (id) => entityKey({ kind: "material", id })),
	]);
	return {
		...envelope,
		index: {
			...envelope.index,
			materials: authoritativeIndex.materials,
			references: authoritativeIndex.references,
		},
		focus: focusEntities.length
			? { ...envelope.focus, entities: focusEntities }
			: WHOLE_PROJECT_FOCUS,
		fingerprints: envelope.fingerprints.filter(
			(fingerprint) =>
				(fingerprint.kind !== "reference" && fingerprint.kind !== "material") ||
				allowedKeys.has(entityKey(fingerprint)),
		),
		inputs: {
			...envelope.inputs,
			materials: trusted.materials,
			referenceIds: references,
			styleImageUrl,
		},
	};
}

/** Compile and freeze the context for one command. */
export function compileChatContext(input: CompileChatContextInput): CompiledChatContext {
	const now = input.now ?? Date.now();
	const rejected: string[] = [];

	if (input.raw === undefined || input.raw === null) {
		return {
			envelope: withTrustedProjectContext(emptyEnvelope(input.projectId, now), input, rejected),
			rejected,
			legacy: true,
		};
	}

	/* Memory is validated separately from the envelope, and before it, because it
	 * is the part most likely to carry a bad entry and the part whose failure
	 * should cost the least. Parsing the envelope with its memory inline would
	 * make one stale decision reject the focus too. */
	// SAFETY: the `typeof` check on the same line establishes the object-ness this
	// spread needs; `null` was returned above, so this cannot be null.
	const raw = typeof input.raw === "object" ? { ...(input.raw as Record<string, unknown>) } : {};
	const memory = validateMemory(raw.memory, input.isOwnRun, rejected);
	const parsed = chatContextEnvelopeSchema.safeParse({ ...raw, memory });

	if (!parsed.success) {
		rejected.push("envelope_invalid");
		return {
			envelope: withTrustedProjectContext(emptyEnvelope(input.projectId, now), input, rejected),
			rejected,
			legacy: false,
		};
	}

	/* The project id is the server's, always.
	 *
	 * The route already resolved the project from the URL. An envelope naming a
	 * different project is rejected at the route rather than quietly rewritten
	 * here — see `chatContextProjectMismatch`. */
	const envelope = withTrustedProjectContext(
		{ ...parsed.data, projectId: input.projectId },
		input,
		rejected,
	);
	return { envelope, rejected, legacy: false };
}

/** True when the client's envelope claims a different project than the URL.
 *  Checked at the route so the request fails loudly instead of running against a
 *  project the caller did not mean. */
export function chatContextProjectMismatch(raw: unknown, projectId: string): boolean {
	if (!raw || typeof raw !== "object") return false;
	// SAFETY: guarded immediately above. The asserted shape claims only that
	// `projectId` may exist and says nothing about its type, which the next line
	// checks before using it.
	const claimed = (raw as { projectId?: unknown }).projectId;
	return typeof claimed === "string" && claimed.length > 0 && claimed !== projectId;
}
