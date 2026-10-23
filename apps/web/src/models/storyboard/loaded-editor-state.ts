/* Editor-state fields of a loaded project: hook variants, creative direction,
 * the persisted chat log, decisions, settings and media assets. Each reader
 * tolerates what an older build wrote, because a load must not fail on it. */
import {
	conversationDecisionSchema,
	creativeDirectionSchema,
	EMPTY_CREATIVE_DIRECTION,
	parseArtifact,
	parseImportedMediaFields,
	pipelineArtifactKinds,
	type ConversationDecision,
	type CreativeDirection,
} from "@maleo/shared";
import type { ChatLogMessage } from "@models/chat/chat-log.ts";
import type { HookVariant } from "@models/content/content-types.ts";
import type { MediaAsset } from "@models/timeline/editor-media.ts";
import { DEFAULT_SETTINGS, type GlobalSettings } from "@models/presets/creative-settings.ts";

export function parseHookVariants(raw: unknown): HookVariant[] {
	if (!Array.isArray(raw)) return [];
	// SAFETY: persisted variants are untrusted JSON; the filter below checks every
	// field a variant is read by and drops the rest.
	return (raw as HookVariant[]).filter(
		(v) =>
			v &&
			typeof v.id === "number" &&
			typeof v.label === "string" &&
			v.scene &&
			typeof v.scene === "object",
	);
}

/** Load persisted creative direction; when absent, migrate a legacy
 *  project-reference prompt into the visual channel so prior projects keep their
 *  look without polluting the research/story topic. */
export function parseDirection(raw: unknown, legacyPrompt: string): CreativeDirection {
	const parsed = creativeDirectionSchema.safeParse(raw);
	if (
		parsed.success &&
		(parsed.data.raw || parsed.data.story || parsed.data.visual || parsed.data.voice)
	)
		return parsed.data;
	const prompt = legacyPrompt.trim();
	return prompt
		? { raw: prompt, story: "", visual: prompt, voice: "", rules: "" }
		: EMPTY_CREATIVE_DIRECTION;
}

/* The artifact cards the chat renders. A saved message whose artifact does not
 * parse against its kind, or is a kind the chat does not show (acknowledged
 * blockers are project state, never a card), is dropped on load: editor-chat
 * picks a card by kind, and an artifact it cannot read would otherwise be an empty
 * bubble, or throw and unmount the editor around it. */
const RENDERABLE_ARTIFACT_KINDS: ReadonlySet<string> = new Set([
	"story_plan",
	"storyboard_table",
	"research_bundle",
	"style_bible",
	"knowledge",
	"media",
]);

function withReadableArtifact(m: ChatLogMessage): ChatLogMessage | null {
	if (m.artifact === undefined) return m;
	const parsed = parseArtifact(pipelineArtifactKinds, m.artifact);
	return parsed.ok && RENDERABLE_ARTIFACT_KINDS.has(parsed.artifact.kind)
		? { ...m, artifact: parsed.artifact }
		: null;
}

// Settle a persisted chat log: keep only user/assistant turns and mark any
// tool/thinking card left "running" by a reload as interrupted.
/* One card per question, whatever the log accumulated.
 *
 * A reload replays a still-running job from its first event, so a run's question
 * card could be written into the log again on every reload; a project observed in
 * the wild had thirteen copies of one clarification, ten sharing a single
 * `actionId`. Dropping the replayed run's cards before it streams stops new copies,
 * but cannot clean what earlier reloads already persisted, and a log saved before
 * cards carried a job id has nothing to match on.
 *
 * Two cards for one `actionId` are never meaningful — a question is asked once and
 * answered once — so the last copy wins. It is the one carrying whatever answer
 * state the run ended with. */
function dedupeQuestionCards(messages: readonly ChatLogMessage[]): ChatLogMessage[] {
	const lastByAction = new Map<string, number>();
	messages.forEach((message, index) => {
		const actionId = message.question?.actionId;
		if (actionId) lastByAction.set(actionId, index);
	});
	return messages.filter((message, index) => {
		const actionId = message.question?.actionId;
		return !actionId || lastByAction.get(actionId) === index;
	});
}

/* Read persisted decisions, dropping anything that no longer matches the schema.
 *
 * A malformed entry is discarded rather than throwing: this runs on load, and a
 * single bad record written by an older build must not make a project
 * unopenable. Losing one decision degrades the next command's context; failing
 * the load loses the project. */
export function parseDecisions(raw: unknown): ConversationDecision[] {
	if (!Array.isArray(raw)) return [];
	return raw.flatMap((entry) => {
		const parsed = conversationDecisionSchema.safeParse(entry);
		return parsed.success ? [parsed.data] : [];
	});
}

export function settleChat(raw: unknown): ChatLogMessage[] {
	// SAFETY: persisted chat is untrusted JSON, so the cast is checked rather than
	// trusted — the `role` filter on the next line drops anything that is not a
	// chat message, and every later step reads optional fields only.
	return dedupeQuestionCards(
		(Array.isArray(raw) ? (raw as ChatLogMessage[]) : [])
			.filter((m) => m && (m.role === "user" || m.role === "assistant"))
			.map(withReadableArtifact)
			.filter((m): m is ChatLogMessage => m !== null)
			.map((m) =>
				m.tool?.status === "running"
					? { ...m, tool: { ...m.tool, status: "error" as const, note: "interrupted by reload" } }
					: m,
			)
			.map((m) =>
				m.note?.running
					? { ...m, note: { ...m.note, running: false, body: m.note.body || "(interrupted)" } }
					: m,
			),
	);
}

export function resolveSettings(raw: unknown, fallbackFormat: string | undefined): GlobalSettings {
	// SAFETY: only an object is cast, and every key is optional; aspectRatio, the one
	// key read here, is type-checked before use.
	const s = raw && typeof raw === "object" ? (raw as Partial<GlobalSettings>) : {};
	return {
		...DEFAULT_SETTINGS,
		...s,
		aspectRatio:
			(typeof s.aspectRatio === "string" && s.aspectRatio) ||
			fallbackFormat ||
			DEFAULT_SETTINGS.aspectRatio,
	};
}

/** The project's media library as the project read returns it: the server's rows
 *  (`p1-media-library`), never the editor state's list or a document's. */
export function parseMediaAssets(library: unknown): MediaAsset[] {
	// SAFETY: the list is only cast once it is an array, and the filter below
	// drops any entry without a string url.
	const raw = Array.isArray(library) ? (library as MediaAsset[]) : [];
	return raw
		.filter((a) => a && typeof a.url === "string")
		.map((asset) => {
			const { metadata, compatibility, importedSource, ...legacy } = asset;
			return {
				...legacy,
				...parseImportedMediaFields({ metadata, compatibility, importedSource }),
			};
		});
}
