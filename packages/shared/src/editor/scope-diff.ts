/* Structural diff -> typed command translation.
 *
 * WHO STILL NEEDS THIS. Positional edits do not: `setFreeClipPos` commits the
 * command it already knows (a drag knows a clip moved), so the five overlay
 * families never reach here. Neither does an agent run that only edited the
 * timeline: it carries the commands it executed and the editor applies exactly
 * those (`move-agent-tools-to-editor-commands`). The callers that remain cannot
 * name their edit:
 *
 *   - an agent run's GENERATION output, merged whole (`useAgentApply`, `agent.video`);
 *   - a SCENE edit, because the projection re-derives the scene clip, its `vis:`
 *     clips and its (possibly shared) marker together — the editor's scene writers
 *     and the agent's `sceneEditCommand` both derive it here, so the two agree;
 *   - slides and posts, which have no per-entity command vocabulary at all;
 *   - the document watcher (`CreateContent.commitDoc`), recording a write that
 *     arrived as a whole document.
 *
 * For those the edit genuinely arrives as a document, so it is compared against the
 * previous one to recover the narrowest command that reproduces it:
 *   - one clip added        -> insertClip
 *   - one clip removed       -> removeClip
 *   - one clip's timing only -> moveClip / resizeClip
 *   - one clip otherwise      -> updateClip (field-level patch)
 *   - one marker changed      -> upsertMarker / removeMarker
 *   - captions / refs changed -> setCaptions / setProjectReferences
 *   - materials changed       -> setMaterials
 *   - track flags changed     -> setTrackFlags
 *   - several of the above    -> batch of the individual commands
 *
 * A SAFETY NET guarantees correctness regardless of edge cases: if the assembled
 * command applied to `before` does not deep-equal `after`, we fall back to a coarse
 * `replaceScope(after)`. It stays precisely because the callers above are the ones
 * still guessing — and it earns its keep: it is what caught the timing mirror being
 * applied too eagerly, by refusing a command that did not reproduce the document. So the final state is always byte-identical to the legacy
 * array mutation, while unambiguous edits graduate to precise, labelled commands that
 * invert cleanly. Slides/posts are diffed too so image/text edits stay undoable.
 */
import type { Clip } from "../timeline-doc.ts";
import {
	batch,
	insertClip,
	insertPost,
	insertSlide,
	moveClip,
	noop,
	removeClip,
	removeMarker,
	removePost,
	removeSlide,
	replaceScope,
	resizeClip,
	setCaptions,
	setMaterials,
	setProjectReferences,
	setTrackFlags,
	updateClip,
	updatePost,
	updateSlide,
	upsertMarker,
	setMediaAssets,
	setBookmarks,
	type EditorCommand,
} from "./commands.ts";
import { applyCommand } from "./engine-registry.ts";
import type { EditScope, Post, Slide } from "./scope.ts";

/** Minimal structural equality for the plain-data editor scope (no functions/cycles). */
export function deepEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
		return true;
	}
	// Ignore keys explicitly set to undefined so `{x: undefined}` equals `{}`.
	const af = new Map(Object.entries(a).filter(([, value]) => value !== undefined));
	const bf = new Map(Object.entries(b).filter(([, value]) => value !== undefined));
	if (af.size !== bf.size) return false;
	for (const [k, value] of af) if (!bf.has(k) || !deepEqual(value, bf.get(k))) return false;
	return true;
}

/* Every doc field the scope carries has to be listed here. A field this misses
 * is not merely diffed coarsely — an edit that touches only that field compares
 * equal, `diffScopeToCommand` returns `noop`, and the commit is DROPPED. The
 * writer looks correct at its call site and the change never lands. */
function scopeEqual(a: EditScope, b: EditScope): boolean {
	return (
		deepEqual(a.doc.clips, b.doc.clips) &&
		deepEqual(a.doc.markers, b.doc.markers) &&
		deepEqual(a.doc.bookmarks, b.doc.bookmarks) &&
		deepEqual(a.doc.captions, b.doc.captions) &&
		deepEqual(a.doc.captionSet, b.doc.captionSet) &&
		deepEqual(a.doc.projectReferences, b.doc.projectReferences) &&
		deepEqual(a.doc.materials, b.doc.materials) &&
		deepEqual(a.doc.trackFlags, b.doc.trackFlags) &&
		deepEqual(a.slides, b.slides) &&
		deepEqual(a.posts, b.posts) &&
		deepEqual(a.mediaAssets, b.mediaAssets)
	);
}

/** The single typed command reproducing a changed clip (same id), or a general update. */
function clipChangeCommand(before: Clip, after: Clip): EditorCommand {
	const beforeFields = new Map(Object.entries(before));
	const afterFields = new Map(Object.entries(after));
	const changed = [...new Set([...beforeFields.keys(), ...afterFields.keys()])].filter(
		(k) => !deepEqual(beforeFields.get(k), afterFields.get(k)),
	);
	const onlyWithin = (allowed: string[]): boolean => changed.every((k) => allowed.includes(k));
	if (onlyWithin(["startSec", "track"]))
		return moveClip(after.id, { startSec: after.startSec, track: after.track });
	if (onlyWithin(["durationSec", "startSec"]))
		return resizeClip(after.id, { durationSec: after.durationSec, startSec: after.startSec });
	// A key the edit removed is carried as `undefined`, which the patch applies as removal.
	const patch: Partial<Clip> = Object.fromEntries(changed.map((k) => [k, afterFields.get(k)]));
	return updateClip(after.id, patch);
}

function byId<T extends { id: K }, K extends string | number = T["id"]>(items: T[]): Map<K, T> {
	const m = new Map<K, T>();
	for (const it of items) m.set(it.id, it);
	return m;
}

/** Collect the per-entity typed commands for one array (added / removed / changed). */
function arrayCommands<T extends { id: string | number }>(
	before: T[],
	after: T[],
	make: {
		insert: (item: T, index: number) => EditorCommand;
		remove: (id: T["id"]) => EditorCommand;
		change: (b: T, a: T) => EditorCommand;
	},
): EditorCommand[] | null {
	const b = byId(before);
	const a = byId(after);
	const out: EditorCommand[] = [];
	for (const [id] of b) if (!a.has(id)) out.push(make.remove(id));
	after.forEach((item, index) => {
		const prev = b.get(item.id);
		if (!prev) out.push(make.insert(item, index));
		else if (!deepEqual(prev, item)) out.push(make.change(prev, item));
	});
	return out;
}

/** Translate a whole-scope change into the narrowest correct command (see file header). */
export function diffScopeToCommand(
	before: EditScope,
	after: EditScope,
	label = "edit",
): EditorCommand {
	if (scopeEqual(before, after)) return noop();

	const commands: EditorCommand[] = [];
	if (!deepEqual(before.doc.captionSet, after.doc.captionSet))
		commands.push({
			type: "caption.edit",
			edit: {
				action: "restore",
				ids: [],
				entries: [],
				...(after.doc.captionSet ? { captionSet: after.doc.captionSet } : {}),
			},
		});
	if (!deepEqual(before.doc.bookmarks, after.doc.bookmarks))
		commands.push(setBookmarks(after.doc.bookmarks));
	if (!deepEqual(before.mediaAssets, after.mediaAssets))
		commands.push(setMediaAssets(after.mediaAssets));

	const clipCmds = arrayCommands<Clip>(before.doc.clips, after.doc.clips, {
		insert: (clip, index) => insertClip(clip, index),
		remove: (id) => removeClip(id),
		change: (b, a) => clipChangeCommand(b, a),
	});
	if (clipCmds) commands.push(...clipCmds);

	// Markers: adds/changes via upsert, removals via remove.
	const beforeMarkers = byId(before.doc.markers);
	const afterMarkers = byId(after.doc.markers);
	for (const [id] of beforeMarkers) if (!afterMarkers.has(id)) commands.push(removeMarker(id));
	// A new marker goes in at its position: appended, it would reorder the list and
	// fail the safety net below (a scene removal that re-keys a shared-beat marker).
	after.doc.markers.forEach((m, index) => {
		const prev = beforeMarkers.get(m.id);
		if (!prev) commands.push(upsertMarker(m, index));
		else if (!deepEqual(prev, m)) commands.push(upsertMarker(m));
	});

	if (!deepEqual(before.doc.captions, after.doc.captions) && after.doc.captions)
		commands.push(setCaptions(after.doc.captions));
	if (
		!deepEqual(before.doc.projectReferences, after.doc.projectReferences) &&
		after.doc.projectReferences
	) {
		commands.push(setProjectReferences(after.doc.projectReferences));
	}
	if (!deepEqual(before.doc.materials, after.doc.materials) && after.doc.materials) {
		commands.push(setMaterials(after.doc.materials));
	}
	if (!deepEqual(before.doc.trackFlags, after.doc.trackFlags) && after.doc.trackFlags) {
		commands.push(setTrackFlags(after.doc.trackFlags));
	}

	const slideCmds = arrayCommands<Slide>(before.slides, after.slides, {
		insert: (slide, index) => insertSlide(slide, index),
		remove: (id) => removeSlide(id),
		change: (_b, a) => updateSlide(a.id, a),
	});
	if (slideCmds) commands.push(...slideCmds);

	const postCmds = arrayCommands<Post>(before.posts, after.posts, {
		insert: (post, index) => insertPost(post, index),
		remove: (id) => removePost(id),
		change: (_b, a) => updatePost(a.id, a),
	});
	if (postCmds) commands.push(...postCmds);

	const assembled: EditorCommand =
		commands.length === 0
			? replaceScope(after, label)
			: commands.length === 1
				? commands[0]!
				: batch(commands, label);

	// Safety net: only trust the typed command(s) if they reproduce `after` exactly.
	const executed = applyCommand(before, assembled);
	if (scopeEqual(executed, after)) return assembled;
	// Source-only writers leave cues to Rust; accept those dependent changes atomically.
	if (
		deepEqual(
			before.doc.clips.filter((clip) => clip.type === "caption"),
			after.doc.clips.filter((clip) => clip.type === "caption"),
		) &&
		deepEqual(before.doc.captionSet, after.doc.captionSet)
	) {
		const withoutCues = (scope: EditScope): EditScope => ({
			...scope,
			doc: {
				...scope.doc,
				captionSet: undefined,
				clips: scope.doc.clips.filter((clip) => clip.type !== "caption"),
			},
		});
		if (scopeEqual(withoutCues(executed), withoutCues(after))) return assembled;
	}
	return replaceScope(after, label);
}
