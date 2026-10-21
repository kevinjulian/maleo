/* @-mention matching for reference pickers: what the operator typed, which
 * references it matches, and which ids the text still justifies.
 *
 * Pure string and array work — split out of `mention-textarea.tsx`, which
 * exported these beside the textarea that calls them. They are the rules a
 * mention obeys, and mounting a renderer to test a string function was evidence
 * of the misplacement, not a property of the rules. */
import type { RefImage } from "@maleo/shared";
import { REF_KIND_ORDER, referenceDisplayRole } from "@models/references/reference-vocabulary.ts";

export interface MentionTrigger {
	atIdx: number;
	query: string;
}

/* Role ordering + resolution come from the shared vocabulary. This file used to
 * declare its own copy of the role list AND its own resolution order (kind first,
 * then tags — the reverse of every other consumer), making it a sixth divergent
 * definition of what a reference's role is. */
export function refKind(ref: RefImage): string {
	return referenceDisplayRole(ref);
}

export function dedupeRefs(refs: RefImage[]): RefImage[] {
	const seen = new Set<string>();
	return refs.filter((ref) => {
		if (seen.has(ref.id)) return false;
		seen.add(ref.id);
		return true;
	});
}

export function detectMentionTrigger(text: string, cursor: number): MentionTrigger | null {
	let i = cursor - 1;
	while (i >= 0) {
		const ch = text[i];
		if (ch === "@") {
			if (i > 0 && !/[\s([{"']/u.test(text[i - 1] ?? "")) return null;
			return { atIdx: i, query: text.slice(i + 1, cursor) };
		}
		if (ch === "," || ch === "\n") return null;
		i--;
	}
	return null;
}

export function filterMentionRefs(refs: RefImage[], query: string): RefImage[] {
	const q = query.trim().toLowerCase();
	return dedupeRefs(refs)
		.filter((ref) => {
			const label = ref.label?.toLowerCase() ?? "";
			const note = ref.description?.toLowerCase() ?? "";
			return !q || label.includes(q) || note.includes(q);
		})
		.sort((a, b) => {
			const ak = REF_KIND_ORDER.indexOf(refKind(a));
			const bk = REF_KIND_ORDER.indexOf(refKind(b));
			const ao = ak === -1 ? 99 : ak;
			const bo = bk === -1 ? 99 : bk;
			return ao - bo || (a.label || "").localeCompare(b.label || "");
		});
}

/** The text after an insertion, with where the caret belongs. Same shape as
 *  `insertCommandPrompt` returns — both replace a trigger with an expansion. */
export interface TextInsertion {
	value: string;
	cursor: number;
}

export function insertMentionText(
	text: string,
	trigger: MentionTrigger,
	ref: RefImage,
): TextInsertion {
	const label = ref.label || ref.id;
	const insert = `@${label} `;
	const value = `${text.slice(0, trigger.atIdx)}${insert}${text.slice(trigger.atIdx + 1 + trigger.query.length)}`;
	return { value, cursor: trigger.atIdx + insert.length };
}

export function addMentionRefId(existing: string[] | undefined, id: string): string[] {
	return Array.from(new Set([...(existing ?? []), id]));
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasRefMention(text: string, ref: RefImage): boolean {
	const label = ref.label || ref.id;
	const escaped = escapeRegExp(label.trim());
	if (!escaped) return false;
	return new RegExp(`(^|[\\s([{"'])@${escaped}(?=$|[\\s,).!?;:"'\\]}])`, "iu").test(text);
}

export function pruneMentionRefIds(
	existing: string[] | undefined,
	text: string,
	refs: RefImage[],
): string[] {
	if (!existing?.length) return [];
	const byId = new Map(dedupeRefs(refs).map((ref) => [ref.id, ref]));
	return existing.filter((id) => {
		const ref = byId.get(id);
		return ref ? hasRefMention(text, ref) : false;
	});
}
