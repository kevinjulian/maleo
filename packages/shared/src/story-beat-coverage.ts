/* The pre-submission gate over one section's beats.
 *
 * Four checks, each a count or a set comparison. None takes a threshold: a
 * tunable similarity number is where a quality signal goes to die, and the metric
 * this replaces was recorded on zero runs.
 *
 * The gate exists because these four failures are all silent otherwise. Two beats
 * that render the same picture, a cast member the bible never declared, an
 * approved shot that no beat covers, and a subject the narration names while its
 * beat's prompt does not — each ships a plausible-looking image and reports
 * success. A section that fails visibly is strictly better. */
import { sameBeatVisual, type BeatVisualIntent } from "./beat-visual-intent.ts";
import { bibleSubjectIds, bibleSubjectsNamedIn, type StoryBible } from "./story-bible.ts";
import { bindingIdentity, type StoryReferenceBinding } from "./story-visual-direction.ts";

export type StoryBeatInvariant =
	| "cast_in_bible"
	| "adjacent_differ"
	| "planned_shot_coverage"
	| "narration_names_subject"
	| "reference_binding_subset"
	| "reference_binding_coverage"
	| "reference_detached";

export interface StoryBeatCoverageViolation {
	invariant: StoryBeatInvariant;
	/** Human-facing, and specific enough to act on without opening the run. */
	detail: string;
}

export interface StoryBeatCoverageInput {
	/** Beats in order, each carrying its narration text. */
	beats: ReadonlyArray<{ intent: BeatVisualIntent; text?: string }>;
	bible?: StoryBible;
	/** Operator-approved planned shots for this section. */
	plannedShots?: readonly string[];
	/** Directed plans carry exact approved identities; presence replaces prose alias coverage. */
	approvedBindings?: readonly StoryReferenceBinding[];
	materializedByKey?: Readonly<Record<string, string>>;
	rosterEntityIds?: readonly string[];
}

function listBeats(indexes: readonly number[]): string {
	return indexes.join(", ");
}

export function storyBeatCoverageViolations(
	input: StoryBeatCoverageInput,
): StoryBeatCoverageViolation[] {
	const beats = input.beats;
	const violations: StoryBeatCoverageViolation[] = [];
	const approved = input.approvedBindings?.map(bindingIdentity);
	if (approved && input.rosterEntityIds) {
		const roster = new Set(input.rosterEntityIds);
		const detached = approved.filter((identity) => {
			const entityId = identity.startsWith("entity:")
				? identity.slice(7)
				: input.materializedByKey?.[identity.slice(8)];
			return !entityId || !roster.has(entityId);
		});
		if (detached.length)
			violations.push({
				invariant: "reference_detached",
				detail: `approved reference(s) missing from project roster: ${[...new Set(detached)].join(", ")}`,
			});
	}
	if (!beats.length) return violations;
	const intents = beats.map((beat) => beat.intent);
	if (approved) {
		const approvedSet = new Set(approved);
		const selected = intents.flatMap((intent) =>
			(intent.referenceBindings ?? []).map(bindingIdentity),
		);
		const unknown = [...new Set(selected.filter((identity) => !approvedSet.has(identity)))];
		if (unknown.length)
			violations.push({
				invariant: "reference_binding_subset",
				detail: `beat binding(s) outside approved section set: ${unknown.join(", ")}`,
			});
		const selectedSet = new Set(selected);
		const missing = [...new Set(approved.filter((identity) => !selectedSet.has(identity)))];
		if (missing.length)
			violations.push({
				invariant: "reference_binding_coverage",
				detail: `approved binding(s) no measured beat carries: ${missing.join(", ")}`,
			});
	}

	/* 1. Cast is a subset of the bible when a closed list exists. */
	if (input.bible) {
		const known = new Set(bibleSubjectIds(input.bible));
		const unknown = [
			...new Set(intents.flatMap((beat) => beat.subjectIds.filter((id) => !known.has(id)))),
		];
		if (unknown.length) {
			violations.push({
				invariant: "cast_in_bible",
				detail: `subject id(s) not in the story bible: ${unknown.join(", ")}`,
			});
		}
	}

	// 2. Adjacent beats differ on at least one field that changes the picture.
	const duplicates: number[] = [];
	for (let index = 1; index < intents.length; index++) {
		if (sameBeatVisual(intents[index - 1]!, intents[index]!)) duplicates.push(index - 1);
	}
	if (duplicates.length) {
		violations.push({
			invariant: "adjacent_differ",
			detail: `adjacent beats ${duplicates.map((index) => `${index}/${index + 1}`).join(", ")} would render the same picture`,
		});
	}

	/* 3. Every subject an approved planned shot names reaches some beat.
	 *
	 * Checked through the bible's planner-authored aliases — the same set membership
	 * test invariant 4 runs on narration text — not by counting. The count comparison
	 * this replaces (fewer beats than approved shots = pigeonhole) assumed one shot
	 * maps to one beat. Authoring has never had that contract: the beat count comes
	 * out of MEASURED audio at `maxVisualBeatSec`, and authoring merges the approved
	 * intent across however many beats that produced. The pigeonhole therefore failed
	 * correct sections — four approved shots over three measured beats, before any
	 * provider call — while saying nothing about WHICH shot went uncovered.
	 *
	 * Union, not per-beat: a shot's intent may legitimately be carried by any beat,
	 * and demanding a specific pairing needs exactly the similarity score this gate
	 * refuses.
	 *
	 * What it proves: approved intent survived into the beats, at subject
	 * granularity. What it cannot see: a dropped shot naming no bible subject, and
	 * one differing from a covered shot only in camera treatment. Invariant 2 still
	 * catches the visible symptom of collapsed intent. */
	if (approved === undefined && input.bible) {
		const plannedShots = (input.plannedShots ?? []).filter((shot) => shot.trim());
		const cast = new Set(intents.flatMap((beat) => beat.subjectIds));
		const uncovered = [
			...new Set(plannedShots.flatMap((shot) => bibleSubjectsNamedIn(input.bible, shot))),
		].filter((id) => !cast.has(id));
		if (uncovered.length) {
			violations.push({
				invariant: "planned_shot_coverage",
				detail: `approved shot(s) name subject id(s) no beat carries: ${uncovered.join(", ")}`,
			});
		}
	}

	/* 4. A subject the narration names appears in that beat's cast.
	 *
	 * This is the story→image link, checked without a model: aliases are
	 * planner-authored and matched on word boundaries, so it stays a set membership
	 * test. Beats with no narration text have no name to check.
	 *
	 * The one check here that can be wrong about a correct beat — an alias that is
	 * also a common word. It is retryable rather than fatal for exactly that
	 * reason: a bad alias costs one retry and a visible error, not a lost run. */
	if (input.bible) {
		const missing: number[] = [];
		for (const [index, beat] of beats.entries()) {
			const named = bibleSubjectsNamedIn(input.bible, beat.text ?? "");
			if (!named.length) continue;
			const cast = new Set(beat.intent.subjectIds);
			if (named.some((id) => !cast.has(id))) missing.push(index);
		}
		if (missing.length) {
			violations.push({
				invariant: "narration_names_subject",
				detail: `beat(s) ${listBeats(missing)} name a story subject in their narration that the beat's cast omits`,
			});
		}
	}

	return violations;
}

/** One line naming every violated invariant, for the section's error. */
export function storyBeatCoverageError(violations: readonly StoryBeatCoverageViolation[]): string {
	return violations.map((violation) => `${violation.invariant}: ${violation.detail}`).join("; ");
}
