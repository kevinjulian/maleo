/** Find and replace across cue text: a literal, case-sensitive match, so a name is
 *  never rewritten inside a differently cased word. Locked cues and cues the
 *  replacement would empty are skipped; deleting a cue is its own action. */

interface FindCue {
	id: string;
	track: number;
	caption?: { text: string };
}

export interface CaptionReplacementPlan {
	updates: Array<{ id: string; text: string }>;
	/** Cues containing the query, including skipped ones. */
	matches: number;
	skipped: number;
}

export function captionReplacements(
	cues: readonly FindCue[],
	find: string,
	replace: string,
	locked: (track: number) => boolean,
): CaptionReplacementPlan {
	if (!find) return { updates: [], matches: 0, skipped: 0 };
	const matched = cues.filter((cue) => cue.caption?.text.includes(find));
	const updates = matched
		.filter((cue) => !locked(cue.track))
		.map((cue) => ({ id: cue.id, text: cue.caption!.text.split(find).join(replace) }))
		.filter((update) => update.text.trim().length > 0);
	return { updates, matches: matched.length, skipped: matched.length - updates.length };
}
