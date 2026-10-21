/* The script as Markdown: the AV script's wire format.
 *
 * An AV (audio-visual) script is a table — chapter, then a row per scene with a
 * VIDEO description beside an AUDIO one — but the FILE must not be. Markdown
 * tables need `<br>` for multi-line cells and their pipe alignment rots on every
 * edit, so prose in one is miserable to write by hand. The view is a table; this
 * is headings and labelled blocks, which paste into Notion, Docs or GitHub and
 * survive being edited there.
 *
 * Two rules carry the whole round trip:
 *
 *   - **A scene's LABEL is positional and its IDENTITY is not.** `1.1` is the
 *     first scene of chapter one, derived on render and never stored; move the
 *     scene and the label changes, which is the point. Import matches on the
 *     identity that rides in `{#s7}`, never on the label — matching the label
 *     would silently overwrite whichever scene now happens to sit there.
 *   - **Computed values are emitted, never parsed.** Running times and word
 *     counts read well in a standalone file and are recomputed on import, so a
 *     hand-edited total can never contradict the scenes it summarises.
 */
import type { Chapter } from "./timeline-doc.ts";
import type { Scene } from "./timeline-model.ts";
import { durationModeOf } from "./scene-duration.ts";

/** What a scene renders under, and where it sits. */
export interface ScriptChapter {
	chapter: Chapter;
	scenes: Scene[];
}

/** Everything the file states that is not a scene. */
export interface ScriptFrontmatter {
	title?: string;
	format?: string;
	/** The project's default voice, named once so per-scene cues can stay absent. */
	voice?: string;
	project?: string;
	/** The document revision at export, so an import can tell the project moved. */
	revision?: number;
}

/** Group scenes into the chapters they name, in timeline order.
 *
 *  A chapter with no scenes still appears: the operator can write into one before
 *  putting anything in it. Scenes naming no chapter, or one that no longer exists,
 *  fall into a trailing group so nothing is silently dropped from the file. */
export function scriptChapters(
	scenes: readonly Scene[],
	chapters: readonly Chapter[],
): ScriptChapter[] {
	const grouped = new Map<string, Scene[]>(chapters.map((c) => [c.id, []]));
	const orphans: Scene[] = [];
	for (const scene of scenes) {
		const group = scene.sectionId === undefined ? undefined : grouped.get(scene.sectionId);
		if (group) group.push(scene);
		else orphans.push(scene);
	}
	const out = chapters.map((chapter) => ({ chapter, scenes: grouped.get(chapter.id) ?? [] }));
	if (orphans.length) out.push({ chapter: { id: "", title: "Unassigned" }, scenes: orphans });
	return out;
}

/** Words in a piece of narration. */
export function wordCount(text: string): number {
	const trimmed = text.trim();
	return trimmed ? trimmed.split(/\s+/).length : 0;
}

function mmss(totalSec: number): string {
	const whole = Math.max(0, Math.round(totalSec));
	return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

/** A chapter's computed footer: its own running time and words, then the
 *  cumulative totals to the end of it. Derived, never stored, never parsed. */
export interface ChapterTotals {
	segmentSec: number;
	segmentWords: number;
	totalSec: number;
	totalWords: number;
}

export function chapterTotals(groups: readonly ScriptChapter[]): ChapterTotals[] {
	let sec = 0;
	let words = 0;
	return groups.map((group) => {
		const segmentSec = group.scenes.reduce((sum, s) => sum + Math.max(0, s.dur || 0), 0);
		const segmentWords = group.scenes.reduce((sum, s) => sum + wordCount(s.vo ?? ""), 0);
		sec += segmentSec;
		words += segmentWords;
		return { segmentSec, segmentWords, totalSec: sec, totalWords: words };
	});
}

/** How a scene's duration is written: a number when pinned, `auto` when it
 *  follows its speech. */
function durationToken(scene: Scene): string {
	return durationModeOf(scene) === "auto" ? "auto" : `${Number((scene.dur ?? 0).toFixed(2))}s`;
}

/** The shot description that rides beside the VISUAL label. */
function shotNote(scene: Scene): string {
	return [scene.shot, scene.move]
		.map((part) => part?.trim())
		.filter(Boolean)
		.join(", ");
}

function frontmatterBlock(meta: ScriptFrontmatter): string[] {
	const lines = ["---"];
	for (const [key, value] of [
		["title", meta.title],
		["format", meta.format],
		["voice", meta.voice],
		["project", meta.project],
		["revision", meta.revision],
	] as const) {
		if (value !== undefined && value !== "") lines.push(`${key}: ${value}`);
	}
	lines.push("---", "");
	return lines;
}

/** Render the script as Markdown. */
export function toScriptMarkdown(
	groups: readonly ScriptChapter[],
	meta: ScriptFrontmatter = {},
): string {
	const totals = chapterTotals(groups);
	const lines = frontmatterBlock(meta);

	groups.forEach((group, chapterIndex) => {
		lines.push(`# ${chapterIndex + 1}. ${group.chapter.title}`, "");
		if (group.chapter.brief) lines.push(group.chapter.brief, "");

		group.scenes.forEach((scene, sceneIndex) => {
			/* Label then identity: `1.1` is what a reader uses and `{#s7}` is what an
			 * import matches. Renderers that do not know the attribute syntax drop it
			 * silently, which is why it is safe to put in a heading. */
			lines.push(
				`## ${chapterIndex + 1}.${sceneIndex + 1} ${scene.name} {#s${scene.id}} · ${durationToken(scene)}`,
				"",
			);

			/* A speaker cue only when the scene chose one. In a single-voice explainer
			 * every row would otherwise carry the same cue, which makes it decoration
			 * rather than signal; the default voice is named once in the frontmatter. */
			lines.push(scene.castId ? `**AUDIO** — ${scene.castId.toUpperCase()}` : "**AUDIO**");
			if (scene.vo?.trim()) lines.push(scene.vo.trim());
			if (scene.sfx?.trim()) lines.push(`SFX: ${scene.sfx.trim()}`);
			lines.push("");

			const note = shotNote(scene);
			lines.push(note ? `**VISUAL** — ${note}` : "**VISUAL**");
			if (scene.vis?.trim()) lines.push(scene.vis.trim());
			if (scene.action?.trim()) lines.push(`Action: ${scene.action.trim()}`);
			lines.push("");
		});

		const t = totals[chapterIndex]!;
		lines.push(
			`<!-- End of Chapter: ${group.chapter.title} · Segment RT ${mmss(t.segmentSec)} · Segment Words ${t.segmentWords}`,
			`     · Total RT ${mmss(t.totalSec)} · Total Words ${t.totalWords} — generated, not read on import -->`,
			"",
		);
	});

	return lines.join("\n");
}
