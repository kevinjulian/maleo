/* Resolving what a command is about.
 *
 * "Make this punchier" is the most common instruction in the product and the
 * least self-describing. Something has to decide what "this" is, and the decision
 * has to be the same every time or the feature is a coin flip with a progress bar.
 *
 * So scope is resolved here, deterministically, before planning — not inferred by
 * the model from prose. The precedence is fixed:
 *
 *   1. mention   — an explicit chip or typed @reference. The user named it.
 *   2. selection — what is selected in the editor. The user is looking at it.
 *   3. playhead  — what sits under the playhead. The user is parked on it.
 *   4. named     — an entity the instruction names by title.
 *   5. project   — the whole project.
 *
 * Each rung is "more explicit than the one below", which is the only ordering a
 * user can predict without reading documentation.
 *
 * Two behaviours are load-bearing and easy to get wrong:
 *
 * REMOVING A CHIP REMOVES A SOURCE, it does not pin an empty scope. The chip is
 * the visible form of rung 1; take it away and resolution falls to rung 2, the
 * same as if it had never been there. Anything else makes the × on a chip mean
 * something the user cannot see.
 *
 * AMBIGUITY IS REPORTED, NOT BROKEN. When an instruction names something two
 * entities answer to, guessing edits the wrong one half the time, and picking the
 * first is guessing with extra steps. Resolution says it is ambiguous and the
 * caller asks one scoped question. */
import type {
	ChatEntityRef,
	ChatProjectIndex,
	ResolvedChatFocus,
} from "./chat-context-envelope.ts";
import { entityKey, WHOLE_PROJECT_FOCUS, WHOLE_PROJECT_REF } from "./chat-context-envelope.ts";

/* One phrase in the instruction and every entity it could mean.
 *
 * Matching text to candidates is the caller's job — it needs the project's own
 * naming and fuzzy rules. What happens when a phrase matches more than one thing
 * is this module's job, because that is the part that must not vary. */
export interface NamedTargetGroup {
	phrase: string;
	candidates: ChatEntityRef[];
}

export interface ChatFocusInput {
	/** Explicit chips and typed mentions, in the order the user added them. */
	mentions?: ChatEntityRef[] | null;
	/** Current editor selection. Several entities is a legitimate selection. */
	selection?: ChatEntityRef[] | null;
	/** What sits under the playhead, when anything does. */
	playhead?: ChatEntityRef | null;
	/** Entities the instruction names, grouped by the phrase that named them. */
	named?: NamedTargetGroup[] | null;
	/** The project as it currently is. Refs absent from it are stale and dropped. */
	index?: ChatProjectIndex | null;
}

export type ChatFocusResolution =
	| { status: "resolved"; focus: ResolvedChatFocus }
	| { status: "ambiguous"; phrase: string; candidates: ChatEntityRef[] };

/* Every id the project currently has.
 *
 * A stale ref — a clip deleted since the chip was added, a selection left over
 * from a previous document — must not become focus. It would resolve to nothing
 * and the run would edit the whole project instead, which is the single most
 * destructive way for this to fail. Dropping it lets resolution fall through to a
 * source that still exists. */
function knownKeys(index: ChatProjectIndex | null | undefined): Set<string> | null {
	if (!index) return null;
	const keys = new Set<string>();
	for (const group of [
		index.story,
		index.timeline,
		index.materials,
		index.references,
		index.assets,
	]) {
		for (const entry of group) keys.add(entityKey(entry));
	}
	return keys;
}

function live(refs: ChatEntityRef[] | null | undefined, keys: Set<string> | null): ChatEntityRef[] {
	const present = (refs ?? []).filter(
		(ref) => ref.kind === "project" || !keys || keys.has(entityKey(ref)),
	);
	// Two chips for the same clip is one target, not two.
	const seen = new Set<string>();
	return present.filter((ref) => {
		const key = entityKey(ref);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/** Resolve command focus. Never throws: an input that resolves to nothing is the
 *  whole project, which is the honest reading of an instruction with no target. */
export function resolveChatFocus(input: ChatFocusInput): ChatFocusResolution {
	const keys = knownKeys(input.index);

	const mentions = live(input.mentions, keys);
	if (mentions.length)
		return { status: "resolved", focus: { source: "mention", entities: mentions } };

	const selection = live(input.selection, keys);
	if (selection.length)
		return { status: "resolved", focus: { source: "selection", entities: selection } };

	const playhead = live(input.playhead ? [input.playhead] : [], keys);
	if (playhead.length)
		return { status: "resolved", focus: { source: "playhead", entities: playhead } };

	/* Named targets are checked as groups so ambiguity is caught per phrase. A
	 * phrase matching two entities is reported even when another phrase in the
	 * same instruction resolved cleanly — editing one right target and one wrong
	 * target is not a partial success. */
	const named: ChatEntityRef[] = [];
	for (const group of input.named ?? []) {
		const candidates = live(group.candidates, keys);
		if (candidates.length > 1) return { status: "ambiguous", phrase: group.phrase, candidates };
		if (candidates.length === 1) named.push(candidates[0]!);
	}
	if (named.length)
		return { status: "resolved", focus: { source: "named", entities: live(named, keys) } };

	return { status: "resolved", focus: WHOLE_PROJECT_FOCUS };
}

/** True when focus is the whole project rather than any specific entity. */
export function isWholeProjectFocus(focus: ResolvedChatFocus): boolean {
	return (
		focus.source === "project" || focus.entities.every((ref) => ref.kind === WHOLE_PROJECT_REF.kind)
	);
}
