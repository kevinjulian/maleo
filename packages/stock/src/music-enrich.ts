/* Filling in the two labels a track page cannot supply.
 *
 * Capture gets title, tags, licence and source off the page. Nobody publishes a
 * bed's *texture* ("sustained string pad, slow build, no melody in front") or
 * which of this system's ten emotions it serves, and typing those by hand for
 * every bed is the part that does not scale.
 *
 * So a model writes them, over the compiled source manifest, between compiling
 * and baking. Labelling before publishing means what goes up is already
 * complete, and a bad run costs a re-run rather than putting mistakes live.
 *
 * Everything here is pure. The prompt, the parsing, and the decision of what to
 * send are testable without a key, which matters more than usual because the
 * expensive half is not the thing most likely to be wrong. */

import { EMOTIONS, type Emotion } from "@maleo/shared";
import { oneOf } from "@maleo/shared";

export interface EnrichableBed {
	/** Identity across every step of the pipeline. */
	source: string;
	id?: string;
	title: string;
	description?: string;
	tags?: string[];
	emotion?: string;
	[key: string]: unknown;
}

export interface Enrichment {
	description: string;
	/** Absent when the model would not commit to one. */
	emotion?: Emotion;
}

/** Long enough for texture and instrumentation, short enough that it cannot
 *  drown the tags it sits beside — description is the lowest-weighted field. */
const MAX_DESCRIPTION = 240;

const isEmotion = (value: string): value is Emotion => oneOf(value, EMOTIONS) !== undefined;

export function needsEnrichment(bed: EnrichableBed): boolean {
	return !bed.description?.trim() || !bed.emotion?.trim();
}

export interface EnrichPlan<T extends EnrichableBed> {
	/** Beds to send to the model. */
	pending: T[];
	/** Already labelled, left alone. */
	settled: T[];
}

/** What to spend money on. The manifest is its own cache: a bed that already
 *  carries both labels is never sent again, so re-running costs nothing and the
 *  second run is stable. Beds carried over from the published library arrive
 *  labelled, so only genuinely new ones are paid for. */
export function planEnrich<T extends EnrichableBed>(
	beds: readonly T[],
	options: { force?: boolean } = {},
): EnrichPlan<T> {
	const plan: EnrichPlan<T> = { pending: [], settled: [] };
	for (const bed of beds) {
		if (options.force || needsEnrichment(bed)) plan.pending.push(bed);
		else plan.settled.push(bed);
	}
	return plan;
}

export function describeEnrichPlan<T extends EnrichableBed>(plan: EnrichPlan<T>): string {
	return `${plan.pending.length} to label, ${plan.settled.length} already labelled`;
}

/** The instruction. Two things it works hard at:
 *
 *  Refusing is allowed. Emotion is the highest-weighted field in the scorer, so
 *  a confident wrong answer costs more than a blank — "none" is offered as a
 *  first-class option rather than something the model has to disobey to give.
 *
 *  Description asks for what is audible, not for mood adjectives. Mood is what
 *  emotion is for, and a description that repeats it adds nothing a cue can
 *  match on that the emotion did not already carry. */
export function buildEnrichPrompt(bed: EnrichableBed): string {
	const tags = bed.tags?.length ? bed.tags.join(", ") : "(none)";
	return [
		"You are labelling a background-music bed for a video generator's library.",
		"",
		`Title: ${bed.title}`,
		`Tags: ${tags}`,
		"",
		"Return JSON, no prose, no code fence:",
		'{"description": "...", "emotion": "..."}',
		"",
		"description: one sentence on what is AUDIBLE — instrumentation, texture, rhythm,",
		"whether it builds. Concrete nouns. Do not restate the mood; that is what emotion is",
		`for. At most ${MAX_DESCRIPTION} characters.`,
		"",
		`emotion: exactly one of ${EMOTIONS.join(", ")} — or "none".`,
		'Answer "none" unless the bed clearly serves that emotion. A wrong emotion is worse',
		"than no emotion, because it outranks every other signal when a scene asks for it.",
	].join("\n");
}

/** Read the model's answer, distrusting all of it.
 *
 *  An unrecognised emotion becomes absent rather than being coerced to the
 *  nearest match: this vocabulary is fixed and small, and a bed labelled
 *  "uplifting" belongs in none of it. */
export function parseEnrichment(raw: string): Enrichment | null {
	const text = raw
		.trim()
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/\s*```$/, "")
		.trim();
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
	const body = parsed as { description?: unknown; emotion?: unknown };

	const description =
		typeof body.description === "string"
			? body.description.replace(/\s+/g, " ").trim().slice(0, MAX_DESCRIPTION)
			: "";
	const claimed = typeof body.emotion === "string" ? body.emotion.trim().toLowerCase() : "";
	const emotion = isEmotion(claimed) ? claimed : undefined;

	// Nothing usable at all is a failure, so the caller can report it rather than
	// silently writing an empty label over a bed.
	if (!description && !emotion) return null;
	return { description, ...(emotion ? { emotion } : {}) };
}

/** The local assistant CLI, invoked once per bed.
 *
 *  Every flag here is about making a one-shot classification behave like one:
 *
 *    -p             answer and exit, rather than opening a session
 *    --no-tools     labelling reads nothing and writes nothing; a run that
 *                   could edit files would be a labelling step with the ability
 *                   to modify the repo it happens to be invoked from
 *    --no-session   nothing to resume, and no session files accumulating one
 *                   per bed
 *    --thinking off a fixed ten-way choice plus one sentence does not need a
 *                   reasoning budget, and this is per bed
 *
 *  The prompt goes over stdin, not argv: it carries a title and tags copied off
 *  a web page, which is arbitrary text of arbitrary length. */
export function buildLabelCommand(
	options: { command?: string; model?: string; provider?: string } = {},
): string[] {
	return [
		options.command ?? "pi",
		"-p",
		"--no-tools",
		"--no-session",
		"--thinking",
		"off",
		...(options.provider ? ["--provider", options.provider] : []),
		...(options.model ? ["--model", options.model] : []),
	];
}

/** Merge, without ever destroying a label that already exists.
 *
 *  A blank field in the answer means "no opinion", not "clear this" — and with
 *  --force re-running the whole library, an overwrite rule that treated silence
 *  as deletion would strip labels a human had corrected by hand. */
export function applyEnrichment<T extends EnrichableBed>(bed: T, enrichment: Enrichment): T {
	return {
		...bed,
		...(enrichment.description ? { description: enrichment.description } : {}),
		...(enrichment.emotion ? { emotion: enrichment.emotion } : {}),
	};
}
