/* The editor's document, in the shapes the API stores.
 *
 * Pure: nothing here makes a request. These four functions used to live in the
 * HTTP client, which meant a caller that only wanted to shape a storyboard
 * imported the chat agent and the render pipeline with it. They read the editor's
 * own state types (`Config`, `RefsState`, the scene arrays), so they belong beside
 * the document rather than in `@maleo/shared` — sharing them would drag the
 * editor's local state across a package boundary for no gain. */
import type {
	AudioOverlay,
	Config,
	ContentType,
	EffectClip,
	InfographicOverlay,
	InfographicStyle,
	PacingDevices,
	ProjectSelection,
	RefsState,
	Scene,
	Speaker,
	TextOverlay,
	TransitionClip,
	VideoOverlay,
	Clip,
	ContentProjectBrief,
	ProjectMaterials,
	RenderPresentation,
	SceneMarker,
	Chapter,
	SpeakerPayload,
	TrackFlags,
	CaptionConfig,
	CaptionSet,
	Bookmark,
} from "@maleo/shared";
import type { Post, Slide } from "@models/content/content-types.ts";
import {
	EMPTY_PROJECT_SELECTION,
	toTimelineDoc,
	writeStoryboardDocument,
	EMPTY_PROJECT_MATERIALS,
	SCENE_TEXT_CLIP_MIGRATION_VERSION,
} from "@maleo/shared";
import { resolveVoice } from "@models/references/voice-library.ts";

/** Translate the wizard config into a content-project brief blob. */
export function briefFromConfig(config: Config): ContentProjectBrief {
	return {
		goal: config.brief?.trim() || null,
		workspace_profile: config.audience?.trim() || null,
		style_preset: config.style ?? null,
		style_preset_name: config.styleName ?? null,
		style_preset_description: config.styleDescription ?? null,
	};
}

/** What a project carries besides its items; the video document reads all of it. */
export interface StoryboardJsonExtra {
	clips?: Clip[];
	overlays?: TextOverlay[];
	audioOverlays?: AudioOverlay[];
	videoOverlays?: VideoOverlay[];
	infographicOverlays?: InfographicOverlay[];
	effects?: EffectClip[];
	transitions?: TransitionClip[];
	captions?: CaptionConfig;
	captionSet?: CaptionSet;
	pacingDevices?: PacingDevices;
	infographicStyle?: InfographicStyle;
	projectReferences?: ProjectSelection;
	materials?: ProjectMaterials;
	markers?: SceneMarker[];
	chapters?: Chapter[] | null;
	bookmarks?: Bookmark[];
	trackFlags?: TrackFlags;
	presentation?: RenderPresentation;
}

type StoryboardItems = { scenes?: Scene[]; slides?: Slide[]; posts?: Post[] };

/** Build a storyboard JSON document from the current editing state. */
export function storyboardJson(
	type: "video",
	items: StoryboardItems,
	extra?: StoryboardJsonExtra,
): ReturnType<typeof writeStoryboardDocument>;
export function storyboardJson(
	type: ContentType,
	items: StoryboardItems,
	extra?: StoryboardJsonExtra,
): Record<string, unknown>;
export function storyboardJson(
	type: ContentType,
	items: StoryboardItems,
	extra?: StoryboardJsonExtra,
) {
	if (type === "video") {
		// schemaVersion 2 clip-first contract: the timeline persists as one
		// clips[] surface + semantic markers[], not separate scene/overlay arrays.
		// Clip-native (group 2): callers pass `clips` straight from the store's document;
		// legacy/test callers pass the arrays and we project once via `toTimelineDoc`.
		const doc = extra?.clips
			? null
			: toTimelineDoc(
					items.scenes ?? [],
					extra?.videoOverlays ?? [],
					extra?.overlays ?? [],
					extra?.audioOverlays ?? [],
					extra?.effects ?? [],
					extra?.transitions ?? [],
					extra?.projectReferences,
					extra?.infographicOverlays ?? [],
				);
		// One writer for the persisted document. The editor holds no agent bookkeeping,
		// so it passes those through as absent — a caller that DOES hold them (the
		// agent) reads the prior document and supplies them, rather than letting
		// absence quietly mean "not mine".
		return writeStoryboardDocument({
			schemaVersion: 2,
			sceneTextClipMigrationVersion: SCENE_TEXT_CLIP_MIGRATION_VERSION,
			clips: extra?.clips ?? doc!.clips,
			// First-class markers persist from the store's document (with authoritative
			// title/beat metadata); fall back to the scene-derived markers when absent.
			markers: extra?.markers ?? doc?.markers ?? [],
			/* Null, not `[]`, when the editor has none: absence is what tells the next
			 * read to seed them, and writing an empty array would say the operator
			 * deleted every chapter. */
			chapters: extra?.chapters ?? doc?.chapters ?? null,
			bookmarks: extra?.bookmarks ?? null,
			projectReferences:
				extra?.projectReferences ?? doc?.projectReferences ?? EMPTY_PROJECT_SELECTION,
			materials: extra?.materials ?? EMPTY_PROJECT_MATERIALS,
			captions: extra?.captions ?? null,
			captionSet: extra?.captionSet ?? null,
			pacingDevices: extra?.pacingDevices ?? null,
			infographicStyle: extra?.infographicStyle ?? null,
			// Render-affecting presentation versions with the document: restoring this
			// storyboard has to reproduce what it rendered, and track visibility and the
			// aspect/brand decide what a render contains.
			trackFlags: extra?.trackFlags ?? null,
			presentation: extra?.presentation ?? null,
			unitLifecycle: null,
			artifacts: [],
		});
	}
	if (type === "image") {
		return {
			projectReferences: extra?.projectReferences ?? EMPTY_PROJECT_SELECTION,
			materials: extra?.materials ?? EMPTY_PROJECT_MATERIALS,
			slides: (items.slides ?? []).map((s) => ({
				key: s.key,
				name: s.name ?? null,
				caption: s.cap,
				visual: s.vis,
				image: s.src ?? null,
				reference_ids: s.refIds ?? [],
				note_ids: s.noteIds ?? [],
			})),
		};
	}
	return {
		projectReferences: extra?.projectReferences ?? EMPTY_PROJECT_SELECTION,
		materials: extra?.materials ?? EMPTY_PROJECT_MATERIALS,
		posts: (items.posts ?? []).map((p) => ({
			key: p.key,
			body: p.body,
			has_image: p.img,
			image: p.src ?? null,
		})),
	};
}

/** The project's speakers, for `project_speaker`. Video-only: the other content
 *  types have no narrated scenes to assign a voice to. */
export function speakersFromState(type: ContentType, refs: RefsState): SpeakerPayload[] {
	if (type !== "video") return [];
	return refs.speakers.map((s: Speaker) => {
		const info = resolveVoice(s);
		return {
			voice_key: s.voiceId ?? s.id,
			name: s.name,
			hue: info.hue,
			is_default: s.default ?? false,
		};
	});
}
