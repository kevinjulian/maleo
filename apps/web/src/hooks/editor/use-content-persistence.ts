/* Maleo — debounced persistence for a content project: the versioned
 * storyboard, the decoupled editor state (chat + media library), and the
 * project meta. Three independent debounces, lifted out of CreateContent so the
 * container holds state, not save plumbing. */
import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { captionStateFingerprint, readStoryboardDocument } from "@maleo/shared";
import { saveEditorState, saveStoryboard, updateProjectMeta } from "@api/projects.ts";
import { storyboardJson } from "@models/storyboard/document-wire.ts";
import { errMsg } from "@models/core/cc-helpers.ts";
import { useDebouncedSave } from "./use-debounced-save.ts";
import type {
	AudioOverlay,
	Chapter,
	Config,
	ContentType,
	EffectClip,
	InfographicOverlay,
	InfographicStyle,
	PacingDevices,
	ProjectSelection,
	Scene,
	TextOverlay,
	TrackFlags,
	TransitionClip,
	VideoOverlay,
	Clip,
	ProjectMaterials,
	RenderPresentation,
	SceneMarker,
	CaptionConfig,
	CaptionSet,
	CreativeDirection,
	Bookmark,
} from "@maleo/shared";
import type { ChatLogMessage } from "@models/chat/chat-log.ts";
import type { HookVariant, Post, Slide } from "@models/content/content-types.ts";
import type { MediaAsset } from "@models/timeline/editor-media.ts";
import type { GlobalSettings } from "@models/presets/creative-settings.ts";
import type { SaveState } from "@models/content/create-content-model.ts";
import type { ElementSourceMap, RenderOverrides } from "@models/presets/element-sources.ts";
import type { ConversationDecision } from "@maleo/shared";

interface StoryboardBundle {
	clips: Clip[];
	scenes: Scene[];
	slides: Slide[];
	posts: Post[];
	overlays: TextOverlay[];
	audioOverlays: AudioOverlay[];
	videoOverlays: VideoOverlay[];
	infographicOverlays: InfographicOverlay[];
	effects: EffectClip[];
	transitions: TransitionClip[];
	captions: CaptionConfig;
	captionSet?: CaptionSet;
	pacingDevices: PacingDevices;
	infographicStyle: InfographicStyle;
	projectReferences: ProjectSelection;
	/* The project's generation context. Versioned with the storyboard because it is
	 * what the generation READ — restoring a version has to reproduce what produced
	 * it, and materials decide that as much as the clips do. */
	materials: ProjectMaterials;
	markers: SceneMarker[];
	/* Carried through the autosave, not re-derived. Without it the write would
	 * resolve chapters to null and the editor would wipe them the first time it
	 * saved anything — the document distinguishes "never had chapters" from
	 * "operator deleted them all", and an omission reads as the first. */
	chapters: Chapter[] | null;
	bookmarks?: Bookmark[];
	/* Render-affecting presentation. It also rides in the editor state, which is the
	 * desk's working copy; the document's copy is the one a restored version renders
	 * with. Only the document's is versioned. */
	trackFlags: TrackFlags;
	presentation: RenderPresentation;
}

interface EditorStateBundle {
	chatMessages: ChatLogMessage[];
	mediaAssets: MediaAsset[];
	settings: GlobalSettings;
	trackFlags: TrackFlags;
	hookVariants: HookVariant[];
	direction: CreativeDirection;
	/* Provenance rides along even while nothing mutates it yet. `setContentEditorState`
	 * REPLACES editor_state_json wholesale, so a save that omits these keys deletes
	 * whatever was on disk — a project would lose its sources on the first autosave
	 * after loading. Carrying them through the desk makes load -> save a round-trip
	 * instead of a silent erase. */
	elementSources: ElementSourceMap;
	renderOverrides: RenderOverrides;
	activePresetId: string;
	/* Settled approvals and clarifications, recorded when the user answered them.
	 * Carried here for the same reason as the provenance fields above — the save
	 * replaces `editor_state_json` wholesale, so omitting them erases them. */
	decisions: ConversationDecision[];
}

/** What the hook hands back: the immediate write, for callers holding something
 *  that must not wait out the debounce. */
export interface ContentPersistence {
	flushStoryboard: () => ReturnType<typeof saveStoryboard>;
	flushEditorState: (overrides?: Partial<EditorStateBundle>) => Promise<void>;
	retrySave: () => Promise<void>;
	retrying: boolean;
}

export function useContentPersistence(input: {
	/* Required, both of them. This used to ask `screen === "work" && !!projectId
	 * && !!type` — three conditions for one fact, the editor is open on a real
	 * project. Only the editor page mounts this hook, and that page has an id
	 * from the route and a type from the loaded project, so mounting IS the
	 * condition. The `screen` string it also took was untyped: `"wrok"` compiled
	 * and silently disabled autosave. */
	projectId: string;
	loadedCaptionState: string | null;
	type: ContentType | null;
	storyboard: StoryboardBundle;
	editorState: EditorStateBundle;
	config: Config;
	setSaveState: Dispatch<SetStateAction<SaveState>>;
	setSaveError: Dispatch<SetStateAction<string | null>>;
}): ContentPersistence {
	const {
		projectId,
		loadedCaptionState,
		type,
		storyboard: sb,
		editorState: es,
		config,
		setSaveState,
		setSaveError,
	} = input;
	const [retrying, setRetrying] = useState(false);
	const savedCaptionState = useRef<{ project: string; fingerprint: string } | null>(null);
	if (type && loadedCaptionState !== null && savedCaptionState.current?.project !== projectId)
		savedCaptionState.current = { project: projectId, fingerprint: loadedCaptionState };
	const pendingSave = useRef<Promise<unknown>>(Promise.resolve());
	const writeStoryboard = (): ReturnType<typeof saveStoryboard> => {
		const base = savedCaptionState.current;
		const snapshot = storyboardJson(
			type!,
			{ scenes: sb.scenes, slides: sb.slides, posts: sb.posts },
			{
				clips: type === "video" ? sb.clips : undefined,
				overlays: sb.overlays,
				audioOverlays: sb.audioOverlays,
				videoOverlays: sb.videoOverlays,
				infographicOverlays: sb.infographicOverlays,
				effects: sb.effects,
				transitions: sb.transitions,
				captions: sb.captions,
				captionSet: sb.captionSet,
				pacingDevices: sb.pacingDevices,
				infographicStyle: sb.infographicStyle,
				projectReferences: sb.projectReferences,
				materials: sb.materials,
				markers: sb.markers,
				chapters: sb.chapters,
				bookmarks: sb.bookmarks,
				trackFlags: sb.trackFlags,
				presentation: sb.presentation,
			},
		);
		const save = pendingSave.current
			.catch(() => {})
			.then(async () => {
				const result = await saveStoryboard(projectId, snapshot, base?.fingerprint);
				if (base)
					base.fingerprint = captionStateFingerprint(
						readStoryboardDocument(result.storyboard_json ?? snapshot).doc,
					);
				return result;
			});
		pendingSave.current = save;
		return save;
	};

	// Debounced auto-save: persist the working storyboard (incl. generated images)
	// whenever scenes/slides/posts change while editing a saved project. Skips the
	// first run after a load so we don't immediately re-save unchanged content.
	useDebouncedSave(
		!!type,
		[
			sb.clips,
			sb.captionSet,
			sb.scenes,
			sb.slides,
			sb.posts,
			sb.overlays,
			sb.audioOverlays,
			sb.videoOverlays,
			sb.infographicOverlays,
			sb.effects,
			sb.transitions,
			sb.captions,
			sb.pacingDevices,
			sb.infographicStyle,
			sb.projectReferences,
			sb.materials,
			sb.markers,
			sb.chapters,
			sb.bookmarks,
			sb.trackFlags,
			sb.presentation,
			projectId,
			type,
		],
		1200,
		() => {
			setSaveState("saving");
			void writeStoryboard()
				.then(() => setSaveState("saved"))
				.catch((err) => {
					setSaveState("failed");
					setSaveError(`Auto-save failed: ${errMsg(err)}`);
				});
		},
	);

	/* One writer for editor state, used by both the debounce and the immediate
	 * flush. `overrides` exists because a caller that just changed something and
	 * needs it durable NOW holds the new value, while `es` still holds the old one
	 * until React re-renders. */
	const writeEditorState = (overrides?: Partial<EditorStateBundle>): Promise<void> => {
		const next = { ...es, ...overrides };
		return saveEditorState(projectId, {
			chat: next.chatMessages,
			mediaAssets: next.mediaAssets,
			settings: next.settings,
			trackFlags: next.trackFlags,
			hookVariants: next.hookVariants,
			direction: next.direction,
			elementSources: next.elementSources,
			renderOverrides: next.renderOverrides,
			activePresetId: next.activePresetId,
			decisions: next.decisions,
		});
	};

	// Editor state (chat + media library) saves on its own debounce, decoupled from
	// the versioned storyboard so it isn't duplicated per version or lost on a
	// partial storyboard write.
	useDebouncedSave(
		true,
		[
			es.chatMessages,
			es.mediaAssets,
			es.settings,
			es.trackFlags,
			es.hookVariants,
			es.direction,
			es.elementSources,
			es.renderOverrides,
			es.activePresetId,
			es.decisions,
			projectId,
		],
		1200,
		() => {
			void writeEditorState().catch((err) => {
				setSaveState("failed");
				setSaveError(`Auto-save failed: ${errMsg(err)}`);
			});
		},
	);

	// Debounced project-meta save (title / description / audience / platform).
	useDebouncedSave(true, [config, projectId], 1000, () => {
		void updateProjectMeta(projectId, {
			...(config.title?.trim() ? { title: config.title.trim() } : {}),
			brief_json: {
				goal: config.brief?.trim() || null,
				workspace_profile: config.audience?.trim() || null,
				style_preset: config.style ?? null,
				style_preset_name: config.styleName ?? null,
				style_preset_description: config.styleDescription ?? null,
			},
			target_audience: config.audience?.trim() || null,
			target_platform: config.platform ?? null,
			reference_notes: config.description?.trim() || null,
		}).catch(() => {
			/* non-fatal */
		});
	});

	/* Exposed so a caller holding something that must not be lost — a settled
	 * decision — can make it durable immediately instead of waiting out a 1200ms
	 * debounce that a reload or unmount cancels outright. */
	const retrySave = async (): Promise<void> => {
		if (retrying || !type) return;
		setRetrying(true);
		setSaveState("saving");
		try {
			await Promise.all([writeStoryboard(), writeEditorState()]);
			setSaveState("saved");
			setSaveError(null);
		} catch (error) {
			setSaveState("failed");
			setSaveError(`Save failed: ${errMsg(error)}`);
		} finally {
			setRetrying(false);
		}
	};
	return {
		flushStoryboard: writeStoryboard,
		flushEditorState: writeEditorState,
		retrySave,
		retrying,
	};
}
