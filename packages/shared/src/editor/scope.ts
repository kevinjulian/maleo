/* The editable scope the editor command vocabulary operates on.
 *
 * Plain JSON data only: every value here survives `JSON.stringify` unchanged,
 * which is what lets a command and the scope it runs against cross a process,
 * WASM or FFI boundary (`timeline-edit-commands`). */
import type { AudioOverlayKind } from "../audio-overlays.ts";
import type { CaptionConfig } from "../caption-config.ts";
import type { ImportedMediaFields } from "../media-import.ts";
import type { ProjectMaterials } from "../project-materials.ts";
import type { TimelineDoc } from "../timeline-doc.ts";
import type * as EngineTypes from "./engine-types.generated.ts";
import type { TrackFlags } from "../timeline-model.ts";

/* The editable timeline document. A plain `TimelineDoc` plus the editor's own
 * caption config and track flags. */
export interface EditorDoc
	extends Omit<TimelineDoc, "schemaVersion">, Omit<EngineTypes.EditorDoc, "clips" | "markers"> {
	captions?: CaptionConfig;
	/* Per-track hide/mute/lock. On the document because it is persisted with the
	 * storyboard and read back from it, and because `trackVisibility` decides what
	 * a render contains — restoring a version has to reproduce what it rendered.
	 * It was component state in the shell for as long as `EditorDoc` had no slot
	 * for it, which made it look like chrome. It is not. */
	trackFlags?: TrackFlags;
	/* The project's generation context — Story, Visual, Voice, Rules. On the document
	 * for the same reason `projectReferences` is: it is what generation reads, it
	 * persists with the storyboard, and it is written with the row at create so a
	 * reload racing the debounced autosave still sees what the preset applied. */
	materials?: ProjectMaterials;
}

export interface Slide {
	/* Stable identity, minted once and carried through generation, reorder, save
	 * and reload. `id` below is a render ordinal and changes when slides move —
	 * anything that has to name THIS slide later (an agent result declaring what
	 * it changed, a fenced apply) uses `key`, never `id`. */
	key: string;
	id: number;
	name?: string;
	cap: string;
	vis: string;
	img: boolean;
	seed?: number;
	src?: string;
	refIds?: string[];
	noteIds?: string[];
}

export interface Post {
	/** Stable identity — see the note on `Slide.key`. */
	key: string;
	id: number;
	body: string;
	img: boolean;
	seed?: number;
	src?: string;
}

export interface MediaAsset extends ImportedMediaFields {
	id: string;
	label: string;
	url: string;
	kind: "image" | "video" | "audio";
	/** Which audio track this belongs on, when `kind` is `"audio"`. Recorded at
	 *  admission because the browsing surface is the only thing that knows —
	 *  nothing about an mp3 says whether it is a bed or a sound effect. */
	audioKind?: AudioOverlayKind;
	thumb?: string; // poster for video, art for audio
	/** Server-made first frame of this video. Never the input image. */
	poster?: string;
	dur?: number; // seconds
	favorite?: boolean;
	source: "generated" | "stock" | "upload" | "reference";
	lifecycle?: "active" | "archived" | "locked";
	provenance?: {
		copiedFromGlobalRefId?: string;
		copiedFromGlobalRefVersion?: number;
	};
}

/** The full undoable editing surface across all three content types. */
export type EditScope = {
	[K in keyof EngineTypes.EditScope]: K extends "doc"
		? EditorDoc
		: K extends "mediaAssets"
			? MediaAsset[]
			: K extends "slides"
				? Slide[]
				: K extends "posts"
					? Post[]
					: EngineTypes.EditScope[K];
};
