/* Longform narration-first video: pure timing + layout helpers.
 *
 * Timing is driven by REAL generated audio duration (measured from the TTS
 * bytes), never word-count estimates. Word count is only a planning hint before
 * audio exists. Sections whose TTS failed (no audioDurationSec) stay "pending"
 * and are excluded from the timeline — they never corrupt placed clips. */
export { measureAudioDurationSec, measureWavDurationSec } from "./audio-duration.ts";
import {
	STORY_TITLE_ID_BASE,
	wordsPerSecWithBreaths,
	type NarrationBreathRate,
} from "@maleo/shared";

/* The plan's SHAPES belong to the run contract — the editor renders and edits
 * the plan. The generation logic that fills them stays here. */
import type {
	SourceEvidence,
	StoryVoiceSegment,
	StoryVisualSegment,
	StorySection,
} from "@maleo/shared/agent-wire";
export type {
	SourceEvidence,
	CitationStatus,
	SectionStatus,
	StoryVoiceSegment,
	StoryVisualSegment,
	StorySection,
} from "@maleo/shared/agent-wire";

// Per-section lifecycle for recovery + the plan view. draft = scripted, not yet
// approved/generated; pending = approved, awaiting assets; voicing/imaging = in
// progress; ready = audio measured (placeable); failed = generation error (kept,
// retryable — never discarded).
/* `breath` is the narration style's sentence density, which spends part of the
 * target on inserted silence rather than on speech. Omitted, the budget is exactly
 * what it was before writer styles existed. */
export function wordBudgetForTarget(targetSec: number, breath?: NarrationBreathRate): number {
	return Math.max(1, Math.round(targetSec * wordsPerSecWithBreaths(WORDS_PER_SEC, breath)));
}

// Even split of a word budget across N sections (last absorbs the remainder).
export function distributeWordBudget(totalWords: number, sectionCount: number): number[] {
	const n = Math.max(1, sectionCount);
	const per = Math.floor(totalWords / n);
	return Array.from({ length: n }, (_, i) => (i === n - 1 ? totalWords - per * (n - 1) : per));
}

// Plan-table rows from ESTIMATED timing (before any audio exists) so chat can show
// the script + rough timeline at plan time. Once audio is measured use
// longformTableRows (measured) instead.
export function storyPlanTableRows(
	sections: StorySection[],
): Array<{ startSec: number; endSec: number; content: string; kind: "scene" }> {
	let cursor = 0;
	return sections.map((s) => {
		const dur = s.audioDurationSec ?? s.estimatedDurationSec;
		const startSec = Math.round(cursor * 1000) / 1000;
		cursor = startSec + dur;
		const tag = s.status && s.status !== "draft" ? ` [${s.status}]` : "";
		// The emotion drives this section's background-music cue, so surfacing it here
		// is what lets an operator tell a bad template mapping from a bad section label
		// when a chapter sounds wrong. Sections without one render exactly as before.
		const emotion = s.emotion ? ` [${s.emotion}]` : "";
		/* The section's job in the arc, and what that job obliges it to do. Without
		 * it every row reads as a structurally identical label, which is exactly what
		 * an operator cannot review — a plan table that says only "Section 4" cannot
		 * tell them whether section 4 is the one that is supposed to turn. */
		const chapter = s.chapterFunction ? ` [${s.chapterFunction}]` : "";
		const obligation = s.chapterObligation ? ` (${s.chapterObligation})` : "";
		const undrafted = s.needsDrafting ? " [needs drafting]" : "";
		const body = s.narration.slice(0, 70);
		return {
			startSec,
			endSec: Math.round(cursor * 1000) / 1000,
			content: `${s.title}${tag}${chapter}${emotion}${undrafted}${obligation} — ${body}${s.narration.length > 70 ? "…" : ""}`,
			kind: "scene" as const,
		};
	});
}

// Minimal scene shape the agent timeline consumes (subset of AgentScene). No
// audioUrl: the voiceover is emitted as a separate audio overlay (so it persists
// as a real audio:* clip and the client doesn't double-create it from the scene).
export interface StoryScene {
	name: string;
	/** Explicit section-boundary marker used by scene-entry SFX placement. */
	sectionStart?: boolean;
	/** The plan section this scene was generated from.
	 *
	 *  A plan is written in sections; the scenes are a flat list. This is what
	 *  survives that flattening, and it is what every chapter derivation groups on
	 *  — `runKeyOf` prefers it over the story beat. Without it a whole video
	 *  collapses into one chapter, which is what happened to every project
	 *  generated through this path before it was recorded. */
	sectionId?: string;
	storyBeatId?: string;
	sourceRevisionId?: string;
	/** `section_intro` on the shot that OPENS a section. A derived chapter takes
	 *  its title from this scene's name; without it the chapter is named
	 *  positionally, "Chapter 1". */
	sceneKind?: "section_intro" | "storyboard";
	durationSec: number;
	/** Semantic beat duration excluding structural section lead-in/gap. */
	contentDurationSec?: number;
	shot: string;
	move: string;
	transition: string;
	transitionLocked?: boolean;
	visual: string;
	voiceover: string;
	image?: string;
	/** The validated `{url, quote}` pairs backing this scene's narration, carried
	 *  from the plan section. Present only on the shot that holds the words. */
	sourceEvidence?: SourceEvidence[];
}

// Minimal audio-overlay shape (subset of AgentAudioOverlay).
export interface LongformAudioOverlay {
	id: number;
	kind: "voiceover";
	origin?: "tts";
	content: string;
	url: string;
	voice?: string;
	startSec: number;
	durationSec: number;
	track: number;
	originalDur: number;
	mediaStartSec?: number;
	words?: Array<{ text: string; startSec: number; endSec: number }>;
}

const WORDS_PER_SEC = 2.6;

/** Silent beat inserted between consecutive sections so the voiceover doesn't run
 *  back-to-back. The previous section's last visual holds through the gap (no cut to
 *  black), the audio overlay keeps its real duration, so the gap reads as a natural
 *  breath at each section boundary. Applied between sections only, never after the last. */
export const STORY_SECTION_PAUSE_SEC = 0.6;
export const STORY_TIMELINE_LANES = {
	voiceover: 0,
	sfx: 1,
	music: 2,
	introMotion: 3,
} as const;

/** Planning-only draft duration from word count. NOT final timing. */
export function estimateDurationFromWords(text: string): number {
	const words = text.trim().split(/\s+/).filter(Boolean).length;
	return Math.max(1, Math.round((words / WORDS_PER_SEC) * 10) / 10);
}

/** A section is placeable once its real audio duration is known. */
/** How long a section occupies the timeline.
 *
 *  Narrated sections are timed by MEASURED audio — a planner's word count is a
 *  hint, the generated voiceover is the truth. But a beat-structure section can
 *  legitimately have nothing to say, and then there is no audio to measure, so
 *  its planned duration is the only timing that exists.
 *
 *  The distinction is narration, not audio: a section that HAS narration but no
 *  audio yet is mid-generation or failed, and must stay unplaced rather than
 *  silently fall back to an estimate. */
export function sectionDurationSec(s: StorySection): number {
	if (typeof s.audioDurationSec === "number" && s.audioDurationSec > 0) return s.audioDurationSec;
	if (s.narration.trim()) return 0;
	return Math.max(0, s.estimatedDurationSec ?? 0);
}

export function isSectionPlaced(s: StorySection): boolean {
	return sectionDurationSec(s) > 0;
}

/** Assign absolute voiceover starts from measured audio. Every placed section gets
 *  its own lead-in silence; later sections also follow the inter-section pause. Pending sections (no
 *  audio) get startSec undefined and do not advance the cursor. Pure — re-run after a
 *  regenerated voiceover to resync everything. The pause defaults to
 *  STORY_SECTION_PAUSE_SEC so internal re-placement (build* helpers) stays
 *  consistent with the orchestrator's pre-placement. */
export function placeSections(
	sections: StorySection[],
	pauseSec = STORY_SECTION_PAUSE_SEC,
	leadInSec = 0,
): StorySection[] {
	let cursor = Math.max(0, leadInSec);
	const placedCount = sections.filter(isSectionPlaced).length;
	let placedIndex = 0;
	return sections.map((s) => {
		if (!isSectionPlaced(s)) return { ...s, startSec: undefined };
		const startSec = Math.round(cursor * 1000) / 1000;
		placedIndex++;
		cursor =
			startSec +
			sectionDurationSec(s) +
			(placedIndex < placedCount ? pauseSec + Math.max(0, leadInSec) : 0);
		return { ...s, startSec };
	});
}

/** Total video duration = end of the last placed audio. */
export function storyTotalDurationSec(
	sections: StorySection[],
	pauseSec = STORY_SECTION_PAUSE_SEC,
	leadInSec = 0,
): number {
	return placeSections(sections, pauseSec, leadInSec).reduce((max, s) => {
		if (!isSectionPlaced(s) || s.startSec == null) return max;
		return Math.max(max, s.startSec + sectionDurationSec(s));
	}, 0);
}

/** Ordered image urls actually generated for a section (imageUrls, else the legacy
 *  single imageUrl, else none). */
export function sectionImageUrls(s: StorySection): string[] {
	if (s.imageUrls?.length) return s.imageUrls;
	return s.imageUrl ? [s.imageUrl] : [];
}

/** Split a section's measured audio across N images. Each slice is >=1s (persist
 *  bumps sub-1s clips to 1s, which would desync the voiceover), so the image count
 *  is capped at floor(audioSec). Slices sum exactly to audioSec (last absorbs the
 *  rounding remainder) so the packed scenes line up under the single voiceover. */
export function splitSectionDurations(audioSec: number, imageCount: number): number[] {
	const k = Math.max(1, Math.min(imageCount, Math.floor(audioSec) || 1));
	const base = Math.round((audioSec / k) * 1000) / 1000;
	const out = Array.from({ length: k }, () => base);
	out[k - 1] = Math.round((audioSec - base * (k - 1)) * 1000) / 1000;
	return out;
}

/* ──── Semantic sync: shot timing from narration sentence groups ──── */

const ROUND_MS = (n: number): number => Math.round(n * 1000) / 1000;

/** Split narration into sentences (keep order; collapse whitespace). */
export function splitSentences(text: string): string[] {
	return (text || "")
		.replace(/\s+/g, " ")
		.trim()
		.split(/(?<=[.!?…])\s+/)
		.map((s) => s.trim())
		.filter(Boolean);
}

function wordCount(s: string): number {
	return s.split(/\s+/).filter(Boolean).length;
}

function tokenSet(s: string): Set<string> {
	return new Set(
		s
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, " ")
			.split(/\s+/)
			.filter((w) => w.length > 2),
	);
}

function tokenOverlap(a: Set<string>, b: Set<string>): number {
	let n = 0;
	for (const w of a) if (b.has(w)) n++;
	return n;
}

/** Assign each sentence (in order) to a shot index 0..count-1, monotonically. When
 *  per-shot `cues` are given and cover every shot, sentences are matched to the cue
 *  they overlap most (never moving backwards); otherwise sentences are split into
 *  `count` balanced contiguous groups. Guarantees every shot gets >=1 sentence. */
export function assignSentencesToShots(
	sentences: string[],
	count: number,
	cues?: string[],
): number[] {
	const n = sentences.length;
	if (count <= 1 || n === 0) return sentences.map(() => 0);
	if (n <= count) return sentences.map((_, i) => Math.min(i, count - 1));

	if (cues && cues.length === count && cues.every((c) => c && c.trim())) {
		const cueSets = cues.map(tokenSet);
		const assign: number[] = [];
		let prev = 0;
		for (const sent of sentences) {
			const ts = tokenSet(sent);
			let best = prev;
			let bestScore = 0;
			for (let i = prev; i < count; i++) {
				const sc = tokenOverlap(ts, cueSets[i]!);
				if (sc > bestScore) {
					bestScore = sc;
					best = i;
				}
			}
			prev = best; // monotonic — shots stay in narration order
			assign.push(prev);
		}
		if (new Set(assign).size === count) return assign; // every shot covered
	}

	// Balanced contiguous groups (every shot non-empty since n > count).
	const base = Math.floor(n / count);
	const rem = n % count;
	const out: number[] = [];
	for (let g = 0; g < count; g++) {
		const size = base + (g < rem ? 1 : 0);
		for (let k = 0; k < size; k++) out.push(g);
	}
	return out;
}

/** Split narration into contiguous sentence groups matching generated visual shots. */
export function narrationSegmentsForShots(
	narration: string,
	shotCount: number,
	cues?: string[],
): string[] {
	const sentences = splitSentences(narration);
	if (!sentences.length) return narration.trim() ? [narration.trim()] : [];
	const count = Math.max(1, Math.min(Math.round(shotCount) || 1, sentences.length));
	const assignment = assignSentencesToShots(sentences, count, cues?.slice(0, count));
	const groups = Array.from({ length: count }, (): string[] => []);
	assignment.forEach((shot, index) => groups[Math.min(shot, count - 1)]!.push(sentences[index]!));
	return groups.map((group) => group.join(" ").trim()).filter(Boolean);
}

export type NarrationBoundary = "technical" | "clause" | "sentence";
export interface MeasuredNarrationPart {
	text: string;
	startSec: number;
	durationSec: number;
	/** Semantic boundary following this window. Used for narrative breathing. */
	boundaryAfter: NarrationBoundary;
}

export interface NarrationSynthesisPart {
	text: string;
	/** Semantic boundary following this independently synthesized file. */
	boundaryAfter: NarrationBoundary;
}

function clauseUnits(text: string): string[] {
	return splitSentences(text).flatMap((sentence) => {
		const clauses = sentence
			.split(/(?<=[,;:—–])\s+/u)
			.map((part) => part.trim())
			.filter(Boolean);
		return clauses.length ? clauses : [sentence];
	});
}

export function narrationBoundaryAfter(text: string): NarrationBoundary {
	const clean = text.trim().replace(/["')\]}]+$/u, "");
	if (/[.!?…]$/u.test(clean)) return "sentence";
	if (/[,;:—–]$/u.test(clean)) return "clause";
	return "technical";
}

/** Split measured speech at semantic boundaries while preserving every source
 * millisecond. Timing uses measured duration distributed by spoken-word weight;
 * long clauses fall back to balanced word groups. */
export function splitMeasuredNarration(
	text: string,
	durationSec: number,
	maxSec: number,
): MeasuredNarrationPart[] {
	const clean = text.replace(/\s+/g, " ").trim();
	const duration = Math.max(0, durationSec);
	const limit = Math.max(0.1, maxSec);
	if (!clean || duration <= limit)
		return clean
			? [
					{
						text: clean,
						startSec: 0,
						durationSec: ROUND_MS(duration),
						boundaryAfter: narrationBoundaryAfter(clean),
					},
				]
			: [];
	const allWords = clean.split(/\s+/).filter(Boolean);
	const maxWords = Math.max(1, Math.floor((allWords.length * limit) / duration));
	const atoms = clauseUnits(clean).flatMap((unit) => {
		const unitWords = unit.split(/\s+/).filter(Boolean);
		if (unitWords.length <= maxWords) return [unit];
		const count = Math.ceil(unitWords.length / maxWords);
		const size = Math.ceil(unitWords.length / count);
		return Array.from({ length: count }, (_, index) =>
			unitWords.slice(index * size, (index + 1) * size).join(" "),
		).filter(Boolean);
	});
	const groups: string[][] = [];
	let current: string[] = [];
	let currentWords = 0;
	for (const atom of atoms) {
		const count = wordCount(atom);
		if (current.length && currentWords + count > maxWords) {
			groups.push(current);
			current = [];
			currentWords = 0;
		}
		current.push(atom);
		currentWords += count;
	}
	if (current.length) groups.push(current);
	const totalWords =
		groups.reduce((sum, group) => sum + group.reduce((n, unit) => n + wordCount(unit), 0), 0) || 1;
	let cursor = 0;
	return groups.map((group, index) => {
		const partText = group.join(" ").trim();
		const partWords = group.reduce((sum, unit) => sum + wordCount(unit), 0);
		const remaining = Math.max(0, duration - cursor);
		const partDuration =
			index === groups.length - 1
				? remaining
				: Math.min(limit, (duration * partWords) / totalWords);
		const part = {
			text: partText,
			startSec: ROUND_MS(cursor),
			durationSec: ROUND_MS(partDuration),
			boundaryAfter: narrationBoundaryAfter(partText),
		};
		cursor += partDuration;
		return part;
	});
}

/** Plan semantic text files before TTS. Word rate is only a conservative packing
 * hint; measured oversized results are split again and re-synthesized. */
export function planNarrationSynthesis(
	text: string,
	maxSec: number,
	estimatedWordsPerSec = 2.4,
): NarrationSynthesisPart[] {
	const clean = text.replace(/\s+/g, " ").trim();
	if (!clean) return [];
	const estimatedDurationSec = wordCount(clean) / Math.max(0.5, estimatedWordsPerSec);
	return splitMeasuredNarration(clean, estimatedDurationSec, maxSec).map((part) => ({
		text: part.text,
		boundaryAfter: part.boundaryAfter,
	}));
}

/** Turn an oversized measured script into smaller semantic texts for fresh TTS.
 * Returned offsets are intentionally discarded: audio is never cut by estimates. */
export function splitNarrationForResynthesis(
	text: string,
	durationSec: number,
	maxSec: number,
): NarrationSynthesisPart[] {
	const clean = text.replace(/\s+/g, " ").trim();
	if (!clean) return [];
	const parts = splitMeasuredNarration(clean, durationSec, maxSec).map((part) => ({
		text: part.text,
		boundaryAfter: part.boundaryAfter,
	}));
	return parts.length > 1 && parts.every((part) => part.text.length < clean.length)
		? parts
		: [{ text: clean, boundaryAfter: narrationBoundaryAfter(clean) }];
}

/** Normalize already-generated clips without estimating speech in-points. Legacy
 * oversized files remain whole and outcome validation reports the limit breach;
 * only fresh TTS can safely enforce the max by semantic re-synthesis. */
export function splitStoryVoiceSegments(
	segments: readonly StoryVoiceSegment[],
	maxSec: number,
	defaultPauseSec = 0,
	sentencePauseSec = 0,
): StoryVoiceSegment[] {
	void maxSec;
	void sentencePauseSec;
	return segments.map((segment, segmentIndex) => ({
		...segment,
		sourceDurationSec:
			segment.sourceDurationSec ?? (segment.mediaStartSec ?? 0) + segment.audioDurationSec,
		mediaStartSec: segment.mediaStartSec ?? 0,
		pauseAfterSec: Math.max(
			0,
			segment.pauseAfterSec ?? (segmentIndex < segments.length - 1 ? defaultPauseSec : 0),
		),
	}));
}

/** Invalidate legacy proportional audio windows before another asset pass. Images
 * stay reusable; narration, captions, and visual timing must be rebuilt from fresh
 * whole-file TTS clips. */
export function invalidateEstimatedVoiceWindows(section: StorySection): boolean {
	const hasEstimatedWindows =
		section.voiceSegments?.some(
			(segment) =>
				(segment.mediaStartSec ?? 0) > 0.001 ||
				(segment.sourceDurationSec ?? segment.audioDurationSec) > segment.audioDurationSec + 0.01,
		) ?? false;
	if (!hasEstimatedWindows) return false;
	section.audioUrl = undefined;
	section.audioDurationSec = undefined;
	section.voiceSegments = undefined;
	section.visualSegments = undefined;
	section.sceneVoiceoverPauseSec = undefined;
	section.captionWords = undefined;
	section.error = undefined;
	section.startSec = undefined;
	section.status = "pending";
	return true;
}

/** Cut MEASURED narration into visual beats. Each beat carries the exact
 *  narration it illustrates and its real duration; what it SHOWS is authored per
 *  beat afterwards, once this count is known.
 *
 *  This deliberately does not take planned prompts. It used to, and mapped the
 *  beats onto them by token overlap — which meant the beat count (measured) and
 *  the prompt count (guessed at plan time) had to be reconciled, and the
 *  reconciliation reused prompts. With authoring downstream there is no
 *  assignment left to get wrong: `visualPrompt` is filled in by the caller, one
 *  authored visual per beat. */
export function buildStoryVisualSegments(
	voiceSegments: readonly StoryVoiceSegment[],
	maxVisualBeatSec: number,
): StoryVisualSegment[] {
	return voiceSegments.flatMap((voice, voiceSegmentIndex) => {
		const total = voice.audioDurationSec + Math.max(0, voice.pauseAfterSec ?? 0);
		return splitMeasuredNarration(voice.text, total, maxVisualBeatSec).map((part) => ({
			text: part.text,
			visualPrompt: "",
			durationSec: part.durationSec,
			voiceSegmentIndex,
		}));
	});
}

/** Per-shot durations that sum to the measured audio, proportional to the narration
 *  each shot covers (sentence groups) rather than an equal time split — so the image
 *  changes track the narration's beats. Falls back to an equal split when there's no
 *  sentence structure. Each slice stays >=1s; the longest absorbs the rounding delta. */
export function planShotDurations(
	narration: string,
	audioSec: number,
	imageCount: number,
	cues?: string[],
): number[] {
	const k = Math.max(1, Math.min(imageCount, Math.floor(audioSec) || 1));
	const sentences = splitSentences(narration);
	if (k <= 1 || sentences.length === 0) return splitSectionDurations(audioSec, k);

	const assign = assignSentencesToShots(sentences, k, cues?.slice(0, k));
	const shotWords = Array.from({ length: k }, () => 0);
	assign.forEach((shot, i) => {
		shotWords[shot] += Math.max(1, wordCount(sentences[i]!));
	});
	const totalWords = shotWords.reduce((a, b) => a + b, 0) || k;

	const durs = shotWords.map((w) => Math.max(1, (w / totalWords) * audioSec));
	const sum = durs.reduce((a, b) => a + b, 0);
	// Correct the proportional rounding/min-clamp drift on the longest slice so the
	// total stays exactly audioSec (it remains >=1 as the largest).
	const maxIdx = durs.indexOf(Math.max(...durs));
	durs[maxIdx] = Math.max(1, durs[maxIdx]! + (audioSec - sum));
	return durs.map(ROUND_MS);
}

// Deterministic camera motion so a longform plays like a video essay, not a static
// slideshow. The renderer maps these UI strings to Ken-Burns presets
// (packages/video/src/lib/motion-presets.ts). Each section opens on a slow zoom-in
// (establishing) and its later shots rotate through gentle pans/pushes so adjacent
// images never share the same move.
const LONGFORM_MOTIONS = [
	"Slow Pan Right",
	"Slight Push In",
	"Slow Zoom Out",
	"Slow Pan Left",
	"Tilt Up",
	"Slight Pull Out",
] as const;
export function storyMotion(sectionIndex: number, shotIndex: number): string {
	if (shotIndex === 0) return "Slow Zoom In";
	return LONGFORM_MOTIONS[(sectionIndex + shotIndex) % LONGFORM_MOTIONS.length]!;
}

// Shots within a section cross-fade gently; section boundaries use a more pronounced
// move so a chapter change is felt, not just seen. Boundary transitions rotate through
// a fixed sequence so consecutive chapters never repeat the same move — deterministic
// (same plan renders the same video), varied without randomness. All are renderer
// transition ids (packages/video/src/lib/transitions.ts).
export const STORY_SHOT_TRANSITION = "fade";
export const STORY_SECTION_TRANSITIONS = ["slide", "wipe", "zoom", "flip", "clock_wipe"] as const;
export function storySectionTransition(boundaryIndex: number): string {
	return STORY_SECTION_TRANSITIONS[boundaryIndex % STORY_SECTION_TRANSITIONS.length]!;
}

/** Build the agent scenes for placed sections, in order. A section with multiple
 *  images becomes multiple sequential image scenes that share one voiceover (the
 *  narration text rides the first sub-scene; the audio itself is a separate overlay
 *  spanning the whole section). Scenes pack sequentially in persist/toTimelineDoc,
 *  so the cumulative cursor stays aligned with the measured-audio voiceover. */
export function buildStoryScenes(
	sections: StorySection[],
	pauseSec = STORY_SECTION_PAUSE_SEC,
	leadInSec = 0,
	opts: { staticMovement?: boolean; transition?: string } = {},
): StoryScene[] {
	const placed = placeSections(sections, pauseSec, leadInSec).filter(isSectionPlaced);
	return placed.flatMap((s, sectionIndex) => {
		const imgs = sectionImageUrls(s);
		const visualSegments = s.visualSegments?.length ? s.visualSegments : undefined;
		const prompts =
			visualSegments?.map((segment) => segment.visualPrompt) ??
			(s.visualPrompts?.length ? s.visualPrompts : [s.visualPrompt]);
		const count = Math.max(1, imgs.length);
		// Duration per shot follows the narration's sentence groups (semantic sync),
		// not an equal time split — an image swaps when the narration reaches its beat.
		const segments = s.voiceSegments?.filter((segment) => segment.audioDurationSec > 0) ?? [];
		const pause = Math.max(0, s.sceneVoiceoverPauseSec ?? 0);
		const segmented =
			segments.length >= count
				? Array.from({ length: count }, () => ({ durationSec: 0, text: "" }))
				: null;
		if (segmented)
			segments.forEach((segment, segmentIndex) => {
				const target = segmented[Math.min(segmentIndex, count - 1)]!;
				target.durationSec +=
					segment.audioDurationSec +
					(segmentIndex < segments.length - 1 ? Math.max(0, segment.pauseAfterSec ?? pause) : 0);
				target.text = [target.text, segment.text].filter(Boolean).join(" ");
			});
		const durations =
			visualSegments?.length === count
				? visualSegments.map((segment) => ROUND_MS(segment.durationSec))
				: segmented
					? segmented.map((segment) => ROUND_MS(segment.durationSec))
					: planShotDurations(s.narration, sectionDurationSec(s), count, s.shotCues);
		const contentDurations = [...durations];
		if (leadInSec > 0) durations[0] = ROUND_MS(durations[0]! + leadInSec);
		// Hold this section's last visual through the inter-section pause (the voiceover
		// has ended; the gap is silent). Scenes pack sequentially in persist, so baking
		// the pause into the duration keeps the cursor aligned with the shifted audio start.
		if (pauseSec > 0 && sectionIndex < placed.length - 1) {
			durations[durations.length - 1] = ROUND_MS(durations[durations.length - 1]! + pauseSec);
		}
		const isLastSection = sectionIndex === placed.length - 1;
		const sourceRevisionId = s.voiceSegments?.[0]?.sourceRevisionId ?? s.frameSourceRevisionId;
		return durations.map((durationSec, i) => ({
			name: i === 0 ? s.title : `${s.title} · shot ${i + 1}`,
			sectionStart: i === 0,
			/* The section's identity, recorded HERE because this is the last place
			 * the section and the scene exist together — everything downstream sees
			 * a flat list. Reconstructing it later from `name` would mean grouping
			 * the video on a display string, where a rename silently re-chapters it.
			 *
			 * `sectionStart` above marks the same boundary but is pacing-local
			 * (read once, at `isInternalScene`), so the document-facing marker is
			 * the `sceneKind` the wire and `titleOf` already agree on. Both are set
			 * from the same expression, on adjacent lines, so they cannot drift
			 * without someone editing one and not the other. */
			sectionId: s.sectionId ?? s.id,
			storyBeatId: s.semanticBeatId,
			sourceRevisionId,
			...(i === 0 ? { sceneKind: "section_intro" as const } : {}),
			durationSec,
			contentDurationSec: contentDurations[i],
			shot: "Medium Shot",
			move: opts.staticMovement ? "Static" : storyMotion(sectionIndex, i),
			// A scene's transition plays into the NEXT scene. The last shot of a section
			// borders the next section, so it gets the pronounced chapter transition;
			// shots inside a section cross-fade gently. The final section's last shot is
			// unused by the renderer (no following scene).
			transition:
				opts.transition ??
				(i === count - 1 && !isLastSection
					? storySectionTransition(sectionIndex)
					: STORY_SHOT_TRANSITION),
			transitionLocked: opts.transition != null ? true : undefined,
			visual: prompts[i] ?? prompts[0] ?? s.visualPrompt,
			/* The citation rides the first sub-scene, for the same reason the
			 * voiceover does: a quote justifies NARRATION, and the narration is on
			 * shot 1. Shot 3 of the same section carries no words, so a citation
			 * there would be attached to nothing it supports.
			 *
			 * Without this the script view can never show a story plan's citations
			 * — the plan section holds validated `{url, quote}` pairs and the scene
			 * was dropping them here, so `scene.sourceEvidence` was always empty on
			 * the narrated path. */
			...(i === 0 && s.sourceEvidence?.length ? { sourceEvidence: s.sourceEvidence } : {}),
			// Voiceover text rides only the first sub-scene so it isn't duplicated;
			// the actual audio overlay spans the full section regardless.
			voiceover: visualSegments
				? visualSegments.findIndex(
						(segment) => segment.voiceSegmentIndex === visualSegments[i]!.voiceSegmentIndex,
					) === i
					? (s.voiceSegments?.[visualSegments[i]!.voiceSegmentIndex]?.text ??
						visualSegments[i]!.text)
					: ""
				: segmented
					? segmented[i]!.text
					: i === 0
						? s.narration
						: "",
			image: imgs[i],
		}));
	});
}

/** Voiceover overlays for placed sections, at absolute measured-audio timing.
 *  Emitted alongside the scenes so they persist as real audio:* clips. */
export function buildStoryAudioOverlays(
	sections: StorySection[],
	voice?: string,
	startId = 1000,
	pauseSec = STORY_SECTION_PAUSE_SEC,
	leadInSec = 0,
): LongformAudioOverlay[] {
	return placeSections(sections, pauseSec, leadInSec)
		.filter((s) => isSectionPlaced(s) && s.startSec != null && s.audioUrl)
		.flatMap((s, sectionIndex) => {
			const segments =
				s.voiceSegments?.filter((segment) => segment.audioUrl && segment.audioDurationSec > 0) ??
				[];
			if (segments.length) {
				let cursor = s.startSec!;
				const segmentPause = Math.max(0, s.sceneVoiceoverPauseSec ?? 0);
				return segments.map((segment, segmentIndex) => {
					const startSec = ROUND_MS(cursor);
					const endSec = startSec + segment.audioDurationSec;
					cursor =
						endSec +
						(segmentIndex < segments.length - 1
							? Math.max(0, segment.pauseAfterSec ?? segmentPause)
							: 0);
					const words = segment.captionWords
						?.map((word) => ({
							text: word.text,
							startSec: Math.max(startSec, ROUND_MS(startSec + word.startSec)),
							endSec: Math.min(endSec, ROUND_MS(startSec + word.endSec)),
						}))
						.filter((word) => word.text && word.endSec - word.startSec >= 0.08);
					return {
						id: startId + sectionIndex * 100 + segmentIndex,
						kind: "voiceover" as const,
						origin: "tts" as const,
						content: segment.text,
						url: segment.audioUrl,
						voice,
						startSec,
						durationSec: segment.audioDurationSec,
						track: STORY_TIMELINE_LANES.voiceover,
						originalDur: segment.sourceDurationSec ?? segment.audioDurationSec,
						mediaStartSec: segment.mediaStartSec,
						words: words?.length ? words : undefined,
					};
				});
			}
			const startSec = s.startSec!;
			const durationSec = s.audioDurationSec!;
			const endSec = startSec + durationSec;
			const words = s.captionWords?.length
				? s.captionWords
						.map((w) => ({
							text: w.text,
							startSec: Math.max(startSec, Math.round((startSec + w.startSec) * 1000) / 1000),
							endSec: Math.min(endSec, Math.round((startSec + w.endSec) * 1000) / 1000),
						}))
						.filter((w) => w.text && w.endSec - w.startSec >= 0.08)
				: undefined;
			return [
				{
					id: startId + sectionIndex,
					kind: "voiceover" as const,
					origin: "tts" as const,
					content: s.narration,
					url: s.audioUrl!,
					voice,
					startSec,
					durationSec,
					track: STORY_TIMELINE_LANES.voiceover,
					originalDur: durationSec,
					words,
				},
			];
		});
}

// Music-bed overlay shape (subset of AgentAudioOverlay). A bed spans one stretch of
// the video; the renderer ducks it under the voiceover overlays and swells it in the
// inter-section gaps so the pause reads as an intentional breath, not dead air.
export interface LongformMusicOverlay {
	id: number;
	kind: "music";
	origin?: "stock";
	content: string;
	url: string;
	startSec: number;
	durationSec: number;
	track: number;
	volume: number;
	fadeIn: number;
	fadeOut: number;
}

/** Long fade so the bed eases in/out rather than clicking on. Capped to a quarter of
 *  the video on short pieces. */
export const STORY_MUSIC_FADE_SEC = 1.5;

/** One stretch of the video covered by a single bed, as inclusive section indices.
 *  Structural on purpose so this module stays free of the resolver that produces
 *  them (see story-music.ts). */
export interface StoryMusicSpan {
	url: string | undefined;
	cue?: string;
	fromIndex: number;
	toIndex: number;
}

/** Background-music beds across the placed timeline, one per resolved span. A
 *  single span covering every section is the flat-bed case and produces exactly the
 *  overlay this function used to return on its own.
 *
 *  Beds butt-joint rather than overlap: each fades at its own boundaries, so the
 *  score changes cleanly without two clips fighting on one lane. Returns [] when
 *  nothing is placed yet; a span whose cue did not resolve is skipped, leaving that
 *  stretch silent instead of emitting a clip the renderer cannot play.
 *
 *  Beds play at full `volume` here; the per-frame ducking/swell mix is applied by
 *  the renderer (bedDuckEnvelope), driven by the voiceover overlays. */
export function buildStoryMusicBed(
	sections: StorySection[],
	spans: StoryMusicSpan[],
	opts: {
		id?: number;
		label?: string;
		pauseSec?: number;
		leadInSec?: number;
		volume?: number;
	} = {},
): LongformMusicOverlay[] {
	if (!spans.length) return [];
	const pauseSec = opts.pauseSec ?? STORY_SECTION_PAUSE_SEC;
	const leadInSec = opts.leadInSec ?? 0;
	const total = storyTotalDurationSec(sections, pauseSec, leadInSec);
	if (total <= 0) return [];
	const placed = placeSections(sections, pauseSec, leadInSec);
	// A span starts where its first section was placed — except the opening span,
	// which covers the lead-in too so the video never begins on silence.
	const spanStart = (index: number): number =>
		index === 0 ? 0 : (placed[spans[index]!.fromIndex]?.startSec ?? 0);
	const baseId = opts.id ?? 900;
	return spans.flatMap((span, index) => {
		if (!span.url) return [];
		const startSec = spanStart(index);
		const endSec = index === spans.length - 1 ? total : spanStart(index + 1);
		const durationSec = Math.round((endSec - startSec) * 1000) / 1000;
		if (durationSec <= 0) return [];
		const fade = Math.min(STORY_MUSIC_FADE_SEC, Math.round((durationSec / 4) * 1000) / 1000);
		return [
			{
				id: baseId + index,
				kind: "music" as const,
				origin: "stock" as const,
				content: opts.label ?? (span.cue ? `Background music: ${span.cue}` : "Background music"),
				url: span.url,
				startSec,
				durationSec,
				track: STORY_TIMELINE_LANES.music,
				volume: opts.volume ?? 1,
				fadeIn: fade,
				fadeOut: fade,
			},
		];
	});
}

/** The whole video as one span — the flat-bed case, and what a `single` policy
 *  template resolves to. */
export function singleMusicSpan(
	sections: StorySection[],
	url: string | undefined,
	cue?: string,
): StoryMusicSpan[] {
	return sections.length ? [{ url, cue, fromIndex: 0, toIndex: sections.length - 1 }] : [];
}

// Accent-hit (stinger) overlay shape (subset of AgentAudioOverlay). One short hit
// punctuates each section boundary so the chapter change is heard, not just seen.
export interface LongformAccentOverlay {
	id: number;
	kind: "accent_hit" | "sfx";
	origin?: "stock";
	content: string;
	url: string;
	startSec: number;
	durationSec: number;
	track: number;
	volume: number;
	fadeIn: number;
	fadeOut: number;
}

export const LONGFORM_ACCENT_SEC = 1.2;
export const STORY_ACCENT_VOLUME = 0.6;

/** Short accent at section entry. Template-driven builds include section one and use
 *  one resolved asset for every section so cue identity stays consistent. Legacy callers
 *  may omit section one. Returns [] when no stinger url is available. */
export function buildStoryAccentHits(
	sections: StorySection[],
	accentUrl: string | readonly string[] | undefined,
	opts: {
		startId?: number;
		label?: string;
		pauseSec?: number;
		leadInSec?: number;
		offsetSec?: number;
		volume?: number;
		includeFirst?: boolean;
	} = {},
): LongformAccentOverlay[] {
	const urls = (typeof accentUrl === "string" ? [accentUrl] : (accentUrl ?? [])).filter(Boolean);
	if (!urls.length) return [];
	const leadInSec = opts.leadInSec ?? 0;
	const placed = placeSections(
		sections,
		opts.pauseSec ?? STORY_SECTION_PAUSE_SEC,
		leadInSec,
	).filter((s) => isSectionPlaced(s) && s.startSec != null);
	const startId = opts.startId ?? 950;
	return placed.slice(opts.includeFirst ? 0 : 1).map((s, i) => ({
		id: startId + i,
		kind: "accent_hit" as const,
		origin: "stock" as const,
		content: opts.label ?? "Section accent",
		url: urls[0]!,
		startSec: Math.max(
			0,
			Math.round((s.startSec! - leadInSec + (opts.offsetSec ?? 0)) * 1000) / 1000,
		),
		durationSec: Math.round(Math.min(LONGFORM_ACCENT_SEC, s.audioDurationSec!) * 1000) / 1000,
		track: STORY_TIMELINE_LANES.sfx,
		volume: opts.volume ?? STORY_ACCENT_VOLUME,
		fadeIn: 0,
		fadeOut: Math.round(Math.min(LONGFORM_ACCENT_SEC, s.audioDurationSec!) * 1000) / 1000,
	}));
}

/** Scene-entry accents only for internal shots. Opening and first shot of every
 * section are skipped because section-entry accents already own those boundaries. */
export function buildStorySceneAccentHits(
	scenes: readonly StoryScene[],
	accentUrl: string | undefined,
	opts: { startId?: number; label?: string; volume?: number } = {},
): LongformAccentOverlay[] {
	if (!accentUrl) return [];
	const hits: LongformAccentOverlay[] = [];
	let cursor = 0;
	for (const scene of scenes) {
		const isInternalScene =
			scene.sectionStart === false ||
			(scene.sectionStart == null && !scene.voiceover && cursor > 0);
		if (isInternalScene) {
			const durationSec =
				Math.round(Math.min(LONGFORM_ACCENT_SEC, scene.durationSec) * 1000) / 1000;
			hits.push({
				// Ids start at 60m so they stay clear of the auto text bands (40m..50m).
				id: (opts.startId ?? 60_000_000) + hits.length,
				kind: "sfx",
				origin: "stock",
				content: opts.label ?? "Scene entry",
				url: accentUrl,
				startSec: Math.round(cursor * 1000) / 1000,
				durationSec,
				track: STORY_TIMELINE_LANES.sfx,
				volume: opts.volume ?? STORY_ACCENT_VOLUME,
				fadeIn: 0,
				fadeOut: durationSec,
			});
		}
		cursor += scene.durationSec;
	}
	return hits;
}

// Minimal text-overlay shape (subset of AgentTextOverlay) for animated section titles.
export interface LongformTextOverlay {
	id: number;
	content: string;
	startSec: number;
	durationSec: number;
	preset: string;
	layout: { xPct: number; yPct: number; widthPct: number; heightPct: number };
	track: number;
}

/** How long a section title card holds on screen — long enough to register as a chapter
 *  beat, capped so it never lingers; clamped to the section's own audio on short shots. */
export const STORY_TITLE_MAX_SEC = 4;
/** Renderer preset that styles the card as a bold chapter title (see textPresetStyle). */
export const STORY_TITLE_PRESET = "chapter";

/** One animated chapter card per section (at its measured start), so the viewer gets a
 *  clear, strong beat at each boundary instead of an unbroken stream of images. The
 *  renderer reveals it with a fade + rise and styles it via the "chapter" preset. Sits
 *  in a raised lower band so it reads big without burying the subject or the captions. */
export function buildStoryTitleOverlays(
	sections: StorySection[],
	opts: {
		track?: number;
		pauseSec?: number;
		leadInSec?: number;
		introPreset?: string;
		sectionPreset?: string;
		policy?: "none" | "first_only" | "every_section";
		durationSec?: number;
	} = {},
): LongformTextOverlay[] {
	const policy = opts.policy ?? "every_section";
	if (policy === "none") return [];
	const leadInSec = opts.leadInSec ?? 0;
	return placeSections(sections, opts.pauseSec ?? STORY_SECTION_PAUSE_SEC, leadInSec)
		.filter((s) => isSectionPlaced(s) && s.startSec != null)
		.filter((_, index) => policy === "every_section" || index === 0)
		.map((s, index) => ({
			id: STORY_TITLE_ID_BASE + index,
			content: s.title,
			startSec: Math.max(0, Math.round((s.startSec! - leadInSec) * 1000) / 1000),
			// An explicit template duration is authoritative. The legacy default remains
			// clamped to short sections so existing projects keep their prior behavior.
			durationSec:
				Math.round(
					(opts.durationSec == null
						? Math.min(STORY_TITLE_MAX_SEC, s.audioDurationSec! + leadInSec)
						: opts.durationSec) * 1000,
				) / 1000,
			preset:
				index === 0
					? (opts.introPreset ?? STORY_TITLE_PRESET)
					: (opts.sectionPreset ?? STORY_TITLE_PRESET),
			layout: { xPct: 6, yPct: 60, widthPct: 88, heightPct: 28 },
			track: opts.track ?? STORY_TIMELINE_LANES.introMotion,
		}))
		.filter((overlay) => Boolean(overlay.preset));
}

/** Storyboard-table rows (Timestamp | Section | Narration | Visual) for chat. */
export function longformTableRows(
	sections: StorySection[],
	pauseSec = STORY_SECTION_PAUSE_SEC,
): Array<{ startSec: number; endSec: number; content: string; kind: "scene" }> {
	return placeSections(sections, pauseSec)
		.filter((s) => isSectionPlaced(s) && s.startSec != null)
		.map((s) => ({
			startSec: s.startSec!,
			endSec: s.startSec! + s.audioDurationSec!,
			content: `${s.title} — ${s.narration.slice(0, 80)}${s.narration.length > 80 ? "…" : ""}`,
			kind: "scene" as const,
		}));
}
