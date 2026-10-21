/* Maleo — Content-First Create · Data, helpers, constants, types */

import { type ContentType, type Scene } from "@maleo/shared";

export type { Post, Slide } from "@maleo/shared/editor";

export interface ProductCategoryEntry {
	category: string;
	count: number;
}

/** A/B hook take — a saved snapshot of the first scene. Swap takes to compare
 *  hooks, render each, and keep the winner. Persisted in editor_state_json. */

export interface HookVariant {
	id: number;
	label: string;
	scene: Scene;
}

/* `iconName` is a key into the icon registry, not a glyph.
 *
 * Holding the function here made this module import the registry, which is a
 * component module — pure data reaching up into the render layer. Storing the
 * name keeps the direction right and leaves resolution to the call site, which
 * is where a glyph is actually needed.
 *
 * The name is typed `string` rather than a union of registry keys because the
 * registry is annotated `Record<string, ...>` and has no key type to import
 * yet. Deriving one is part of the icon consolidation. */

export interface TypeDef {
	key: ContentType;
	label: string;
	iconName: string;
	blurb: string;
	meta: string[];
}

// Drag-and-drop payload mime for dragging a media URL (All Media) onto a
// timeline video clip or lane.

export const TYPES: TypeDef[] = [
	{
		key: "video",
		label: "Video",
		iconName: "film",
		blurb: "Storyboard plus a frame per scene, voiceover, and speakers.",
		meta: ["Storyboard and frames in one", "Voice per speaker", "15 / 30 / 60s"],
	},
	{
		key: "image",
		label: "Image",
		iconName: "image",
		blurb: "Carousel with generated visuals. Attach your product as a reference.",
		meta: ["Up to 10 slides", "Caption per slide", "1:1 / 4:5 / 9:16"],
	},
	{
		key: "text",
		label: "Text",
		iconName: "type",
		blurb: "Post or thread. Set the writing voice through references, not workspaces.",
		meta: ["Single or thread", "Optional image", "X / Threads / IG"],
	},
];

/** What the create flow offers. Image and text are retired: their projects still
 *  open and label through `TYPES`, but no new one is created. */
export const CREATABLE_TYPES: TypeDef[] = TYPES.filter((type) => type.key === "video");

/* Initial references (shared, attachable) */
