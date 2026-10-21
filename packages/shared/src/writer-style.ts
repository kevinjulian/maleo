/* Writer styles — how narration is WRITTEN, as fields rather than prose.
 *
 * The narration craft used to have no home. Person, tense, sentence rhythm and
 * figuration were whatever the planner reached for, so every project narrated in
 * one house voice, and an operator who wanted a different one could only ask for
 * it inside the Story material — a channel that exists to carry the SUBJECT, and
 * whose own layering rules say an unrelated directive there redirects what the
 * video is about.
 *
 * So craft lives here, as a closed library. This is the same move `story-bible.ts`
 * made for visual constants and for the same reason: guidance re-authored as prose
 * on every run is re-interpreted on every run. A profile compiles into the planning
 * prompt identically every time.
 *
 * The library is FIXED, not authored per story. A writer style earns its keep by
 * making a hundred videos sound like one channel, which a per-run authored profile
 * defeats by construction. It is also what makes `forbiddenMoves` meaningful — a
 * scan can only check a banlist that exists before the draft does.
 *
 * Profiles are named for their craft, never for a writer. Author imitation produces
 * pastiche, ages badly across model versions, asks the system to imitate identifiable
 * people, and does not survive translation into the narration languages already in
 * use. Person, tense and sentence length do survive it. */
import { z } from "zod";
import { oneOf } from "./one-of.ts";

export const WRITER_STYLES = [
	"plainspoken_reportage",
	"second_person_immersive",
	"socratic_plain",
	"essayistic_reflective",
	"direct_benefit",
	"procedural_precise",
	"wry_conversational",
] as const;
export type WriterStyle = (typeof WRITER_STYLES)[number];

const NARRATIVE_PERSONS = ["first", "second", "third_close", "third_distant"] as const;
const NARRATIVE_TENSES = ["past", "present"] as const;
const FIGURATION_LEVELS = ["none", "low", "moderate", "high"] as const;

export type NarrativePerson = (typeof NARRATIVE_PERSONS)[number];
export type NarrativeTense = (typeof NARRATIVE_TENSES)[number];
export type FigurationLevel = (typeof FIGURATION_LEVELS)[number];

export const writerStyleProfileSchema = z
	.object({
		key: z.enum(WRITER_STYLES),
		label: z.string().min(1),
		person: z.enum(NARRATIVE_PERSONS),
		tense: z.enum(NARRATIVE_TENSES),
		/** One line, compiled verbatim into the planning prompt. */
		sentenceRhythm: z.string().min(1),
		concreteness: z.string().min(1),
		figuration: z.enum(FIGURATION_LEVELS),
		addressesViewer: z.boolean(),
		/** How the first section opens, so section 1 does not default to a throat-clear. */
		openingMove: z.string().min(1),
		/* The prose MOVES this style refuses, as descriptions. "rhetorical questions",
		 * "explaining the metaphor". These reach the planner and nothing else — no
		 * substring scan can detect them, and a scan that silently never fires is worse
		 * than no scan because it reads like a check. */
		forbiddenMoves: z.array(z.string().min(1)).min(1),
		/* The literal phrases this style refuses. Scannable, because they are strings
		 * that either appear in the narration or do not.
		 *
		 * Scanned and REPORTED, never enforced by blocking: a plan is not wrong because
		 * it used the word "simply", and a planner that argues with an operator about
		 * taste costs more than the word does. */
		forbiddenPhrases: z.array(z.string().min(1)).default([]),
		/* Sentences per hundred words.
		 *
		 * Not a stylistic note — an input to the word budget. Narration synthesis inserts
		 * a breath at every sentence boundary (`NarrationBoundary` in the api package), so
		 * two profiles writing the same word count at different sentence densities produce
		 * materially different runtimes. The planner writes toward a word target, so a
		 * target blind to this is systematically wrong before measurement ever runs. */
		sentencesPerHundredWords: z.number().positive(),
	})
	.strict();
export type WriterStyleProfile = z.infer<typeof writerStyleProfileSchema>;

/* Calibrated from real planner drafts on the same four-section English story:
 * "A paper airplane crosses a classroom, changing hands before reaching a strict
 * teacher who answers the message inside." Counts use `narrationSegmentsForShots`,
 * the production sentence splitter. Narration hashes make each sample identifiable:
 *
 * plainspoken_reportage      209 words / 24 sentences = 11.5  9ab06cb86d59b5bc
 * second_person_immersive    219 words / 19 sentences = 8.7   d70b7ad55c5fc473
 * socratic_plain             214 words / 20 sentences = 9.3   b28bcefdd5863a61
 * essayistic_reflective      226 words / 18 sentences = 8.0   6645d700b40c556f
 * direct_benefit             219 words / 22 sentences = 10.0  e6cb20e97b982cc3
 * procedural_precise        225 words / 23 sentences = 10.2  595f1913ab879fbd
 * wry_conversational        211 words / 25 sentences = 11.8  ecc469bd95d67719
 *
 * One sample per profile is deliberately a calibration baseline, not a statistical
 * model. Final timing still comes from measured synthesized audio. */
const PROFILES: Record<WriterStyle, WriterStyleProfile> = {
	plainspoken_reportage: {
		key: "plainspoken_reportage",
		label: "Plainspoken reportage",
		person: "third_distant",
		tense: "past",
		sentenceRhythm:
			"Short declaratives. Facts lead. At most one long cumulative sentence per section.",
		concreteness: "Name objects, quantities and places. Avoid abstraction nouns.",
		figuration: "none",
		addressesViewer: false,
		openingMove: "Open on the concrete fact that makes the rest necessary.",
		forbiddenMoves: [
			"rhetorical questions",
			"stacked adjectives",
			"narrating what the audience should feel",
		],
		forbiddenPhrases: ["little did they know", "what happened next", "you won't believe"],
		sentencesPerHundredWords: 11.5,
	},
	second_person_immersive: {
		key: "second_person_immersive",
		label: "Second-person immersive",
		person: "second",
		tense: "present",
		sentenceRhythm: "Sensory clause chains. Body before meaning.",
		concreteness: "Report what the body senses before naming what it means.",
		figuration: "low",
		addressesViewer: true,
		openingMove: "Open inside the body, mid-experience, before any explanation.",
		forbiddenMoves: [
			"naming the emotion outright",
			"explaining the metaphor",
			"stepping outside the body to comment",
		],
		forbiddenPhrases: ["imagine if", "picture this", "close your eyes"],
		sentencesPerHundredWords: 8.7,
	},
	socratic_plain: {
		key: "socratic_plain",
		label: "Socratic plain",
		person: "third_close",
		tense: "present",
		sentenceRhythm: "A question, then a plain answer. One idea per sentence.",
		concreteness: "Define every term at first use. Prefer an example to a definition.",
		figuration: "low",
		addressesViewer: true,
		openingMove: "Open on the question the viewer does not yet know they have.",
		forbiddenMoves: [
			"jargon before its definition",
			"answering a question the section never asked",
		],
		forbiddenPhrases: ["simply", "quite simple", "as we all know", "obviously"],
		sentencesPerHundredWords: 9.3,
	},
	essayistic_reflective: {
		key: "essayistic_reflective",
		label: "Essayistic reflective",
		person: "third_distant",
		tense: "present",
		sentenceRhythm:
			"Long sentences that turn mid-clause. Comma-heavy. Rare short sentence for weight.",
		concreteness: "Ground each abstraction in one specific instance before leaving it.",
		figuration: "moderate",
		addressesViewer: false,
		openingMove: "Open on the observation the essay will complicate.",
		forbiddenMoves: ["listicle cadence", "summary paragraph restating the section"],
		forbiddenPhrases: ["here's the thing", "at the end of the day", "needless to say"],
		sentencesPerHundredWords: 8,
	},
	direct_benefit: {
		key: "direct_benefit",
		label: "Direct benefit",
		person: "second",
		tense: "present",
		sentenceRhythm: "Claim, proof, consequence. Verbs first.",
		concreteness: "Every claim names the thing it is about and what it does.",
		figuration: "none",
		addressesViewer: true,
		openingMove: "Open on the outcome, not the setup.",
		forbiddenMoves: [
			"superlative without proof",
			"claiming a benefit the section does not demonstrate",
		],
		forbiddenPhrases: ["game-changing", "revolutionary", "unlock the power", "supercharge"],
		sentencesPerHundredWords: 10,
	},
	procedural_precise: {
		key: "procedural_precise",
		label: "Procedural precise",
		person: "second",
		tense: "present",
		sentenceRhythm: "Imperative. One action per sentence.",
		concreteness: "Name every object acted on. State what the result looks like.",
		figuration: "none",
		addressesViewer: true,
		openingMove: "Open on the first action, not on what the guide will cover.",
		forbiddenMoves: ["skipping a step as self-evident", "describing the result before the action"],
		forbiddenPhrases: ["just", "simply", "obviously", "all you have to do"],
		sentencesPerHundredWords: 10.2,
	},
	wry_conversational: {
		key: "wry_conversational",
		label: "Wry conversational",
		person: "second",
		tense: "present",
		sentenceRhythm: "Varied length. A dry aside every third or fourth sentence.",
		concreteness: "Specific enough that the aside has something to land on.",
		figuration: "low",
		addressesViewer: true,
		openingMove: "Open on the specific, slightly absurd detail.",
		forbiddenMoves: ["forced enthusiasm", "an aside that explains its own joke"],
		forbiddenPhrases: ["trust me", "let that sink in", "spoiler alert", "plot twist"],
		sentencesPerHundredWords: 11.8,
	},
};

/** Every profile, in library order. */
export function writerStyleProfiles(): readonly WriterStyleProfile[] {
	return WRITER_STYLES.map((key) => PROFILES[key]);
}

/* Resolve a stored key to its profile.
 *
 * Absent and unknown both yield `undefined`, and neither throws. A workspace stores
 * the KEY, so a profile can be corrected or retired in this file without migrating
 * stored workspaces — and a retired key must degrade to "no writer style" rather
 * than making an existing workspace unloadable. */
export function resolveWriterStyle(key: string | undefined): WriterStyleProfile | undefined {
	const matched = oneOf(key, WRITER_STYLES);
	return matched ? PROFILES[matched] : undefined;
}

function normalizePhrase(value: string): string {
	return value
		.toLocaleLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

/* The profile's forbidden phrases that appear in this narration.
 *
 * Word-boundary matched on a normalized copy of both sides, the same way
 * `bibleSubjectsNamedIn` matches subject aliases: found regardless of case or
 * surrounding punctuation, but "just" does not match "adjusted".
 *
 * A REPORT, never a gate. The caller surfaces these for operator judgment; nothing
 * downstream fails a section or blocks generation over one. Returns the phrases as
 * written in the profile, so a warning names what the operator would search for. */
export function forbiddenPhraseHits(
	narration: string,
	profile: WriterStyleProfile | undefined,
): string[] {
	if (!profile) return [];
	const haystack = ` ${normalizePhrase(narration)} `;
	return profile.forbiddenPhrases.filter((phrase) => {
		const needle = normalizePhrase(phrase);
		return needle.length > 0 && haystack.includes(` ${needle} `);
	});
}
