import type { Bookmark } from "@maleo/shared";
/* Pure parse of a loaded content project into the editor's runtime state shape.
 *
 * Extracted from CreateContent's load effect: given the API project detail, build
 * every editor array/config the component needs, replicating the three storyboard
 * shapes (schemaVersion-2 video clip doc, legacy V1 video, image, text) plus the
 * editor_state (chat/media/settings/track-flags) and persisted project references.
 * No React, no I/O — the effect just fans the result out to setters. */
import {
	fromTimelineDoc,
	migrateLaneGroups,
	seedChapters,
	type Chapter,
	type Clip,
	type ProjectNoteWire,
	type ProjectSpeakerWire,
	rebuildDocWith,
	type ReferenceEntityWire,
	type SceneMarker,
	styleKnobsSchema,
	type StyleKnobs,
	normalizeSceneClips,
	resequenceScenes,
	DEFAULT_CAPTIONS,
	type CaptionConfig,
	type CaptionSet,
	readStoryboardDocument,
	captionStateFingerprint,
	readStoryboardPosts,
	readStoryboardSlides,
	repairEntityKeys,
	type ConversationDecision,
	SLIDE_KEY_PREFIX,
	POST_KEY_PREFIX,
	resolveProjectMaterials,
	SCENE_TEXT_CLIP_MIGRATION_VERSION,
	type CreativeDirection,
	type ProjectMaterials,
} from "@maleo/shared";
import { clipId, type ClipSource } from "@models/timeline/timeline-clips.ts";
import {
	DEFAULT_INFOGRAPHIC_STYLE,
	DEFAULT_PACING_DEVICES,
} from "@models/presets/generation-defaults.ts";
import { hashHue } from "@models/core/measures.ts";
import type {
	AudioOverlay,
	Config,
	ContentType,
	EffectClip,
	InfographicOverlay,
	InfographicStyle,
	Note,
	PacingDevices,
	ProjectSelection,
	RefImage,
	Scene,
	Speaker,
	TextOverlay,
	TrackFlags,
	TransitionClip,
	VideoOverlay,
} from "@maleo/shared";
import type { ChatLogMessage } from "@models/chat/chat-log.ts";
import type { HookVariant, Post, Slide } from "@models/content/content-types.ts";
import type { MediaAsset } from "@models/timeline/editor-media.ts";
import {
	DEFAULT_SETTINGS,
	settingsWithPresentation,
	type GlobalSettings,
} from "@models/presets/creative-settings.ts";
import {
	parseDecisions,
	parseDirection,
	parseHookVariants,
	parseMediaAssets,
	resolveSettings,
	settleChat,
} from "./loaded-editor-state.ts";
import { migrateSceneTextOverlays } from "./scene-text-overlays.ts";
import {
	parseElementSources,
	parseRenderOverrides,
	type ElementSourceMap,
	type RenderOverrides,
} from "@models/presets/element-sources.ts";
import { foldPresentationOverSettings } from "@models/presets/element-writes.ts";
import { SETTINGS_ELEMENT_PATHS } from "@models/presets/element-paths.ts";
import { readAgentEditMarker, type AgentEditMarker } from "@maleo/shared/editor";

export interface LoadedProjectDetail {
	project: {
		id: string;
		title: string;
		type: ContentType;
		target_audience: string | null;
		target_duration_sec: number | null;
		target_format: string | null;
		target_platform: string | null;
		brief_json: {
			goal?: string | null;
			style_preset?: unknown;
			style_preset_name?: string | null;
			style_preset_description?: string | null;
		} | null;
		reference_notes?: string | null;
		editor_state_json?: EditorStateJson | null;
	};
	storyboards: Array<{ storyboard_json: StoryboardJson }>;
	/** The command log sequence of the loaded version (`p1-command-log`). */
	commandSeq?: number;
	/** The project's selected reference entities, as domain objects. The server
	 *  maps its rows once (`lib/wire/reference-entity.ts`), so nothing here parses
	 *  `tags_json` or compares `is_primary` to 1. */
	entities?: ReferenceEntityWire[];
	/** Text-only project notes, as domain objects. */
	notes?: ProjectNoteWire[];
	/** The project's voice identities, as domain objects. */
	speakers?: ProjectSpeakerWire[];
}

export interface ParsedProject {
	projectId: string;
	/** Saved caption state before editor-only lane migration. */
	persistedCaptionState: string;
	type: ContentType;
	config: Config;
	scenes: Scene[];
	slides: Slide[];
	posts: Post[];
	/** True only when legacy slide/post identity changed during this read. Caller
	 * must persist the repaired document before exposing it to another reload. */
	entityKeysRepaired: boolean;
	/** The `agentEdit` marker of the loaded version: which agent run's commands it
	 *  already holds, so settling that run does not apply them again. */
	agentEdit?: AgentEditMarker;
	/** Where the editor's command log reading starts. */
	commandSeq: number;
	overlays: TextOverlay[];
	audioOverlays: AudioOverlay[];
	videoOverlays: VideoOverlay[];
	infographicOverlays: InfographicOverlay[];
	effects: EffectClip[];
	transitions: TransitionClip[];
	/** Seed clips for the canonical document (clip-native load target): the store is
	 *  seeded from these directly, so arrays are NOT re-projected at load. */
	clips: Clip[];
	/** The project's chapters. Seeded on read when the document carries none, so
	 *  the script view always has something to render into; a document that has
	 *  them keeps them. Seeding is a READ, not a write — it does not mark the
	 *  project changed, it just means the next legitimate save persists what was
	 *  derived. */
	chapters: Chapter[];
	bookmarks?: Bookmark[];
	/** First-class scene markers loaded from the persisted v2 storyboard (D3),
	 *  already merged with the scene-derived ranges — ready to seed the store. */
	markers: SceneMarker[];
	projectReferences: ProjectSelection;
	/* The project's generation context. Read from the document when it carries one;
	 * otherwise DERIVED from the pre-materials fields, so a project written before
	 * materials existed opens with the guidance it already had rather than blank. */
	materials: ProjectMaterials;
	captions: CaptionConfig;
	captionSet?: CaptionSet;
	pacingDevices: PacingDevices;
	infographicStyle: InfographicStyle;
	mediaAssets: MediaAsset[];
	chatMessages: ChatLogMessage[];
	trackFlags: TrackFlags;
	settings: GlobalSettings;
	/** Saved A/B hook takes (editor_state_json.hook_variants). */
	hookVariants: HookVariant[];
	/** Creative direction (editor_state_json.direction), migrating a legacy
	 *  project-reference prompt into the visual channel when absent. */
	direction: CreativeDirection;
	/** Which layer supplied each element. Empty for a project persisted before
	 *  provenance existed — every element then reads as operator-owned, which is the
	 *  direction that cannot destroy work. */
	elementSources: ElementSourceMap;
	/** This project's own values for render-scope elements, sitting between the
	 *  timeline template and the operator so a project can diverge from a shared row
	 *  without mutating it. */
	renderOverrides: RenderOverrides;
	/** Settled approvals and clarifications from earlier in this project's chat.
	 *  Typed records written when the user answered, not inferred from the
	 *  transcript — the message log carries no decision semantics to infer from. */
	decisions: ConversationDecision[];
	/** The preset the project is on, or "" when it is on none. */
	activePresetId: string;
	/** Values the read could not interpret, named rather than dropped silently.
	 *  A style that is still a pre-knobs identifier lands here. */
	unresolved: string[];
	/** Persisted project references, split for the library/refs merge. */
	projSpeakers: Speaker[];
	projImages: RefImage[];
	projNotes: Note[];
}

/* The editor state the web writes and reads back; the server stores it opaquely
 * as `editor_state_json`. Declared rather than cast field-by-field — the keys are
 * snake_case because that is how they persist, and every value is optional
 * because a project saved by an older build has fewer of them. */
export interface EditorStateJson {
	chat?: ChatLogMessage[];
	decisions?: unknown;
	media_assets?: MediaAsset[];
	track_flags?: TrackFlags;
	settings?: Partial<GlobalSettings>;
	hook_variants?: HookVariant[];
	direction?: CreativeDirection;
	/* Which layer supplied each element, and this project's own values for
	 * render-scope elements. Both OPTIONAL: a project written before provenance
	 * existed carries neither, and that absence is meaningful — a missing source
	 * reads as operator-owned, so nothing predating this gets overwritten on the
	 * strength of not knowing. Typed as unknown because they are parsed, not cast. */
	element_sources?: unknown;
	render_overrides?: unknown;
	/* Which preset the project is currently on. Recorded so "hand this element back"
	 * can mean revert-to-that-preset rather than reset-to-default, and so a push has a
	 * target. Per-element sources cannot answer it: an operator-owned element carries no
	 * defaulterId, which is exactly the element a revert is asked about. */
	active_preset_id?: unknown;
	/* The generated style bible, for projects that persisted it here before it
	 * became a Visual material. Read-only migration input: nothing writes it. */
	style_bible?: unknown;
}

/* The persisted storyboard, as this module still needs to see it.
 *
 * The shape and its decoding belong to `@maleo/shared`'s storyboard document, and
 * every field the document declares is read through `readStoryboardDocument` — so
 * none of them appear here. What is left is the two EDITOR-STATE keys older
 * documents carried before that column existed, and the image/text variants the
 * document contract deliberately leaves opaque (the blob has no discriminant for
 * them). Declaring only these makes reading around the document a type error
 * rather than a habit. */
export interface StoryboardJson {
	/** Editor state, from before it moved to `editor_state_json`. */
	media_assets?: unknown;
	chat?: unknown;
	/** The other content types. Opaque on this path by design — the document
	 *  contract is video-only, and these branches keep reading them by hand. */
	slides?: unknown;
	posts?: unknown;
	/** Everything else a persisted blob carries, including every field the document
	 *  declares and every historical spelling of one. Untyped on purpose: naming a
	 *  document field here is what invites reading it directly. */
	[key: string]: unknown;
}

/* Project references for the editor.
 *
 * Prefers the entity model: role comes from reference_entity.role (DB-constrained),
 * so this path needs no kind filtering and no fallback. The legacy branch below
 * still filters content_references, because that table mixes asset types (note,
 * audio, research) with scene roles in one `kind` column — the conflation this
 * redesign removes.
 *
 * `notes` are now their own table rather than kind='note' rows. */
function parseNoteRows(notes: LoadedProjectDetail["notes"]): Note[] {
	return (Array.isArray(notes) ? notes : []).map((n) => ({
		id: n.id,
		label: n.label,
		body: n.body,
		tags: n.tags,
		default: n.isDefault,
	}));
}

/** The project's speakers, read from the speaker store. */
export function parseProjectSpeakers(speakers: LoadedProjectDetail["speakers"]): Speaker[] {
	return (Array.isArray(speakers) ? speakers : []).map((s) => ({
		id: s.voiceKey,
		name: s.name,
		voiceId: s.voiceKey,
		hue: s.hue ?? undefined,
		default: s.isDefault,
	}));
}

/* The project's reference library and notes, read from the entity model.
 *
 * The legacy branch that read `content_references` is gone with the table. It
 * existed so an unmigrated project still loaded, and it carried the per-consumer
 * exclusion list (`kind !== "note" && !== "audio" && !== "research"`) that the
 * entity model replaced with a role column — castability is a property of the
 * entity now, so a citation or a note cannot reach this list at all. */
/** Clips after lane migration, with a re-laner for the legacy per-type arrays
 *  this parse also returns. Those arrays are a projection of the same clips, so
 *  leaving them on the pre-migration rows would have one load handing back two
 *  answers for a clip's track. */
interface LanedClips {
	clips: Clip[];
	trackFlags: TrackFlags;
	rows: <T extends { id: number; track?: number }>(source: ClipSource, items: T[]) => T[];
}

/** The project-level reference library split into the two shapes the editor
 *  keeps it in: image refs and free notes. */
export interface ParsedProjectRefs {
	projImages: RefImage[];
	projNotes: Note[];
}

/** A document rebuilt from the legacy per-type arrays. Markers come back out
 *  because rebuilding can add scene markers the caller did not pass in. */
interface SeededDoc {
	clips: Clip[];
	markers: SceneMarker[];
}

export function parseProjectRefs(
	entities?: LoadedProjectDetail["entities"],
	notes?: LoadedProjectDetail["notes"],
): ParsedProjectRefs {
	const projImages = (Array.isArray(entities) ? entities : []).map((e): RefImage => ({
		id: e.id,
		label: e.label,
		imageUrl: e.imageUrl ?? undefined,
		seed: hashHue(e.id),
		description: e.description || undefined,
		tags: e.tags,
		role: e.role,
		primary: e.primary,
		generated: e.origin === "generated",
	}));
	return { projImages, projNotes: parseNoteRows(notes) };
}

/** Project the loaded per-type arrays into the canonical seed document ONCE (clip
 *  source of truth), merging persisted marker metadata onto the derived ranges. This
 *  is the single load-time array→clip boundary; the store seeds from `.clips` so no
 *  reader re-projects arrays afterward. Byte-identical to the prior CreateContent
 *  `toTimelineDoc(...) + mergeMarkerMetadata` seed (gated by parse-loaded tests). */
/* A project's style is a knob snapshot. A string here is a pre-knobs identifier
 * the backfill has not converted; there is no lookup table to fall back on, so it
 * reads as no style and is NAMED. Silently substituting a default style would be
 * worse than an undirected render: it would look deliberate. */
function readStyleSnapshot(raw: unknown, unresolved: string[]): StyleKnobs | null {
	if (raw === null || raw === undefined) return null;
	const parsed = styleKnobsSchema.safeParse(raw);
	if (parsed.success) return parsed.data;
	unresolved.push(typeof raw === "string" ? `style_preset:${raw}` : "style_preset");
	return null;
}

function buildSeed(
	a: {
		scenes: Scene[];
		videoOverlays: VideoOverlay[];
		textOverlays: TextOverlay[];
		audioOverlays: AudioOverlay[];
		infographicOverlays: InfographicOverlay[];
		effects: EffectClip[];
		transitions: TransitionClip[];
	},
	markers: SceneMarker[],
	projectReferences: ProjectSelection,
): SeededDoc {
	const doc = rebuildDocWith(
		{ schemaVersion: 2, clips: [], markers, projectReferences },
		{
			scenes: a.scenes,
			videoOverlays: a.videoOverlays,
			textOverlays: a.textOverlays,
			audioOverlays: a.audioOverlays,
			infographicOverlays: a.infographicOverlays,
			effects: a.effects,
			transitions: a.transitions,
			projectReferences,
		},
	);
	return { clips: doc.clips, markers: doc.markers };
}

export function parseLoadedProject(detail: LoadedProjectDetail): ParsedProject {
	const project = detail.project;
	const unresolved: string[] = [];
	const loadedFormat = project.target_format ?? undefined;
	const config: Config = {
		title: project.title ?? undefined,
		brief: project.brief_json?.goal ?? undefined,
		description: project.reference_notes ?? undefined,
		audience: project.target_audience ?? undefined,
		length: project.target_duration_sec ? String(project.target_duration_sec) : undefined,
		format: loadedFormat,
		platform: project.target_platform ?? undefined,
		style: readStyleSnapshot(project.brief_json?.style_preset, unresolved),
		styleName: project.brief_json?.style_preset_name ?? undefined,
		styleDescription: project.brief_json?.style_preset_description ?? undefined,
	};
	const latestStoryboard = detail.storyboards[0]?.storyboard_json ?? null;
	// One read of the persisted document, and the only one. Everything the document
	// owns — clips, markers, the selection, captions and the doc-level style config,
	// plus the legacy arrays a pre-v2 document still carries — comes from `read`.
	// Reading a document field off `latestStoryboard` below would skip the tolerant
	// decode this call just performed; the raw blob is consulted only for the two
	// EDITOR-STATE keys older documents still carry (chat, media_assets) and for the
	// image/text variants, which the document contract deliberately leaves opaque.
	const read = readStoryboardDocument(latestStoryboard);
	const doc = read.doc;
	const editorState = project.editor_state_json ?? null;
	const { projImages, projNotes } = parseProjectRefs(detail.entities, detail.notes);
	const projSpeakers = parseProjectSpeakers(detail.speakers);

	// Defaults for fields a given content type doesn't populate (matches the load
	// effect leaving them at their initial useState values on mount).
	const agentEdit = readAgentEditMarker(latestStoryboard);
	const base: ParsedProject = {
		...(agentEdit ? { agentEdit } : {}),
		projectId: project.id,
		commandSeq: detail.commandSeq ?? 0,
		persistedCaptionState: captionStateFingerprint(doc),
		type: project.type,
		config,
		unresolved,
		scenes: [],
		/* Image and text projects have no chapters; the video branches below seed
		 * their own. */
		chapters: [],
		bookmarks: doc.bookmarks ?? undefined,
		slides: [],
		posts: [],
		entityKeysRepaired: false,
		overlays: [],
		audioOverlays: [],
		videoOverlays: [],
		infographicOverlays: [],
		effects: [],
		transitions: [],
		clips: [],
		markers: [],
		projectReferences: doc.projectReferences,
		/* Materials, or the legacy fields read as materials. `direction.visual` and
		 * `projectReferences.prompt` both steered image generation, so both become
		 * visual material; `direction.raw` is deliberately excluded because it is the
		 * UNROUTED original, and folding it into a group re-introduces the leak the
		 * channels exist to prevent. */
		materials: resolveProjectMaterials(doc.materials, {
			direction: parseDirection(editorState?.direction, doc.projectReferences.prompt),
			projectReferences: doc.projectReferences,
			styleBible: typeof editorState?.style_bible === "string" ? editorState.style_bible : null,
		}),
		// The document stores what was persisted; applying the defaults is the
		// consumer's job, and this is the consumer.
		captions: { ...DEFAULT_CAPTIONS, ...doc.captions },
		...(doc.captionSet ? { captionSet: doc.captionSet } : {}),
		pacingDevices: { ...DEFAULT_PACING_DEVICES, ...doc.pacingDevices },
		infographicStyle: { ...DEFAULT_INFOGRAPHIC_STYLE, ...doc.infographicStyle },
		mediaAssets: [],
		chatMessages: [],
		trackFlags: {},
		settings: DEFAULT_SETTINGS,
		hookVariants: parseHookVariants(editorState?.hook_variants),
		elementSources: parseElementSources(editorState?.element_sources),
		renderOverrides: parseRenderOverrides(editorState?.render_overrides),
		activePresetId:
			typeof editorState?.active_preset_id === "string" ? editorState.active_preset_id : "",
		decisions: parseDecisions(editorState?.decisions),
		direction: parseDirection(editorState?.direction, doc.projectReferences.prompt),
		projSpeakers,
		projImages,
		projNotes,
	};

	if (project.type === "video") {
		// Render-affecting presentation comes from the DOCUMENT, so restoring a
		// version reproduces what that version rendered. The editor-state copies are
		// the fallback for projects saved before the document carried them.
		const rawFlags = doc.trackFlags ?? editorState?.track_flags;
		const loadedFlags: TrackFlags = rawFlags && typeof rawFlags === "object" ? rawFlags : {};
		/* Lanes carry a declared group from this change on, and every project saved
		 * before it has none. Migration runs at load rather than in a script because
		 * the untyped documents are already out there — a script reaches the ones in
		 * the database and not the ones in a restored version. It is idempotent by
		 * construction (`laneGroupsAreDeclared` short-circuits it), so a document
		 * pays for it once. */
		const withLanes = (clips: Clip[]): LanedClips => {
			const lanes = migrateLaneGroups(clips, loadedFlags);
			const trackById = new Map(lanes.clips.map((clip) => [clip.id, clip.track]));
			return {
				clips: lanes.clips,
				trackFlags: lanes.trackFlags,
				rows: (source, items) =>
					lanes.migrated
						? items.map((item) => {
								const track = trackById.get(clipId(source, item.id));
								return track == null || track === item.track ? item : { ...item, track };
							})
						: items,
			};
		};
		const mediaAssets = parseMediaAssets(editorState, latestStoryboard);
		/* The document's presentation wins over the editor state, so a restored version
		   opens as it rendered — and where it actually replaces a value, that element is
		   recorded as the operator's. Without that the source map would describe values the
		   fold had just replaced: a later preset apply would overwrite what a restore
		   brought back, and the section tag would name a defaulter that did not supply what
		   is on screen. In the normal case the two agree, so nothing is recorded. */
		const folded = foldPresentationOverSettings({
			settings: resolveSettings(editorState?.settings, loadedFormat),
			fold: (value) => settingsWithPresentation(value, doc.presentation),
			sources: parseElementSources(editorState?.element_sources),
			settingsPaths: SETTINGS_ELEMENT_PATHS,
		});
		const settings = folded.settings;
		if (read.clipFirst) {
			const back = fromTimelineDoc({ schemaVersion: 2, clips: doc.clips, markers: [] });
			const scenes = resequenceScenes(back.scenes.map((s) => normalizeSceneClips(s)));
			const overlays = migrateSceneTextOverlays(
				scenes,
				back.textOverlays,
				doc.sceneTextClipMigrationVersion,
			);
			const projectReferences = back.projectReferences ?? doc.projectReferences;
			// Canonical-doc load: the store's source of truth is clips[]. When the doc is
			// already at the current migration version, seed from the PERSISTED clips
			// verbatim — round-tripping through the legacy scene/overlay projection
			// (fromTimelineDoc -> buildSeed) drops any clip-native field those shapes
			// don't model. Only pre-migration docs need buildSeed to run the one-time
			// scene-text-clip split (a no-op at the current version).
			const migrated = doc.sceneTextClipMigrationVersion === SCENE_TEXT_CLIP_MIGRATION_VERSION;
			const seed = buildSeed(
				{
					scenes,
					videoOverlays: back.videoOverlays,
					textOverlays: overlays,
					audioOverlays: back.audioOverlays,
					infographicOverlays: back.infographicOverlays,
					effects: back.effects,
					transitions: back.transitions,
				},
				doc.markers,
				projectReferences,
			);
			const lanes = withLanes(
				migrated
					? doc.clips
					: [...seed.clips, ...doc.clips.filter((clip) => clip.type === "caption")],
			);
			return {
				...base,
				elementSources: folded.sources,
				scenes,
				/* Only the chapter RECORDS. Membership is derived by the reader that
				 * wants it, never written back here: the clip-first load returns the
				 * persisted clips verbatim, and stamping a seeded `sectionId` onto them
				 * would make a load-then-save emit different bytes than it read. */
				chapters: [...seedChapters(scenes, doc.chapters).chapters],
				overlays: lanes.rows("text", overlays),
				audioOverlays: lanes.rows("audio", back.audioOverlays),
				videoOverlays: lanes.rows("video", back.videoOverlays),
				infographicOverlays: lanes.rows("infographic", back.infographicOverlays),
				effects: lanes.rows("effect", back.effects),
				transitions: back.transitions,
				clips: lanes.clips,
				markers: migrated ? doc.markers : seed.markers,
				projectReferences,
				mediaAssets,
				chatMessages: settleChat(
					Array.isArray(editorState?.chat) ? editorState.chat : latestStoryboard?.chat,
				),
				trackFlags: lanes.trackFlags,
				settings,
			};
		}
		// The legacy arrays are decoded by the document module; this branch keeps the
		// projection — deriving the scene-metadata overlays and seeding clips.
		const {
			scenes,
			textOverlays: parsedTextOverlays,
			audioOverlays,
			videoOverlays,
			effects,
			transitions,
		} = read.legacyArrays;
		const overlays = migrateSceneTextOverlays(
			scenes,
			parsedTextOverlays,
			doc.sceneTextClipMigrationVersion,
		);
		// Legacy V1 has no first-class markers; the seed derives them from the scenes.
		const seed = buildSeed(
			{
				scenes,
				videoOverlays,
				textOverlays: overlays,
				audioOverlays,
				infographicOverlays: [],
				effects,
				transitions,
			},
			base.markers,
			base.projectReferences,
		);
		const lanes = withLanes(seed.clips);
		return {
			...base,
			elementSources: folded.sources,
			scenes,
			chapters: [...seedChapters(scenes, doc.chapters).chapters],
			overlays: lanes.rows("text", overlays),
			audioOverlays: lanes.rows("audio", audioOverlays),
			videoOverlays: lanes.rows("video", videoOverlays),
			effects: lanes.rows("effect", effects),
			transitions,
			clips: lanes.clips,
			markers: seed.markers,
			mediaAssets,
			chatMessages: settleChat(
				Array.isArray(editorState?.chat) ? editorState.chat : latestStoryboard?.chat,
			),
			trackFlags: lanes.trackFlags,
			settings,
		};
	}

	if (project.type === "image") {
		const loadedSlides = readStoryboardSlides(latestStoryboard);
		const repairedSlides = repairEntityKeys(loadedSlides, SLIDE_KEY_PREFIX);
		// The persisted slide is decoded by the module that owns the document; the
		// editor's view of one — its id and the `img` flag — is derived here, the
		// same split the video path makes between decoding and projection.
		return {
			...base,
			/* Keys are repaired before projection: documents written before stable
			 * keys existed carry none, and the positional scheme that preceded them
			 * produced duplicates. Both are fixed here, once, at the load boundary —
			 * nothing downstream should ever meet an ambiguous key. */
			entityKeysRepaired: repairedSlides !== loadedSlides,
			slides: repairedSlides.map((slide, index) => ({
				key: slide.key!,
				id: index + 1,
				name: slide.name,
				cap: slide.caption,
				vis: slide.visual,
				src: slide.image,
				img: Boolean(slide.image),
				refIds: slide.referenceIds,
				noteIds: slide.noteIds,
			})),
		};
	}

	// text
	const loadedPosts = readStoryboardPosts(latestStoryboard);
	const repairedPosts = repairEntityKeys(loadedPosts, POST_KEY_PREFIX);
	return {
		...base,
		entityKeysRepaired: repairedPosts !== loadedPosts,
		posts: repairedPosts.map((post, index) => ({
			key: post.key!,
			id: index + 1,
			body: post.body,
			src: post.image,
			img: Boolean(post.image),
		})),
	};
}
