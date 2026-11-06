/* The editor command vocabulary: every mutation of the editing scope, as plain
 * data (`timeline-edit-commands`).
 *
 * A command is a JSON value — a `type` and its arguments, no functions — so the
 * web editor, the API, MCP and any native host can all produce, store, send and
 * replay the same edits. Execution is the Rust engine's alone
 * (`migrate-editor-to-shared-rust-core` 4.10): `engine-registry.ts` runs a
 * command through it, and the fixtures under `fixtures/` and the frozen
 * `reference/executor-parity.json` pin what it must do.
 *
 * The `type` strings are the labels the editor already showed and recorded
 * (`clip.move`, `doc.setCaptions`, …). `batch` and `scope.replace` carry an
 * optional `label` instead; `commandLabel` reads either. */
import type { Bookmark } from "../timeline-bookmarks.ts";
import type { Clip, SceneMarker } from "../timeline-doc.ts";
import type { CaptionConfig } from "../caption-config.ts";
import type { CaptionSet, CaptionSourceBinding } from "../caption-cues.ts";
import type { CaptionResultSnapshot } from "../caption-results.ts";
import type { ProjectMaterials } from "../project-materials.ts";
import type { ProjectSelection } from "../project-selection.ts";
import type { ColorKeyframe, TrackFlags, ValueKeyframe } from "../timeline-model.ts";
import type { EditScope, MediaAsset, Post, Slide } from "./scope.ts";
import type { AnimationProperty } from "../animation-properties.ts";

/** One key of a `clip.setKeys` track. */
export type AnimationKey = ValueKeyframe | ColorKeyframe;

export type CaptionEdit =
	| {
			action: "apply-result";
			ids: string[];
			candidates: Clip[];
			runId: string;
			language: string;
			startSec: number;
			endSec: number;
			sources: CaptionSourceBinding[];
			snapshot: CaptionResultSnapshot;
			replaceEdited: boolean;
			detectedLanguage?: string;
	  }
	| { action: "create"; clip: Clip; language?: string }
	| { action: "update"; id: string; text: string }
	| { action: "timing"; id: string; startSec: number; durationSec: number }
	| { action: "split"; id: string; at: number; newId: string }
	| { action: "merge" | "delete" | "unlink"; ids: string[] }
	| { action: "style"; ids: string[]; style: Partial<CaptionConfig> | null }
	| {
			action: "restore";
			ids: string[];
			entries: Array<{ index: number; clip: Clip }>;
			captionSet?: CaptionSet;
	  };

/* Rust owns the vocabulary and structural fields. Refine only opaque payloads
 * with the existing domain schemas; optionality and discriminants stay generated. */
import type * as EngineTypes from "./engine-types.generated.ts";

type CommandFields = {
	edit: CaptionEdit;
	mediaAssets: MediaAsset[];
	asset: MediaAsset;
	clip: Clip;
	marker: SceneMarker;
	bookmarks: Bookmark[];
	bookmark: Bookmark;
	captions: CaptionConfig;
	projectReferences: ProjectSelection;
	materials: ProjectMaterials;
	trackFlags: TrackFlags;
	slide: Slide;
	post: Post;
	scope: EditScope;
	property: AnimationProperty;
	keys: AnimationKey[];
};
type TypedCommand<C extends EngineTypes.EditorCommand> = C extends EngineTypes.EditorCommand
	? {
			[K in keyof C]: K extends keyof CommandFields
				? CommandFields[K]
				: K extends "commands"
					? EditorCommand[]
					: K extends "patch"
						? C["type"] extends `clip.${string}`
							? Partial<Clip>
							: C["type"] extends `marker.${string}`
								? Partial<SceneMarker>
								: C["type"] extends `slide.${string}`
									? Partial<Slide>
									: Partial<Post>
						: C[K];
		}
	: never;
export type EditorCommand = TypedCommand<EngineTypes.EditorCommand>;

export type EditorCommandType = EditorCommand["type"];

/** Every command kind. The fixture test requires a fixture for each one. */
export const EDITOR_COMMAND_TYPES = [
	"caption.edit",
	"media.update",
	"media.admit",
	"clip.replace",
	"clip.trim-before",
	"clip.trim-after",
	"clip.insert",
	"clip.remove",
	"clip.update",
	"clip.move",
	"clip.resize",
	"clip.setKeys",
	"marker.upsert",
	"marker.remove",
	"marker.update",
	"bookmark.set",
	"bookmark.upsert",
	"bookmark.remove",
	"doc.setCaptions",
	"doc.setProjectReferences",
	"doc.setMaterials",
	"doc.setTrackFlags",
	"slide.insert",
	"slide.remove",
	"slide.update",
	"post.insert",
	"post.remove",
	"post.update",
	"batch",
	"scope.replace",
	"noop",
] as const satisfies readonly EditorCommandType[];

// Compile-time proof that the list above names every member of the union.
type MissingFromList = Exclude<EditorCommandType, (typeof EDITOR_COMMAND_TYPES)[number]>;
const listIsComplete: MissingFromList extends never ? true : MissingFromList = true;
void listIsComplete;

/** The label a command is recorded and shown under. */
export function commandLabel(cmd: EditorCommand): string {
	if (cmd.type === "batch") return cmd.label ?? "batch";
	if (cmd.type === "scope.replace") return cmd.label ?? "edit";
	return cmd.type;
}

// ── Builders ─────────────────────────────────────────────────────────────────

export const editCaptions = (edit: CaptionEdit): EditorCommand => ({ type: "caption.edit", edit });

export const setMediaAssets = (mediaAssets: MediaAsset[]): EditorCommand => ({
	type: "media.update",
	mediaAssets,
});
export const admitMedia = (asset: MediaAsset): EditorCommand => ({ type: "media.admit", asset });
/** Replace a clip wholesale by id (move/resize/update build on it). */
export const replaceClip = (id: string, clip: Clip): EditorCommand => ({
	type: "clip.replace",
	id,
	clip,
});
/** Keep one side of the playhead; neighboring clips retain their exact positions. */
export const trimClipAtPlayhead = (
	id: string,
	at: number,
	side: "before" | "after",
): EditorCommand =>
	side === "before" ? { type: "clip.trim-before", id, at } : { type: "clip.trim-after", id, at };
export const insertClip = (clip: Clip, index?: number): EditorCommand =>
	index === undefined ? { type: "clip.insert", clip } : { type: "clip.insert", clip, index };
export const removeClip = (id: string): EditorCommand => ({ type: "clip.remove", id });
export const updateClip = (id: string, patch: Partial<Clip>): EditorCommand => ({
	type: "clip.update",
	id,
	patch,
});
/** Move a clip in time (and optionally to another track) — a typed `updateClip`. */
export const moveClip = (
	id: string,
	next: { startSec: number; track?: number },
): EditorCommand => ({
	type: "clip.move",
	id,
	patch:
		next.track === undefined
			? { startSec: next.startSec }
			: { startSec: next.startSec, track: next.track },
});
/** Resize a clip (and optionally re-anchor its start). */
export const resizeClip = (
	id: string,
	next: { durationSec: number; startSec?: number },
): EditorCommand =>
	next.startSec === undefined
		? { type: "clip.resize", id, durationSec: next.durationSec }
		: { type: "clip.resize", id, durationSec: next.durationSec, startSec: next.startSec };
/** Replace one property track of a clip; an empty list removes it (keyframe-animation). */
export const setKeys = (
	id: string,
	property: AnimationProperty,
	keys: AnimationKey[],
): EditorCommand => ({ type: "clip.setKeys", id, property, keys });
/* `index` places a marker that does not exist yet; an existing one is replaced in
 * place and the index is ignored. Undoing a removal needs it to restore order. */
export const upsertMarker = (marker: SceneMarker, index?: number): EditorCommand =>
	index === undefined
		? { type: "marker.upsert", marker }
		: { type: "marker.upsert", marker, index };
export const removeMarker = (id: number): EditorCommand => ({ type: "marker.remove", id });
export const updateMarker = (id: number, patch: Partial<SceneMarker>): EditorCommand => ({
	type: "marker.update",
	id,
	patch,
});
/** Restore exact optional annotation state without changing clip timing. */
export const setBookmarks = (bookmarks: Bookmark[] | undefined): EditorCommand =>
	bookmarks === undefined ? { type: "bookmark.set" } : { type: "bookmark.set", bookmarks };
export const upsertBookmark = (bookmark: Bookmark): EditorCommand => ({
	type: "bookmark.upsert",
	bookmark,
});
export const removeBookmark = (id: string): EditorCommand => ({ type: "bookmark.remove", id });
/* The doc-field setters accept `undefined` because that is the pre-edit state of
 * a project that never carried the field: undo must restore absent, not empty. */
export const setCaptions = (captions: CaptionConfig | undefined): EditorCommand =>
	captions === undefined ? { type: "doc.setCaptions" } : { type: "doc.setCaptions", captions };
export const setProjectReferences = (
	projectReferences: ProjectSelection | undefined,
): EditorCommand =>
	projectReferences === undefined
		? { type: "doc.setProjectReferences" }
		: { type: "doc.setProjectReferences", projectReferences };
export const setMaterials = (materials: ProjectMaterials | undefined): EditorCommand =>
	materials === undefined ? { type: "doc.setMaterials" } : { type: "doc.setMaterials", materials };
export const setTrackFlags = (trackFlags: TrackFlags | undefined): EditorCommand =>
	trackFlags === undefined
		? { type: "doc.setTrackFlags" }
		: { type: "doc.setTrackFlags", trackFlags };
export const insertSlide = (slide: Slide, index?: number): EditorCommand =>
	index === undefined ? { type: "slide.insert", slide } : { type: "slide.insert", slide, index };
export const removeSlide = (id: number): EditorCommand => ({ type: "slide.remove", id });
export const updateSlide = (id: number, patch: Partial<Slide>): EditorCommand => ({
	type: "slide.update",
	id,
	patch,
});
export const insertPost = (post: Post, index?: number): EditorCommand =>
	index === undefined ? { type: "post.insert", post } : { type: "post.insert", post, index };
export const removePost = (id: number): EditorCommand => ({ type: "post.remove", id });
export const updatePost = (id: number, patch: Partial<Post>): EditorCommand => ({
	type: "post.update",
	id,
	patch,
});
/** Group N commands into ONE undo step. Undo reverses the whole group. */
export const batch = (commands: EditorCommand[], label?: string): EditorCommand =>
	label === undefined ? { type: "batch", commands } : { type: "batch", commands, label };
/** Wholesale scope replacement; its inverse restores the prior scope. */
export const replaceScope = (scope: EditScope, label?: string): EditorCommand =>
	label === undefined ? { type: "scope.replace", scope } : { type: "scope.replace", scope, label };
export const noop = (): EditorCommand => ({ type: "noop" });

// ── Admission ────────────────────────────────────────────────────────────────

export interface Admission {
	assets: MediaAsset[];
	id: string;
	/** False when the URL was already admitted, so a caller can tell a placement
	 *  that reused an asset from one that introduced it. */
	added: boolean;
}

/** The one admission rule: the key is the URL. An asset whose URL is already
 *  admitted is not added again, and the existing id is the one used. */
export function admitAsset(assets: MediaAsset[], asset: MediaAsset): Admission {
	const existing = assets.find((a) => a.url === asset.url);
	if (existing) return { assets, id: existing.id, added: false };
	// Newest first: the panel reads this order, and an asset just placed is the
	// one an operator is looking for.
	return { assets: [asset, ...assets], id: asset.id, added: true };
}

export interface Execution {
	scope: EditScope;
	inverse: EditorCommand;
}
