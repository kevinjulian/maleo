/* Building the compact project index.
 *
 * Every run is handed the whole project in outline and only the part it works on
 * in full. This module builds the outline. It is pure — canonical data in, index
 * out, no IO — so the same function runs in the editor while the user types and
 * in the API when the run is frozen, and the two cannot disagree.
 *
 * What belongs in an index entry is decided by one question: could a planner use
 * this to tell whether the entity is the one it wants? A label, a position on the
 * timeline, and sometimes a one-line summary answer that. A full record does not
 * belong, however small it looks today — the reason the index exists is that
 * "small per clip" times "a project's worth of clips" is what blew the prompt
 * budget in the first place. */
import type { ChatIndexEntry, ChatProjectIndex } from "./chat-context-envelope.ts";
import { EMPTY_CHAT_PROJECT_INDEX } from "./chat-context-envelope.ts";
import type { TimelineDoc } from "./timeline-doc.ts";
import type { ChapterRange } from "./timeline-chapters.ts";
import {
	MATERIAL_GROUPS,
	isEmptyMaterialGroup,
	type ProjectMaterials,
} from "./project-materials.ts";

/* A slide or post as the index sees it.
 *
 * `key` is the stable identity, not the array position. Slides and posts were
 * historically numbered by index, which made "slide 2" mean a different slide
 * after a reorder — fine for rendering a list, fatal for fencing a result against
 * the entity it claimed to change. The index refuses to carry positional ids so
 * that mistake cannot re-enter through this path. */
export interface ChatSlideInput {
	key: string;
	name?: string;
	caption?: string;
}

export interface ChatPostInput {
	key: string;
	body?: string;
}

export interface ChatReferenceInput {
	id: string;
	label?: string;
}

export interface ChatAssetInput {
	id: string;
	label?: string;
	kind?: string;
}

export interface ChatIndexInput {
	doc?: TimelineDoc | null;
	chapters?: ChapterRange[] | null;
	slides?: ChatSlideInput[] | null;
	posts?: ChatPostInput[] | null;
	materials?: ProjectMaterials | null;
	references?: ChatReferenceInput[] | null;
	assets?: ChatAssetInput[] | null;
}

/** How much of a body of text an index entry may carry. Long enough to tell two
 *  entities apart, short enough that a hundred of them still cost little. */
export const INDEX_SUMMARY_MAX = 120;

function summarize(text: string | undefined): string | undefined {
	const trimmed = (text ?? "").trim();
	if (!trimmed) return undefined;
	return trimmed.length <= INDEX_SUMMARY_MAX
		? trimmed
		: `${trimmed.slice(0, INDEX_SUMMARY_MAX - 1)}…`;
}

/* Story structure, in reading order.
 *
 * Chapters and scene markers for video; slides or posts for the other content
 * types. They share one list because a planner asks "what is this project made
 * of" without caring which content type answers. */
function storyEntries(input: ChatIndexInput): ChatIndexEntry[] {
	const entries: ChatIndexEntry[] = [];

	for (const chapter of input.chapters ?? []) {
		entries.push({
			kind: "section",
			id: chapter.id,
			label: chapter.title,
			startSec: chapter.startSec,
			durationSec: Math.max(0, chapter.endSec - chapter.startSec),
		});
	}

	for (const marker of input.doc?.markers ?? []) {
		entries.push({
			kind: "scene",
			id: String(marker.id),
			label: marker.title,
			summary: summarize(marker.voiceoverText ?? marker.beat),
			startSec: marker.startSec,
			durationSec: Math.max(0, marker.endSec - marker.startSec),
		});
	}

	for (const slide of input.slides ?? []) {
		entries.push({
			kind: "slide",
			id: slide.key,
			label: slide.name ?? slide.key,
			summary: summarize(slide.caption),
		});
	}

	for (const post of input.posts ?? []) {
		entries.push({
			kind: "post",
			id: post.key,
			label: summarize(post.body) ?? post.key,
			summary: summarize(post.body),
		});
	}

	return entries;
}

/* Every clip, by stable clip id.
 *
 * Kept separate from story structure because they answer different questions: a
 * scene says what a moment is about, a clip says what is actually on the
 * timeline at that moment, and an edit usually needs both. */
function timelineEntries(doc: TimelineDoc | null | undefined): ChatIndexEntry[] {
	return (doc?.clips ?? []).map((clip) => ({
		kind: "clip" as const,
		id: clip.id,
		label: clip.scene?.name ?? clip.text?.content ?? clip.type,
		summary: summarize(clip.scene?.vo ?? clip.text?.content),
		startSec: clip.startSec,
		durationSec: clip.durationSec,
	}));
}

/* Only the material groups that carry something.
 *
 * An empty group is not guidance, and listing four groups where one has content
 * invites a planner to treat silence as an instruction. */
function materialEntries(materials: ProjectMaterials | null | undefined): ChatIndexEntry[] {
	if (!materials) return [];
	return MATERIAL_GROUPS.filter((group) => !isEmptyMaterialGroup(materials[group])).map(
		(group) => ({
			kind: "material" as const,
			id: group,
			label: group,
			summary: summarize(materials[group]?.body),
		}),
	);
}

/** Build the compact index a run is always given, whatever its focus. */
export function buildChatProjectIndex(input: ChatIndexInput): ChatProjectIndex {
	if (
		!input.doc &&
		!input.slides?.length &&
		!input.posts?.length &&
		!input.materials &&
		!input.references?.length &&
		!input.assets?.length
	) {
		return EMPTY_CHAT_PROJECT_INDEX;
	}
	return {
		story: storyEntries(input),
		timeline: timelineEntries(input.doc),
		materials: materialEntries(input.materials),
		references: (input.references ?? []).map((ref) => ({
			kind: "reference" as const,
			id: ref.id,
			label: ref.label ?? ref.id,
		})),
		assets: (input.assets ?? []).map((asset) => ({
			kind: "asset" as const,
			id: asset.id,
			label: asset.label ?? asset.id,
			summary: asset.kind,
		})),
	};
}
