/* Story beat → image prompt intent. Deterministic, model-free, pure.
 *
 * This replaces a prose concatenation. The old path glued the authored visual,
 * the routed Visual and Rules layers, the template guidance and the style summary
 * into one string and handed the whole thing to `scene.visualMoment` — leaving
 * `subjectLocks`, `style`, `lightingColor` and `constraints` empty and the story's
 * own negatives buried inside the scene prose, where an image model reads them as
 * things to draw rather than things to avoid.
 *
 * Every field below has exactly one source:
 *
 *   style / lightingColor / negative  ← StoryBible   (identical on every beat)
 *   scene / composition               ← BeatVisualIntent (what varies)
 *   subjectLocks                      ← bible subjects, bound to resolved refs
 *   constraints                       ← Visual material, then Rules (Rules win)
 *
 * The layer-order contract that `material-layers.ts` owns — "rules layer LAST,
 * because a constraint appearing after the guidance it constrains reads as an
 * override" — survives here as field precedence: Visual fills `mustInclude`,
 * Rules fills `mustAvoid`, and a Rules entry removes any `mustInclude` it
 * contradicts. Same contract, expressed as assignment rather than string order. */
import type { BeatVisualIntent } from "./beat-visual-intent.ts";
import type { StoryBible, StoryBibleSubject } from "./story-bible.ts";
import type {
	ImagePromptIntent,
	ImagePromptReference,
	ImageSubjectLock,
} from "./image-prompt-intent.ts";
import { resolveMaterialMentions, type MentionableReference } from "./project-materials.ts";

export interface StoryBeatCompileInput {
	bible?: StoryBible;
	beat: BeatVisualIntent;
	/** Already-resolved provider references, ordered for binding. */
	references?: readonly ImagePromptReference[];
	aspect?: string;
	/** Project Visual material — what every frame should carry. */
	visual?: string;
	/** Project Rules material — hard constraints, never softened. */
	rules?: string;
	/** Template image guidance, already resolved against the section. */
	guidance?: string;
	/** Roster, so `@mention` syntax never reaches the provider. */
	roster?: readonly MentionableReference[];
}

function clean(value: string | undefined): string {
	return (value ?? "").replace(/\s+/g, " ").trim();
}

/** Split a material's prose into the constraint lines a compiler can carry.
 *
 *  Materials are authored as short directives, one per line or sentence. Splitting
 *  keeps each as its own constraint rather than one paragraph in a field that
 *  expects a list — which is what made the previous path's guidance read as
 *  narrative. */
function materialLines(
	value: string | undefined,
	roster: readonly MentionableReference[],
): string[] {
	if (!value?.trim()) return [];
	// Split BEFORE collapsing whitespace: the line break is the author's own
	// separator, and `clean` would have erased it into a space first.
	return resolveMaterialMentions(value, roster)
		.text.split(/\n+|;|(?<=\.)\s+/g)
		.map((line) => clean(line).replace(/\.$/, ""))
		.filter(Boolean);
}

/* Constraints are authored as prohibitions ("no human hands", "avoid text") and
 * compiled into a field the renderer already labels `Avoid:`. Carrying the word
 * through produces "Avoid: no human hands" — a double negative, which is the one
 * reading an image model must not take. So the marker is stripped on the way into
 * `mustAvoid`, and its presence is what MOVES a wrongly-placed entry there.
 *
 * This is not cosmetic. The real bible for the bee story returned "no modern
 * objects" as a LOCATION DESCRIPTOR, which landed under `Must include:` — the
 * prompt asked the provider to include no-modern-objects. */
const NEGATION = /^(?:no|not|never|avoid|without|non)\b[\s:,-]*/iu;

function isProhibition(value: string): boolean {
	return NEGATION.test(value.trim());
}

function asProhibition(value: string): string {
	return clean(value).replace(NEGATION, "") || clean(value);
}

function normalizeForConflict(value: string): string {
	return value
		.toLocaleLowerCase()
		.replace(NEGATION, "")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

/* A Rules entry wins over a Visual entry describing the same thing.
 *
 * "Rules last" in the prose layering meant the model read the constraint after
 * the guidance and treated it as an override. Field precedence has to say the
 * same thing explicitly: a `mustInclude` the rules contradict is dropped, not
 * left for the provider to reconcile against its own `mustAvoid`. */
function withoutRuledOut(include: readonly string[], avoid: readonly string[]): string[] {
	const ruled = avoid.map(normalizeForConflict).filter(Boolean);
	return include.filter((entry) => {
		const normalized = normalizeForConflict(entry);
		return !ruled.some(
			(rule) => rule === normalized || normalized.includes(rule) || rule.includes(normalized),
		);
	});
}

/** The locked identity for one bible subject.
 *
 *  Where the subject carries a `refKey` that resolved to a provider reference, the
 *  REFERENCE's description is the locked identity and the bible descriptors are
 *  additive detail — the rule `generation-prompt-composition` already states.
 *  Where it did not, the bible is all there is. */
function subjectLock(
	subject: StoryBibleSubject,
	references: readonly ImagePromptReference[],
): ImageSubjectLock {
	const ref = subject.refKey
		? references.find(
				(candidate) =>
					candidate.entityId === subject.refKey || clean(candidate.label) === clean(subject.label),
			)
		: undefined;
	const descriptors = [ref?.description, ...subject.descriptors].map(clean).filter(Boolean);
	return {
		source: ref ? "reference" : "material",
		...(ref?.role && ref.role !== "style" ? { role: ref.role } : {}),
		label: clean(subject.label),
		descriptors: [...new Set(descriptors)],
		mustAvoid: subject.mustAvoid.map(clean).filter(Boolean),
		...(ref?.entityId ? { referenceId: ref.entityId } : {}),
	};
}

/** Compile one beat into provider-facing image intent.
 *
 *  Pure: same inputs, same output, no IO and no model call. That is what makes the
 *  story path testable at the field level instead of by reading a paragraph. */
export function buildStoryBeatIntent(input: StoryBeatCompileInput): ImagePromptIntent {
	const { bible, beat } = input;
	const references = input.references ?? [];
	const roster = input.roster ?? [];

	/* Only the subjects this beat actually casts. A section-wide subject list on
	 * every beat is how a two-hander turns into a crowd scene: the provider draws
	 * what the prompt names, and naming everyone names everyone. */
	const cast = (bible?.subjects ?? []).filter((subject) => beat.subjectIds.includes(subject.id));
	const location = bible?.locations.find((candidate) => candidate.id === beat.locationId);

	/* Anything phrased as a prohibition is a prohibition, wherever it was authored.
	 * A location descriptor reading "no modern objects" belongs under Avoid, not
	 * under Must include — the field it was written into is a weaker signal than
	 * the words themselves. */
	const included: string[] = [];
	const prohibited: string[] = [];
	for (const entry of [
		...materialLines(input.visual, roster),
		...materialLines(input.guidance, roster),
		...(location ? location.descriptors.map(clean) : []),
		...beat.mustInclude.map(clean),
	].filter(Boolean)) {
		(isProhibition(entry) ? prohibited : included).push(entry);
	}

	const mustAvoid = [
		...materialLines(input.rules, roster),
		...beat.mustAvoid.map(clean),
		...prohibited,
	]
		.filter(Boolean)
		.map(asProhibition);
	const mustInclude = withoutRuledOut(included, mustAvoid);

	/* The moment alone. The location used to be appended as ", in <label>", which
	 * on a real story spliced an Indonesian place name into an otherwise English
	 * prompt and left doubled punctuation where the moment already ended in a full
	 * stop. The place still reaches the provider — as its descriptors, under
	 * Must include, in the language the rest of the prompt is written in. */
	const sceneParts = [clean(beat.visualMoment).replace(/\.$/, "")];

	return {
		output: { kind: "single-image", aspect: input.aspect, fullFrame: true },
		subjectLocks: cast.map((subject) => subjectLock(subject, references)),
		scene: {
			visualMoment:
				resolveMaterialMentions(sceneParts.join(", "), roster).text || clean(beat.visualMoment),
			...(clean(beat.action) ? { action: clean(beat.action).replace(/\.$/, "") } : {}),
			...(clean(beat.endState) ? { endState: clean(beat.endState).replace(/\.$/, "") } : {}),
		},
		composition: {
			// The camera the beat asked for, else the story's default. No hardcoded
			// "Medium Shot": that default is why every story shot looked the same
			// distance from its subject regardless of what the planner asked for.
			...(clean(beat.shotType) || clean(bible?.cameraLanguage?.defaultShot)
				? { shotType: clean(beat.shotType) || clean(bible?.cameraLanguage?.defaultShot) }
				: {}),
			...(clean(beat.cameraAngle) ? { cameraAngle: clean(beat.cameraAngle) } : {}),
			...(clean(beat.framing) ? { framing: clean(beat.framing) } : {}),
		},
		style: {
			...(clean(bible?.medium) ? { medium: clean(bible?.medium) } : {}),
			...(clean(bible?.realism) ? { realism: clean(bible?.realism) } : {}),
			...(clean(bible?.visualTreatment) ? { visualTreatment: clean(bible?.visualTreatment) } : {}),
		},
		lightingColor: {
			...(clean(bible?.lighting) ? { lighting: clean(bible?.lighting) } : {}),
			...(clean(bible?.palette) ? { palette: clean(bible?.palette) } : {}),
			// A beat's own mood overrides the story default; everything else in the
			// look is the story's and cannot be moved by a beat.
			...(clean(beat.mood) || clean(bible?.moodDefault)
				? { mood: clean(beat.mood) || clean(bible?.moodDefault) }
				: {}),
		},
		constraints: { mustInclude: [...new Set(mustInclude)], mustAvoid: [...new Set(mustAvoid)] },
		negative: [...new Set((bible?.negatives ?? []).map(clean).filter(Boolean))],
		references: [...references],
	};
}
