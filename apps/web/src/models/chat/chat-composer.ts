/* What the composer knows about scope before a command is sent.
 *
 * Two things the user can see and change: the context chips (what the shared
 * focus resolver picked) and `@` mentions (entities the user named explicitly).
 * Both are bound to stable entity ids. A mention remembers the label it was
 * inserted with only so the composer can tell whether its text is still there;
 * the id is what travels, so renaming the entity does not break it.
 *
 * Pure — the React composer is a thin shell over these. */
import {
	entityKey,
	type ChatEntityRef,
	type ChatFocusSource,
	type ChatIndexEntry,
	type ChatProjectIndex,
	type ResolvedChatFocus,
} from "@maleo/shared";
import type { TextInsertion } from "@models/references/mention-matching.ts";
import type { ChatScopeChip } from "./chat-log.ts";

/** What a command is sent with beyond its text. */
export interface ChatCommandScope {
	mentions: ChatEntityRef[];
	/** Focus sources the user removed by dismissing their chip. */
	excludedSources: ChatFocusSource[];
}

export const EMPTY_COMMAND_SCOPE: ChatCommandScope = { mentions: [], excludedSources: [] };

/** A preview of what the next command would be scoped to. */
export interface ComposerFocusPreview {
	chips: ChatScopeChip[];
	/** The project as the preview saw it — what `@` completes against. */
	index: ChatProjectIndex;
	/** An instruction phrase that matches more than one entity. */
	ambiguous?: { phrase: string; labels: string[] };
}

/** The composer's live view of the project, supplied by the editor. */
export interface ChatComposerSource {
	preview: (instruction: string, scope: ChatCommandScope) => ComposerFocusPreview;
	/** Notifies when editor focus (the selection) changes. */
	subscribe: (listener: () => void) => () => void;
}

export interface ChatMention {
	ref: ChatEntityRef;
	/** The label as inserted — used to tell whether the text still names it. */
	label: string;
}

export function labelFor(ref: ChatEntityRef, index: ChatProjectIndex): string {
	if (ref.kind === "project") return "Whole project";
	const groups = [index.story, index.timeline, index.materials, index.references, index.assets];
	for (const group of groups) {
		const hit = group.find((entry) => entry.kind === ref.kind && entry.id === ref.id);
		if (hit) return hit.label || ref.id;
	}
	return ref.id;
}

export function chipsForFocus(focus: ResolvedChatFocus, index: ChatProjectIndex): ChatScopeChip[] {
	return focus.entities.map((ref) => ({
		kind: ref.kind,
		id: ref.id,
		label: labelFor(ref, index),
		source: focus.source,
	}));
}

/** The composer's unsent scope: typed mentions and dismissed sources. */
export interface ComposerDraftScope {
	mentions: ChatMention[];
	excludedSources: ChatFocusSource[];
}

export const EMPTY_DRAFT_SCOPE: ComposerDraftScope = { mentions: [], excludedSources: [] };

/** The wire scope for this text: only mentions whose text is still there. */
export function commandScopeOf(text: string, draft: ComposerDraftScope): ChatCommandScope {
	return {
		mentions: liveMentions(text, draft.mentions).map((mention) => mention.ref),
		excludedSources: draft.excludedSources,
	};
}

/* Remove one chip.
 *
 * A mention chip drops that mention only — the others the user typed still
 * stand. Any other chip drops its whole source, which is what lets resolution
 * fall through: removing the selection chip does not pin an empty scope, it
 * lets the playhead (or the whole project) answer instead. */
export function withoutChip(draft: ComposerDraftScope, chip: ChatScopeChip): ComposerDraftScope {
	if (chip.source === "project") return draft;
	if (chip.source === "mention") {
		return {
			...draft,
			mentions: draft.mentions.filter(
				(mention) => !(mention.ref.kind === chip.kind && mention.ref.id === chip.id),
			),
		};
	}
	return draft.excludedSources.includes(chip.source)
		? draft
		: { ...draft, excludedSources: [...draft.excludedSources, chip.source] };
}

/* ── @ mentions ── */

export interface EntityMentionTrigger {
	atIdx: number;
	query: string;
}

export function detectEntityMention(text: string, cursor: number): EntityMentionTrigger | null {
	for (let i = cursor - 1; i >= 0; i--) {
		const ch = text[i];
		if (ch === "@") {
			if (i > 0 && !/[\s([{"']/u.test(text[i - 1] ?? "")) return null;
			return { atIdx: i, query: text.slice(i + 1, cursor) };
		}
		if (ch === "\n") return null;
	}
	return null;
}

/** The kinds `@` offers: sections, clips, materials and references. */
const MENTIONABLE = new Set([
	"section",
	"scene",
	"beat",
	"slide",
	"post",
	"clip",
	"material",
	"reference",
]);

export function entityMentionCandidates(
	index: ChatProjectIndex,
	query: string,
	limit = 8,
): ChatIndexEntry[] {
	const q = query.trim().toLocaleLowerCase();
	const all = [...index.story, ...index.timeline, ...index.materials, ...index.references];
	const seen = new Set<string>();
	return all
		.filter((entry) => {
			const key = entityKey(entry);
			if (!MENTIONABLE.has(entry.kind) || seen.has(key)) return false;
			seen.add(key);
			return (
				!q ||
				entry.label.toLocaleLowerCase().includes(q) ||
				entry.id.toLocaleLowerCase().includes(q)
			);
		})
		.slice(0, limit);
}

export function insertEntityMention(
	text: string,
	trigger: EntityMentionTrigger,
	entry: ChatIndexEntry,
): TextInsertion & { mention: ChatMention } {
	const label = entry.label || entry.id;
	const insert = `@${label} `;
	const value = `${text.slice(0, trigger.atIdx)}${insert}${text.slice(trigger.atIdx + 1 + trigger.query.length)}`;
	return {
		value,
		cursor: trigger.atIdx + insert.length,
		mention: { ref: { kind: entry.kind, id: entry.id }, label },
	};
}

/** Mentions whose inserted text the user has not deleted. */
export function liveMentions(text: string, mentions: readonly ChatMention[]): ChatMention[] {
	const seen = new Set<string>();
	return mentions.filter((mention) => {
		const key = entityKey(mention.ref);
		if (seen.has(key) || !text.includes(`@${mention.label}`)) return false;
		seen.add(key);
		return true;
	});
}
