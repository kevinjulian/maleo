/* Chapters: the container a run of scenes belongs to.
 *
 * A section and a chapter are the same thing. The agent's plan is section-first
 * and leaves `Scene.sectionId` behind when it flattens sections into scenes; the
 * script view renders those groupings and calls them chapters. There is one
 * membership field, not two — an earlier draft had `chapterId` beside `sectionId`
 * to keep "where it came from" apart from "where it is now", which protected a
 * value no consumer reads.
 *
 * What a chapter persists is its identity, title and brief. Its ORDER is the
 * position of its earliest scene and its running time and word count are computed
 * for display, so none of the three can go stale against the timeline the way a
 * persisted copy would.
 *
 * Documents written before chapters existed carry none, so `seedChapters` derives
 * them once on read: by `sectionId` where the agent left one, by runs of
 * `StoryBeat` otherwise, and finally one chapter for everything.
 */
import type { Chapter, TimelineDoc } from "./timeline-doc.ts";
import type { Scene } from "./timeline-model.ts";

/** One non-empty string field off a persisted value, or nothing.
 *
 *  Read the same way `storyboard-document.ts` reads a persisted property: no
 *  cast, because the payload is external and has no shape to assert — only
 *  fields worth checking one at a time. Never throws, like the rest of the read. */
function stringField(source: unknown, key: string): string | undefined {
	if (source === null || typeof source !== "object") return undefined;
	const value: unknown = Object.getOwnPropertyDescriptor(source, key)?.value;
	return typeof value === "string" && value ? value : undefined;
}

/** Parse persisted `chapters[]` defensively, the way markers are parsed: a
 *  chapter with a missing title still has to load. */
export function parseChapters(raw: unknown): Chapter[] {
	if (!Array.isArray(raw)) return [];
	const out: Chapter[] = [];
	for (const entry of raw) {
		if (!entry || typeof entry !== "object") continue;
		const id = stringField(entry, "id");
		if (!id) continue;
		out.push({ id, title: stringField(entry, "title") ?? id, brief: stringField(entry, "brief") });
	}
	return out;
}

/** The grouping key a run of scenes shares, or `undefined` when a scene supplies
 *  neither. Section membership wins over the beat, because it is what the plan
 *  actually decided rather than what a positional heuristic inferred. */
function runKeyOf(scene: Scene): string | undefined {
	if (scene.sectionId) return scene.sectionId;
	if (scene.beat) return `beat:${scene.beat}`;
	return undefined;
}

/** A chapter's title: the name of the scene that introduces it if there is one,
 *  else the beat it groups, else a positional fallback. */
function titleOf(run: Scene[], index: number): string {
	const intro = run.find((s) => s.sceneKind === "section_intro");
	if (intro?.name) return intro.name;
	const beat = run.find((s) => s.beat)?.beat;
	if (beat) return beat.charAt(0).toUpperCase() + beat.slice(1);
	return `Chapter ${index + 1}`;
}

/** Split scenes into runs of CONSECUTIVE scenes sharing a key.
 *
 *  Consecutive is the whole rule. A key that recurs after a different one starts a
 *  new run rather than rejoining the earlier one — merging non-adjacent scenes
 *  into one chapter would mean reordering the video to satisfy a grouping. A scene
 *  with no key joins the run before it, and only leads a run when it is first. */
function runsOf(scenes: readonly Scene[]): Scene[][] {
	const runs: Scene[][] = [];
	let key: string | undefined;
	for (const scene of scenes) {
		const next = runKeyOf(scene);
		if (runs.length === 0 || (next !== undefined && next !== key)) {
			runs.push([scene]);
			key = next;
			continue;
		}
		runs[runs.length - 1]!.push(scene);
	}
	return runs;
}

/** Where a chapter sits on the timeline: the span of the scenes that name it. */
export interface ChapterRange {
	id: string;
	title: string;
	startSec: number;
	endSec: number;
}

/** The chapters that have scenes, in timeline order, each spanning its scenes.
 *
 *  Both surfaces that mark chapters read this: the ruler puts a marker at
 *  `startSec`, and the rendered chapter pill covers the whole span. Deriving it
 *  from the clips rather than storing it is what keeps a chapter's position from
 *  disagreeing with the scenes it groups.
 *
 *  A chapter with no scenes is absent, because it has no position. That is not
 *  the same as it not existing — the script view still renders it, so an operator
 *  can write into a chapter before putting anything in it. */
export function chapterRanges(doc: TimelineDoc): ChapterRange[] {
	const titles = new Map((doc.chapters ?? []).map((c) => [c.id, c.title]));
	const spans = new Map<string, { startSec: number; endSec: number }>();
	for (const clip of doc.clips) {
		const id = clip.scene?.sectionId;
		if (!id) continue;
		const end = clip.startSec + clip.durationSec;
		const prior = spans.get(id);
		if (!prior) spans.set(id, { startSec: clip.startSec, endSec: end });
		else
			spans.set(id, {
				startSec: Math.min(prior.startSec, clip.startSec),
				endSec: Math.max(prior.endSec, end),
			});
	}
	return [...spans.entries()]
		.map(([id, span]) => ({ id, title: titles.get(id) ?? id, ...span }))
		.sort((a, b) => a.startSec - b.startSec);
}

export interface SeededChapters {
	chapters: readonly Chapter[];
	scenes: Scene[];
	/** True when seeding derived something. The caller uses this to avoid marking a
	 *  document dirty just because it was opened. */
	seeded: boolean;
}

/** Give a document's scenes chapters when it carries none.
 *
 *  A document that already has chapters is returned untouched, including one whose
 *  chapters were authored down to nothing — an operator who deleted every chapter
 *  should not have them grow back on the next read. Absence, not emptiness, is what
 *  triggers seeding. */
/** A section the plan recorded, as the document's unit lifecycle remembers it. */
export interface PlanSection {
	id: string;
	title: string;
}

/** The sections a document's unit lifecycle still records.
 *
 *  `unitLifecycle` is carried through the document as an opaque blob, so it is
 *  read one field at a time and never asserted, like every other external
 *  payload here. */
export function planSectionsOf(unitLifecycle: unknown): PlanSection[] {
	if (unitLifecycle === null || typeof unitLifecycle !== "object") return [];
	const units: unknown = Object.getOwnPropertyDescriptor(unitLifecycle, "units")?.value;
	if (!Array.isArray(units)) return [];
	const out: PlanSection[] = [];
	for (const unit of units) {
		if (stringField(unit, "granularity") !== "section") continue;
		const title = stringField(unit, "title");
		/* `sourceId` is the plan's own id ("sec-1"); `id` is namespaced
		 * ("section:sec-1"). Prefer the former so a recovered membership matches
		 * what a freshly generated project writes. */
		const id = stringField(unit, "sourceId") ?? stringField(unit, "id")?.replace(/^section:/, "");
		if (id && title) out.push({ id, title });
	}
	return out;
}

/** Recover section membership for scenes that never recorded it, by matching each
 *  scene's name against the section titles the plan left behind.
 *
 *  This is a REPAIR, not a grouping rule, and the distinction is the whole reason
 *  it is shaped this way. Grouping a document by parsing display strings would
 *  mean a rename silently re-chapters a video, which is why nothing derives that
 *  way. Recovering membership ONCE, for a document generated before its scenes
 *  recorded their section, is a different act: it writes the provenance down, and
 *  every read afterwards uses the real field.
 *
 *  It refuses rather than guesses. Returns null unless the sections account for
 *  every scene exactly once and each section's scenes sit together — the same
 *  contiguity a chapter means. A partial or interleaved match would invent a
 *  grouping the plan never described.
 *
 *  The first scene of each section is marked as its introduction, because that is
 *  where a derived chapter takes its title from. */
export function recoverSectionMembership(
	scenes: readonly Scene[],
	sections: readonly PlanSection[],
): Scene[] | null {
	if (scenes.length === 0 || sections.length === 0) return null;
	/* Longest title first, so "Bangun di Lilin" wins over a section merely called
	 * "Bangun" rather than the match depending on declaration order. */
	const ordered = [...sections].sort((a, b) => b.title.length - a.title.length);

	const assigned: string[] = [];
	for (const scene of scenes) {
		const name = (scene.name ?? "").trim();
		const hits = ordered.filter(
			(section) => name === section.title || name.startsWith(`${section.title} `),
		);
		/* Two sections matching the same scene at the same length is a genuine
		 * ambiguity — the names cannot say which it belongs to. */
		if (hits.length === 0) return null;
		if (hits.length > 1 && hits[0]!.title.length === hits[1]!.title.length) return null;
		assigned.push(hits[0]!.id);
	}

	/* Contiguity: a section whose scenes are interleaved with another's is not a
	 * chapter, and stamping it would make the next derivation split it anyway. */
	const seen = new Set<string>();
	for (let i = 0; i < assigned.length; i++) {
		if (i > 0 && assigned[i] === assigned[i - 1]) continue;
		if (seen.has(assigned[i]!)) return null;
		seen.add(assigned[i]!);
	}

	return scenes.map((scene, index) => ({
		...scene,
		sectionId: assigned[index],
		...(index === 0 || assigned[index] !== assigned[index - 1]
			? { sceneKind: "section_intro" as const }
			: {}),
	}));
}

/** Re-derive chapters from what the scenes carry NOW, discarding the ones the
 *  document holds.
 *
 *  The repair for a document whose chapters no longer describe it — most often
 *  one generated before its scenes recorded their section, which collapsed into a
 *  single chapter and then froze there, because `seedChapters` returns a non-null
 *  array untouched and a fixed generator cannot reach a document already written.
 *
 *  Deliberately NOT reachable from the read path. Seeding on read is guarded by
 *  absence for a reason — an operator who deleted every chapter must not have them
 *  grow back — and re-deriving whenever the chapters "look wrong" would overwrite
 *  that decision to work around a generator bug, during a read, which nobody
 *  asked to write. So this is a separate function an explicit action calls, and it
 *  reuses the same derivation rather than growing a second one that can disagree.
 *
 *  It DISCARDS authored titles and briefs. Its caller owes the operator a
 *  confirmation naming what they lose. */
export function regroupChapters(
	scenes: readonly Scene[],
	sections: readonly PlanSection[] = [],
): SeededChapters {
	/* Scenes that already say where they belong are grouped on what they say. Only
	 * a document with nothing to group on falls back to recovering membership from
	 * the plan's sections — and the recovery refuses unless it is certain. */
	const groundless = !scenes.some((s) => s.sectionId || s.beat);
	const recovered = groundless ? recoverSectionMembership(scenes, sections) : null;
	return seedChapters(recovered ?? scenes, null);
}

/** True when re-deriving would produce a grouping the document does not already
 *  have — the question an affordance asks before offering itself.
 *
 *  False when the scenes carry nothing to group on, because the derivation would
 *  hand back the single chapter already on screen and the action would promise a
 *  change it cannot make. */
export function canRegroupChapters(
	scenes: readonly Scene[],
	chapters: readonly Chapter[] | null | undefined,
	sections: readonly PlanSection[] = [],
): boolean {
	if (scenes.length === 0) return false;
	/* Nothing on the scenes AND nothing recoverable from the plan means the
	 * derivation would hand back the single chapter already on screen. */
	if (!scenes.some((s) => s.sectionId || s.beat) && !recoverSectionMembership(scenes, sections))
		return false;
	const derived = regroupChapters(scenes, sections).chapters;
	const current = chapters ?? [];
	if (derived.length !== current.length) return true;
	return derived.some((chapter, index) => chapter.id !== current[index]?.id);
}

export function seedChapters(
	scenes: readonly Scene[],
	chapters: readonly Chapter[] | null | undefined,
): SeededChapters {
	/* An empty array is truthy and returns here — that is the point. The operator
	 * deleted every chapter and must not have them grow back on the next read. Only
	 * null/undefined, meaning "this document never had chapters", seed. */
	if (chapters) return { chapters, scenes: [...scenes], seeded: false };
	if (scenes.length === 0) return { chapters: [], scenes: [], seeded: false };

	const runs = runsOf(scenes);
	const derived: Chapter[] = [];
	const idByScene = new Map<number, string>();
	runs.forEach((run, index) => {
		const key = runKeyOf(run[0]!);
		/* A run the agent already grouped keeps that section's id, so the chapter and
		 * the scenes naming it agree without a lookup table. A run grouped by beat, or
		 * by nothing, gets a positional id — minted once here and persisted onto the
		 * scenes, so it never has to be re-derived. */
		const id = key && !key.startsWith("beat:") ? key : `ch-${index + 1}`;
		derived.push({ id, title: titleOf(run, index) });
		for (const scene of run) idByScene.set(scene.id, id);
	});

	return {
		chapters: derived,
		scenes: scenes.map((s) =>
			s.sectionId === idByScene.get(s.id) ? s : { ...s, sectionId: idByScene.get(s.id) },
		),
		seeded: true,
	};
}
