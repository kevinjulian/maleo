/* The script table's rows, derived from the document.
 *
 * Everything here is a projection. The script view holds no copy of any scene
 * text — it reads and writes the same `Scene` records the timeline edits, which
 * is what makes "script and timeline cannot disagree" true by construction rather
 * than by a sync step. Nothing in this module stores anything.
 */
import { chapterTotals, scriptChapters, seedChapters, type ScriptChapter } from "@maleo/shared";
import { durationModeOf, contentOverflowSec, frameIsStale, speechIsStale } from "@maleo/shared";
import type {
	AudioOrigin,
	AudioOverlayKind,
	Chapter,
	Clip,
	Scene,
	SceneHashContext,
} from "@maleo/shared";

/** How much of the table is showing. */
export type ScriptDensity = "outline" | "read" | "write";

/** Which cells a density shows. Column visibility, not three row templates —
 *  that is the whole reason the table earns its keep over stacked blocks. */
export const DENSITY_COLUMNS: Readonly<Record<ScriptDensity, readonly ScriptColumn[]>> = {
	outline: ["label", "name", "duration"],
	read: ["audio"],
	write: ["label", "name", "audio", "visual", "image", "duration"],
};

export type ScriptColumn = "label" | "name" | "audio" | "visual" | "image" | "duration";

export function showsColumn(density: ScriptDensity, column: ScriptColumn): boolean {
	return DENSITY_COLUMNS[density].includes(column);
}

/* ── The audio a scene carries ──
 *
 * `Scene.audioClips` is the richer record; `Scene.vo` and `Scene.sfx` are its
 * flattenings (`packages/shared/src/scene-timing.ts:71-72`), and `sfx` joins
 * every NON-voiceover clip — music included — so a scene read through it alone
 * cannot tell a music cue from an effect. Reading the clips is both the fuller
 * view and the correcting one.
 */

/** One labelled line in the audio cell. */
export type AudioLine =
	| { kind: "music"; title: string; continues: boolean }
	| { kind: "sfx"; title: string; continues: boolean }
	| { kind: "vo"; speaker: string; text: string; editable: boolean }
	/** Generated speech sitting on the timeline. Its own line rather than a mark
	 *  on the narration: it is a rendered asset with a measured length, and the
	 *  words it was generated from can drift from the words above it. */
	| { kind: "speech"; text: string; origin?: string; durationSec: number };

/** A timeline audio clip crossing a row. The script shows these but never owns
 *  them — they belong to the timeline, which is why they carry no edit. */
export interface TimelineAudio {
	kind: AudioOverlayKind;
	content: string;
	origin?: AudioOrigin;
	durationSec: number;
	/** True when the clip BEGINS inside this row. A bed running the length of the
	 *  video crosses every row; printing it on all of them is wallpaper, not
	 *  disclosure, so only the row it starts on states it. */
	startsHere: boolean;
	/** True when it runs past the end of this row. */
	continues: boolean;
}

/** The last-resort speaker name, when a project names no default voice. */
export const DEFAULT_SPEAKER_LABEL = "Narrator";

/** True for the labels `audioKindLabel` mints for a voiceover clip that named no
 *  speaker. They describe the KIND, so showing one as a speaker would put
 *  "Voiceover" where a name belongs. */
function isGenericVoiceLabel(label: string): boolean {
	return /voiceover$/i.test(label.trim());
}

/** Order: cues before the words that sit under them, which is how an AV script
 *  is read aloud, with the rendered speech last because it follows the words. */
const KIND_ORDER: Readonly<Record<AudioLine["kind"], number>> = {
	music: 0,
	sfx: 1,
	vo: 2,
	speech: 3,
};

/** Which audio line a timeline clip's kind becomes. `ambient` and `accent_hit`
 *  are effects as far as a script reader is concerned. */
function lineKindOf(kind: AudioOverlayKind): "music" | "sfx" | "speech" {
	if (kind === "music") return "music";
	if (kind === "voiceover") return "speech";
	return "sfx";
}

/** Every audio element on a scene, as the ordered, labelled lines the cell
 *  renders. A projection — it stores nothing and decides nothing about editing
 *  beyond which single line owns the scene's narration. */
export function audioLines(
	scene: Scene,
	defaultVoice?: string,
	timeline: readonly TimelineAudio[] = [],
): AudioLine[] {
	const speakerFor = (clipLabel?: string): string => {
		const named = clipLabel?.trim();
		if (named && !isGenericVoiceLabel(named)) return named;
		return scene.castId?.trim() || defaultVoice?.trim() || DEFAULT_SPEAKER_LABEL;
	};

	const clips = scene.audioClips?.filter((clip) => clip.content.trim());
	const sceneCues: AudioLine[] = clips?.length
		? clips
				.filter((clip) => clip.kind !== "voiceover")
				.map((clip): AudioLine => {
					const title = clip.content.trim() || clip.label.trim();
					return clip.kind === "music"
						? { kind: "music", title, continues: false }
						: { kind: "sfx", title, continues: false };
				})
		: /* The fallback a scene carrying no clips takes. `scene.sfx` has already
			 * joined music and effects together, so this path cannot separate them and
			 * labels the result SFX — which is what the row showed before. */
			scene.sfx?.trim()
			? [{ kind: "sfx", title: scene.sfx.trim(), continues: false }]
			: [];

	/* Only the clips that BEGIN here. One bed spanning the video would otherwise
	 * repeat itself down every row of the document. */
	const crossing = timeline.filter((clip) => clip.startsHere && clip.content.trim());
	const timelineCues = crossing
		.filter((clip) => lineKindOf(clip.kind) !== "speech")
		.map((clip): AudioLine => {
			const title = clip.content.trim();
			return lineKindOf(clip.kind) === "music"
				? { kind: "music", title, continues: clip.continues }
				: { kind: "sfx", title, continues: clip.continues };
		});
	const speech = crossing
		.filter((clip) => lineKindOf(clip.kind) === "speech")
		.map((clip): AudioLine => ({
			kind: "speech",
			text: clip.content.trim(),
			origin: clip.origin,
			durationSec: clip.durationSec,
		}));

	const cues = [...sceneCues, ...timelineCues];

	const spoken = clips?.length
		? clips
				.filter((clip) => clip.kind === "voiceover")
				.map((clip) => ({ speaker: speakerFor(clip.label), text: clip.content.trim() }))
		: [{ speaker: speakerFor(), text: scene.vo?.trim() ?? "" }];

	/* One voiceover line ALWAYS, even with nothing written yet: the script is the
	 * surface narration is written on, and a scene carrying only a music cue would
	 * otherwise offer nowhere to type. It is the first, and the only editable one —
	 * a second field bound to the same `Scene.vo` would let the last blur silently
	 * win over the other. */
	const voice = spoken.length ? spoken : [{ speaker: speakerFor(), text: "" }];
	return [
		...cues.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]),
		...voice.map((line, index): AudioLine => ({ kind: "vo", ...line, editable: index === 0 })),
		...speech,
	];
}

/** One scene, as the table renders it. */
export interface ScriptRow {
	scene: Scene;
	/** `chapter.scene`, derived from position. NEVER stored: move the scene and
	 *  the label changes, which is the point of it. */
	label: string;
	/** The speaker cue, or absent when the scene uses the project's default
	 *  voice. A cue on every row of a single-voice explainer is decoration; one
	 *  that appears only when something differs is signal. */
	cue?: string;
	/** This scene's start on the timeline. */
	startSec: number;
	durationSec: number;
	pinned: boolean;
	/** Speech that would be cut, in seconds. Zero when it fits. */
	overflowSec: number;
	speechStale: boolean;
	frameStale: boolean;
	/** What overlaps this scene that the script does not own. */
	overlaps: OverlapSummary;
	/** The timeline audio crossing this row, named rather than counted. */
	timelineAudio: TimelineAudio[];
}

/** Timeline content the script shows but never edits. */
export interface OverlapSummary {
	overlays: number;
	music: number;
	transitions: number;
}

/** How close two timeline positions have to be to count as the same instant.
 *  Scene starts are running sums of float durations, so an exact `>=` puts a
 *  clip cued on a boundary inside both of the rows it touches. */
const BOUNDARY_EPSILON = 1e-6;

/** True when anything crosses the row — what a delete has to warn about. */
export function hasOverlap(o: OverlapSummary): boolean {
	return o.overlays + o.music + o.transitions > 0;
}

/** The timeline audio crossing a scene's span, named. Separate from
 *  `overlapsOf`, which counts everything for the delete warning: this one
 *  answers "what does the operator READ on this row". */
export function timelineAudioOf(
	clips: readonly Clip[],
	startSec: number,
	durationSec: number,
): TimelineAudio[] {
	const end = startSec + durationSec;
	const out: TimelineAudio[] = [];
	for (const clip of clips) {
		/* A scene's own clips are the scene, not something crossing it. */
		if (clip.scene || clip.vis || !clip.audio) continue;
		const clipEnd = clip.startSec + clip.durationSec;
		/* Boundaries compare with a tolerance. Scene starts are sums of float
		 * durations, so a clip cued exactly at the NEXT scene's start lands a
		 * fraction of a microsecond inside this one and gets reported on both
		 * rows — which reads as a duplicated cue rather than as the two separate
		 * hits it is. */
		if (clipEnd <= startSec + BOUNDARY_EPSILON || clip.startSec >= end - BOUNDARY_EPSILON) continue;
		out.push({
			kind: clip.audio.kind,
			content: clip.audio.content,
			origin: clip.audio.origin,
			durationSec: clip.durationSec,
			/* A clip that began before this row started somewhere earlier, and that
			 * earlier row is the one that states it. */
			startsHere: clip.startSec >= startSec - BOUNDARY_EPSILON,
			continues: clipEnd > end + BOUNDARY_EPSILON,
		});
	}
	return out;
}

export interface ScriptChapterRows {
	chapter: Chapter;
	rows: ScriptRow[];
	/** Computed on render, never persisted. */
	segmentSec: number;
	segmentWords: number;
	totalSec: number;
	totalWords: number;
}

const EMPTY_OVERLAP: OverlapSummary = { overlays: 0, music: 0, transitions: 0 };

/** What overlaps a scene's span, by family, from the clips the script does not own. */
export function overlapsOf(
	clips: readonly Clip[],
	startSec: number,
	durationSec: number,
): OverlapSummary {
	const end = startSec + durationSec;
	let overlays = 0;
	let music = 0;
	let transitions = 0;
	for (const clip of clips) {
		/* A scene's own clips are not an overlap — they are the scene. */
		if (clip.scene || clip.vis) continue;
		if (clip.type === "transition") {
			transitions += 1;
			continue;
		}
		const clipEnd = clip.startSec + clip.durationSec;
		if (clipEnd <= startSec || clip.startSec >= end) continue;
		if (clip.audio) music += 1;
		else overlays += 1;
	}
	return { overlays, music, transitions };
}

/** Where each scene sits, from the clips that carry them. */
function sceneStarts(clips: readonly Clip[]): Map<number, number> {
	const starts = new Map<number, number>();
	for (const clip of clips) {
		if (!clip.scene) continue;
		const prior = starts.get(clip.scene.id);
		if (prior === undefined || clip.startSec < prior) starts.set(clip.scene.id, clip.startSec);
	}
	return starts;
}

export interface ScriptRowsInput {
	scenes: readonly Scene[];
	chapters: readonly Chapter[];
	clips?: readonly Clip[];
	/** Project-level generation inputs, so staleness reads the same way it was
	 *  stamped. */
	hashContext?: SceneHashContext;
}

/** The whole table: chapters in timeline order, each with its rows and totals. */
export function scriptRows(input: ScriptRowsInput): ScriptChapterRows[] {
	/* Membership is DERIVED here, always, and the persisted chapters supply only
	 * their metadata.
	 *
	 * Derived because the load deliberately does not stamp `sectionId` onto the
	 * scenes it read: the clip-first read returns persisted clips verbatim, and
	 * writing membership at load would make a load-then-save emit different bytes
	 * than it read.
	 *
	 * ALWAYS because passing the persisted chapters into the seed instead would
	 * make it return them untouched — leaving every scene without membership, so
	 * the whole project falls into one "Unassigned" group while the real chapters
	 * render empty. Deriving and then overlaying is what keeps an operator's
	 * chapter titles while still placing the scenes; the derivation is
	 * deterministic, so the ids it mints match the ones the load already stored. */
	const seeded = seedChapters(input.scenes, null);
	const authored = new Map(input.chapters.map((c) => [c.id, c]));
	const chapters = seeded.chapters.map((derived) => authored.get(derived.id) ?? derived);
	/* A chapter the operator authored that no scene now names still belongs in the
	 * document — they can write into it before putting anything in it. */
	const orphaned = input.chapters.filter((c) => !seeded.chapters.some((d) => d.id === c.id));
	const groups: ScriptChapter[] = scriptChapters(seeded.scenes, [...chapters, ...orphaned]);
	const totals = chapterTotals(groups);
	const clips = input.clips ?? [];
	const starts = sceneStarts(clips);

	return groups.map((group, chapterIndex) => ({
		chapter: group.chapter,
		...totals[chapterIndex]!,
		rows: group.scenes.map((scene, sceneIndex) => {
			const startSec = starts.get(scene.id) ?? 0;
			const durationSec = Math.max(0, scene.dur || 0);
			return {
				scene,
				label: `${chapterIndex + 1}.${sceneIndex + 1}`,
				cue: scene.castId || undefined,
				startSec,
				durationSec,
				pinned: durationModeOf(scene) === "pinned",
				overflowSec: contentOverflowSec(scene),
				speechStale: speechIsStale(scene, input.hashContext),
				frameStale: frameIsStale(scene, input.hashContext),
				overlaps: clips.length ? overlapsOf(clips, startSec, durationSec) : EMPTY_OVERLAP,
				timelineAudio: clips.length ? timelineAudioOf(clips, startSec, durationSec) : [],
			};
		}),
	}));
}

/* ── Splitting and merging while writing ──
 *
 * The interaction that makes this a document rather than a stack of text fields.
 * Structure comes out of authoring, which is also what D5's pacing depends on:
 * where the writer breaks is where the narration breathes.
 */

/** Split a scene's narration at `offset`, returning the two scenes it becomes.
 *
 *  The new scene inherits the shot, movement, speaker and chapter of the one it
 *  came from — a split is one shot becoming two, not a new shot appearing — and
 *  BOTH halves go auto, because neither's old duration describes its new text.
 *  The new half carries no generated assets: they belonged to the whole. */
export function splitScene(scene: Scene, offset: number, newId: number): [Scene, Scene] {
	const text = scene.vo ?? "";
	const at = Math.max(0, Math.min(offset, text.length));
	const head = text.slice(0, at).trimEnd();
	const tail = text.slice(at).trimStart();
	return [
		{ ...scene, vo: head, durMode: "auto", contentDur: undefined, speechInputHash: undefined },
		{
			...scene,
			id: newId,
			name: `${scene.name} (2)`,
			vo: tail,
			durMode: "auto",
			contentDur: undefined,
			/* No frame, no speech, no hashes: the assets belonged to the scene that
			 * was split, and claiming them here would show the wrong picture under
			 * the wrong words. */
			src: undefined,
			endSrc: undefined,
			mediaAssetId: undefined,
			endMediaAssetId: undefined,
			img: false,
			visualClips: undefined,
			audioClips: undefined,
			history: undefined,
			speechInputHash: undefined,
			frameInputHash: undefined,
		},
	];
}

/** Merge a scene into the one before it. The survivor keeps the FIRST scene's
 *  identity and assets; the narration is joined with a space. */
export function mergeScenes(previous: Scene, scene: Scene): Scene {
	const joined = [previous.vo?.trim(), scene.vo?.trim()].filter(Boolean).join(" ");
	return {
		...previous,
		vo: joined,
		/* The speech no longer matches the joined text, and the duration no longer
		 * describes it. Auto, and unstamped, so the row reads as needing speech
		 * rather than as carrying speech that fits. */
		durMode: "auto",
		contentDur: undefined,
		speechInputHash: undefined,
		dur: Math.max(1, (previous.dur || 0) + (scene.dur || 0)),
	};
}

/** True when merging away `scene` would discard generated work, which the
 *  operator has to be told about first. */
export function mergeLosesAssets(scene: Scene): boolean {
	return Boolean(scene.src || scene.endSrc || scene.audioClips?.length);
}
