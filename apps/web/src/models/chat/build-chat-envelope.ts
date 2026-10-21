/* Building the envelope a command is sent with.
 *
 * Assembled from LIVE editor state, never from the persisted copy. Editor state
 * and the storyboard both autosave on a 1200ms debounce, so a command sent right
 * after an edit — which is most commands, since the user edits and then asks
 * about what they edited — would otherwise describe the project as it was before
 * the thing they are asking about.
 *
 * Everything here is read-only and pure. It reads the stores; it does not touch
 * them, and it makes no request. */
import {
	buildChatProjectIndex,
	normalizeConversationMemory,
	withoutConflictingDecisions,
	resolveChatFocus,
	chapterRanges,
	WHOLE_PROJECT_FOCUS,
	EMPTY_CHAT_COMMAND_INPUTS,
	type ChatContextEnvelope,
	type ChatEntityRef,
	type ConversationDecision,
	type ChatPendingAction,
	type ChatCommandInputs,
	type ProjectMaterials,
	type ChatFocusResolution,
	type ChatAssetInput,
	type ChatProjectIndex,
	type ChatFocusSource,
	type ResolvedChatFocus,
} from "@maleo/shared";
import type { EditScope } from "@maleo/shared/editor";
import { scopeFingerprints } from "@models/timeline/agent-result-scope.ts";
import type { ChatLogMessage } from "./chat-log.ts";
import { focusFromPlayhead, focusFromSelection } from "./chat-focus-descriptors.ts";
import type { Selection } from "@models/timeline/selection-model.ts";

export interface BuildChatEnvelopeInput {
	projectId: string;
	/** The live editing surface: document, slides, posts. */
	scope: EditScope;
	materials?: ProjectMaterials | null;
	referenceIds?: string[];
	references?: Array<{ id: string; label?: string; role?: string; description?: string }>;
	assets?: ChatAssetInput[];
	/** Explicit chips or typed mentions, when the composer has any. */
	mentions?: ChatEntityRef[];
	/** Sources whose chip the user dismissed: resolution skips them. */
	excludedSources?: ChatFocusSource[];
	selection?: Selection | null;
	playheadSec?: number | null;
	/** Live chat state — not the persisted transcript, which lags the debounce. */
	messages?: ChatLogMessage[];
	decisions?: ConversationDecision[];
	pendingAction?: ChatPendingAction;
	instruction?: string;
	/** The prompt inputs this command runs under — brief, direction, materials,
	 *  and the project's shape/voice settings. */
	inputs?: ChatCommandInputs;
	now?: number;
}

export interface BuiltChatEnvelope {
	envelope: ChatContextEnvelope;
	/* Set when focus could not be resolved without guessing.
	 *
	 * Surfaced rather than swallowed: the command should ask one scoped question
	 * instead of editing one of two plausible targets at random. */
	ambiguous?: Extract<ChatFocusResolution, { status: "ambiguous" }>;
}

function namedTargets(instruction: string | undefined, index: ChatProjectIndex) {
	const text = instruction?.toLocaleLowerCase().trim();
	if (!text) return [];
	const entries = [
		...index.story,
		...index.timeline,
		...index.materials,
		...index.references,
		...index.assets,
	];
	const byPhrase = new Map<string, ChatEntityRef[]>();
	for (const entry of entries) {
		const phrase = entry.label.trim().toLocaleLowerCase();
		if (phrase.length < 2 || !text.includes(phrase)) continue;
		const refs = byPhrase.get(phrase) ?? [];
		refs.push({ kind: entry.kind, id: entry.id });
		byPhrase.set(phrase, refs);
	}
	return [...byPhrase].map(([phrase, candidates]) => ({ phrase, candidates }));
}

function pendingActionFrom(messages: ChatLogMessage[]): ChatPendingAction | undefined {
	const message = [...messages]
		.reverse()
		.find((entry) => entry.question && !entry.question.answered && entry.question.actionId);
	if (!message?.question?.actionId) return undefined;
	const approval = message.question.options?.some((option) =>
		/approve|reject/i.test(`${option.label} ${option.value}`),
	);
	return {
		actionId: message.question.actionId,
		kind: approval ? "approval" : "clarification",
		question: message.question.question,
	};
}

function conflictsWithStructuredState(
	decision: ConversationDecision,
	inputs: ChatCommandInputs,
): boolean {
	const question = decision.question.toLocaleLowerCase();
	const answer = decision.answer.trim().toLocaleLowerCase();
	const differs = (value: string | undefined): boolean =>
		Boolean(value?.trim()) && value!.trim().toLocaleLowerCase() !== answer;
	if (/aspect|format/.test(question)) return differs(inputs.aspect);
	if (/language/.test(question)) return differs(inputs.language);
	if (/platform/.test(question)) return differs(inputs.platform);
	if (/audience/.test(question)) return differs(inputs.audience);
	if (/voice/.test(question)) return differs(inputs.voice);
	if (/style/.test(question)) return differs(inputs.styleName ?? inputs.style);
	if (/slide count|how many slides/.test(question) && inputs.slideCount != null)
		return String(inputs.slideCount) !== answer;
	if (/duration|length/.test(question) && inputs.targetDurationSec != null) {
		const stated = Number(answer.match(/\d+(?:\.\d+)?/)?.[0]);
		return Number.isFinite(stated) && stated !== inputs.targetDurationSec;
	}
	return false;
}

function detailFor(focus: ResolvedChatFocus, input: BuildChatEnvelopeInput): unknown[] {
	if (focus.source === "project") return [];
	const records: unknown[] = [];
	const add = (value: unknown): void => {
		if (value !== undefined) records.push(value);
	};
	for (const ref of focus.entities) {
		if (ref.kind === "clip") {
			const index = input.scope.doc.clips.findIndex((clip) => clip.id === ref.id);
			if (index >= 0)
				for (const clip of input.scope.doc.clips.slice(Math.max(0, index - 1), index + 2))
					add({ kind: "clip", ...clip });
		} else if (ref.kind === "scene") {
			const marker = input.scope.doc.markers.find((entry) => String(entry.id) === ref.id);
			add(marker ? { kind: "scene", ...marker } : undefined);
			for (const clip of input.scope.doc.clips.filter(
				(entry) => entry.markerId != null && String(entry.markerId) === ref.id,
			))
				add({ kind: "clip", ...clip });
		} else if (ref.kind === "section") {
			add(input.scope.doc.chapters?.find((chapter) => chapter.id === ref.id));
			for (const clip of input.scope.doc.clips.filter((entry) => entry.scene?.sectionId === ref.id))
				add({ kind: "clip", ...clip });
		} else if (ref.kind === "slide") {
			const index = input.scope.slides.findIndex((slide) => slide.key === ref.id);
			if (index >= 0)
				for (const slide of input.scope.slides.slice(Math.max(0, index - 1), index + 2))
					add({ kind: "slide", ...slide });
		} else if (ref.kind === "post") {
			const index = input.scope.posts.findIndex((post) => post.key === ref.id);
			if (index >= 0)
				for (const post of input.scope.posts.slice(Math.max(0, index - 1), index + 2))
					add({ kind: "post", ...post });
		} else if (ref.kind === "material") {
			// SAFETY: focus refs are resolved against the material index built from
			// ProjectMaterials keys, so a material id is one of those keys here.
			add({
				kind: "material",
				id: ref.id,
				value: input.materials?.[ref.id as keyof ProjectMaterials],
			});
		} else if (ref.kind === "reference")
			add({ kind: "reference", ...input.references?.find((entry) => entry.id === ref.id) });
		else if (ref.kind === "asset")
			add({ kind: "asset", ...input.assets?.find((entry) => entry.id === ref.id) });
	}
	const seen = new Set<string>();
	return records.filter((record) => {
		const key = JSON.stringify(record);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/** The project index and the focus resolved against it. */
export interface CommandFocus {
	index: ChatProjectIndex;
	resolution: ChatFocusResolution;
}

/* Index and focus for a command, without the rest of the envelope.
 *
 * The composer calls this on every keystroke to show its chips, and the envelope
 * calls it once at send — the same function, so what the chips promise is what
 * the run receives. */
export function resolveCommandFocus(input: BuildChatEnvelopeInput): CommandFocus {
	const { scope } = input;
	const excluded = new Set(input.excludedSources ?? []);

	const index = buildChatProjectIndex({
		doc: scope.doc,
		chapters: chapterRanges(scope.doc),
		slides: scope.slides.map((slide) => ({ key: slide.key, name: slide.name, caption: slide.cap })),
		posts: scope.posts.map((post) => ({ key: post.key, body: post.body })),
		materials: input.materials ?? null,
		references: input.references ?? (input.referenceIds ?? []).map((id) => ({ id })),
		assets: input.assets ?? [],
	});

	const playhead =
		input.playheadSec != null && !excluded.has("playhead")
			? focusFromPlayhead(scope.doc, input.playheadSec)
			: null;
	const resolution = resolveChatFocus({
		mentions: excluded.has("mention") ? null : (input.mentions ?? null),
		selection:
			input.selection && !excluded.has("selection") ? focusFromSelection(input.selection) : null,
		playhead,
		named: excluded.has("named") ? null : namedTargets(input.instruction, index),
		index,
	});
	return { index, resolution };
}

/** Assemble the envelope for one command from current editor state. */
export function buildChatEnvelope(input: BuildChatEnvelopeInput): BuiltChatEnvelope {
	const { scope } = input;
	const { index, resolution } = resolveCommandFocus(input);

	/* Fingerprint everything the envelope describes, so the result that comes back
	 * can be fenced against what the run actually read. This is the capture: after
	 * this point the user may edit freely, and a conflict is detectable rather
	 * than silent. */
	const fingerprints = scopeFingerprints(scope);

	const focus = resolution.status === "resolved" ? resolution.focus : WHOLE_PROJECT_FOCUS;
	const inputs = input.inputs ?? {
		...EMPTY_CHAT_COMMAND_INPUTS,
		referenceIds: input.referenceIds ?? [],
	};
	const memory = withoutConflictingDecisions(
		normalizeConversationMemory(input.messages ?? [], input.decisions ?? []),
		(decision) => conflictsWithStructuredState(decision, inputs),
	);
	const pendingAction = input.pendingAction ?? pendingActionFrom(input.messages ?? []);
	const envelope: ChatContextEnvelope = {
		projectId: input.projectId,
		capturedAt: input.now ?? Date.now(),
		index,
		detail: detailFor(focus, input),
		fingerprints,
		focus,
		memory,
		inputs,
		...(pendingAction ? { pendingAction } : {}),
	};

	return resolution.status === "ambiguous" ? { envelope, ambiguous: resolution } : { envelope };
}
