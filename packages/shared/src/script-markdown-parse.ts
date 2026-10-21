/* Reading a script back from Markdown.
 *
 * The parse is TOLERANT by the same contract the storyboard read has: a file that
 * came back from someone's word processor, or a foreign AV script that never came
 * from here at all, must load rather than throw. What it could not interpret is
 * REPORTED, never dropped silently — an import that quietly discards half a
 * document is worse than one that refuses.
 *
 * Two things it deliberately does NOT do:
 *
 *   - It never reads a computed value. Running times and word counts are emitted
 *     for a reader and recomputed on load, so a hand-edited total cannot
 *     contradict the scenes it summarises.
 *   - It never decides to delete. A scene missing from the file is reported as a
 *     removal for the caller to confirm; a stale paste must not be able to wipe
 *     an afternoon's work on its own.
 */
import type { Chapter } from "./timeline-doc.ts";

/** One scene as the file states it. Ids are what an import matches on. */
export interface ParsedScene {
	/** The stable identity from `{#s7}`, absent when the heading carried none. */
	id?: number;
	/** The positional label as written. Read for reporting only — never matched
	 *  on, because the scene sitting at `1.1` may not be the one that was there. */
	label?: string;
	name: string;
	/** `undefined` when the heading said `auto`. */
	durSec?: number;
	auto: boolean;
	/** The speaker cue as written, before it is resolved against the roster. */
	cue?: string;
	vo: string;
	sfx?: string;
	shot?: string;
	move?: string;
	vis: string;
	action?: string;
}

export interface ParsedChapter {
	title: string;
	brief?: string;
	scenes: ParsedScene[];
}

export interface ParsedScript {
	frontmatter: Record<string, string>;
	chapters: ParsedChapter[];
	/** Every line the parse could not place, with the line number it was on. */
	unparsed: Array<{ line: number; text: string }>;
}

const SCENE_HEADING = /^##\s+(?:([\d.]+)\s+)?(.*?)\s*$/;
const IDENTITY = /\{#s(\d+)\}/;
const DURATION = /·\s*(auto|[\d.]+)\s*s?\s*$/i;
const CHAPTER_HEADING = /^#\s+(?:\d+\.\s*)?(.*?)\s*$/;
const AUDIO_LABEL = /^\*\*AUDIO\*\*(?:\s*[—-]\s*(.+))?$/;
const VISUAL_LABEL = /^\*\*(?:VISUAL|VIDEO)\*\*(?:\s*[—-]\s*(.+))?$/;
const GENERATED_COMMENT = /^<!--|-->\s*$|^\s+·\s/;

/** The two halves of a `shot, move` note, named off the scene that owns them. */
type ShotNote = Pick<ParsedScene, "shot" | "move">;

/** Split a `shot, move` note back into its two parts. */
function splitShotNote(note: string | undefined): ShotNote {
	if (!note) return {};
	const [shot, ...rest] = note.split(",").map((part) => part.trim());
	return { shot: shot || undefined, move: rest.join(", ") || undefined };
}

function emptyScene(name: string): ParsedScene {
	return { name, auto: false, vo: "", vis: "" };
}

/** Read a script from Markdown. Never throws. */
export function parseScriptMarkdown(source: string): ParsedScript {
	const lines = source.split(/\r?\n/);
	const frontmatter: Record<string, string> = {};
	const chapters: ParsedChapter[] = [];
	const unparsed: Array<{ line: number; text: string }> = [];

	let index = 0;
	if (lines[0]?.trim() === "---") {
		index = 1;
		while (index < lines.length && lines[index]?.trim() !== "---") {
			const line = lines[index]!;
			const at = line.indexOf(":");
			if (at > 0) frontmatter[line.slice(0, at).trim()] = line.slice(at + 1).trim();
			else if (line.trim()) unparsed.push({ line: index + 1, text: line });
			index += 1;
		}
		index += 1;
	}

	let chapter: ParsedChapter | undefined;
	let scene: ParsedScene | undefined;
	/* Which block the prose lines are currently falling into. `null` means we are
	 * between blocks, where prose belongs to the chapter's brief. */
	let block: "audio" | "visual" | null = null;

	const closeScene = (): void => {
		if (scene && chapter) chapter.scenes.push(scene);
		scene = undefined;
		block = null;
	};
	const closeChapter = (): void => {
		closeScene();
		if (chapter) chapters.push(chapter);
		chapter = undefined;
	};

	for (; index < lines.length; index += 1) {
		const raw = lines[index]!;
		const line = raw.trim();
		if (!line) continue;

		/* The generated footer, in any of its lines. Emitted for a reader, never
		 * read back — recomputing is what stops a hand-edited total from
		 * contradicting the scenes above it. */
		if (GENERATED_COMMENT.test(raw)) continue;

		const sceneHeading = line.startsWith("## ") ? SCENE_HEADING.exec(line) : null;
		if (sceneHeading) {
			closeScene();
			if (!chapter) chapter = { title: "Unassigned", scenes: [] };
			let rest = sceneHeading[2] ?? "";
			const identity = IDENTITY.exec(rest);
			const duration = DURATION.exec(rest);
			rest = rest
				.replace(IDENTITY, "")
				.replace(DURATION, "")
				.trim()
				.replace(/[·\s]+$/, "");
			scene = emptyScene(rest || "Untitled");
			scene.label = sceneHeading[1];
			if (identity) scene.id = Number(identity[1]);
			if (duration) {
				const token = duration[1]!.toLowerCase();
				if (token === "auto") scene.auto = true;
				else scene.durSec = Number(token);
			}
			continue;
		}

		if (line.startsWith("# ")) {
			const heading = CHAPTER_HEADING.exec(line);
			closeChapter();
			chapter = { title: heading?.[1]?.trim() || "Untitled", scenes: [] };
			continue;
		}

		const audio = AUDIO_LABEL.exec(line);
		if (audio) {
			if (!scene) {
				unparsed.push({ line: index + 1, text: raw });
				continue;
			}
			block = "audio";
			if (audio[1]) scene.cue = audio[1].trim();
			continue;
		}

		const visual = VISUAL_LABEL.exec(line);
		if (visual) {
			if (!scene) {
				unparsed.push({ line: index + 1, text: raw });
				continue;
			}
			block = "visual";
			Object.assign(scene, splitShotNote(visual[1]?.trim()));
			continue;
		}

		if (scene && block === "audio") {
			if (/^SFX:/i.test(line)) scene.sfx = line.slice(4).trim();
			else scene.vo = scene.vo ? `${scene.vo}\n${line}` : line;
			continue;
		}
		if (scene && block === "visual") {
			if (/^Action:/i.test(line)) scene.action = line.slice(7).trim();
			else scene.vis = scene.vis ? `${scene.vis}\n${line}` : line;
			continue;
		}
		if (chapter && !scene) {
			chapter.brief = chapter.brief ? `${chapter.brief}\n${line}` : line;
			continue;
		}
		/* Anything left has no block to belong to — a stray heading level, a table
		 * from a foreign script, a note above the first chapter. Reported so the
		 * operator can see what did not come across. */
		unparsed.push({ line: index + 1, text: raw });
	}
	closeChapter();

	return { frontmatter, chapters, unparsed };
}

/** What importing a parsed script would do to a project. */
export interface ImportPlan {
	/** Scenes matched by identity, and what the file says they should become. */
	updates: Array<{ id: number; scene: ParsedScene }>;
	/** Rows with no identity, or one this project does not have. */
	creates: ParsedScene[];
	/** Scenes the project has and the file does not. NEVER applied without an
	 *  explicit confirmation — a stale paste must not be able to delete work. */
	removals: number[];
	/** Chapters as the file states them, in its order. */
	chapters: Array<Pick<Chapter, "title" | "brief">>;
	/** True when the file was exported from a different revision of this project. */
	diverged: boolean;
	unparsed: ParsedScript["unparsed"];
}

/** Work out what an import would change, without changing anything.
 *
 *  Matching is on IDENTITY, never on the label: `1.1` in the file may be a
 *  different scene from the one now sitting first in chapter one, and matching
 *  the label would overwrite it. */
export function planScriptImport(
	parsed: ParsedScript,
	project: { sceneIds: readonly number[]; revision?: number },
): ImportPlan {
	const existing = new Set(project.sceneIds);
	const updates: ImportPlan["updates"] = [];
	const creates: ParsedScene[] = [];
	const seen = new Set<number>();

	for (const chapter of parsed.chapters) {
		for (const scene of chapter.scenes) {
			if (scene.id !== undefined && existing.has(scene.id)) {
				updates.push({ id: scene.id, scene });
				seen.add(scene.id);
			} else {
				creates.push(scene);
			}
		}
	}

	const fileRevision = Number(parsed.frontmatter.revision);
	return {
		updates,
		creates,
		removals: project.sceneIds.filter((id) => !seen.has(id)),
		chapters: parsed.chapters.map((c) => ({ title: c.title, brief: c.brief })),
		/* Only a revision that is present AND different means the project moved on.
		 * A file with none says nothing about when it was written, which is not the
		 * same as saying it is current. */
		diverged:
			project.revision !== undefined &&
			Number.isFinite(fileRevision) &&
			fileRevision !== project.revision,
		unparsed: parsed.unparsed,
	};
}
