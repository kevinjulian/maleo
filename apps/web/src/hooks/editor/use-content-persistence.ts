/* Maleo — persistence for a content project: the storyboard, the decoupled
 * editor state (chat, settings, provenance), and the project meta. The media
 * library is not here: it is server-owned and changes through the command log
 * (`p1-media-library`).
 *
 * Storyboard edits reach the server as commands through the project command
 * log (`use-command-log.ts`); nothing here posts a whole document. The two
 * stored fields outside the editable scope — pacing devices and presentation —
 * are written alone onto the head on their own debounce
 * (`p1-command-log` D4). Editor state and meta keep their debounces. */
import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { saveEditorState, updateProjectMeta } from "@api/projects.ts";
import { readCommandLog, savePresentation } from "@api/project-commands.ts";
import { errMsg } from "@models/core/cc-helpers.ts";
import { useDebouncedSave } from "./use-debounced-save.ts";
import type { CommandLog } from "./use-command-log.ts";
import type {
	Config,
	ContentType,
	PacingDevices,
	TrackFlags,
	RenderPresentation,
	CreativeDirection,
} from "@maleo/shared";
import type { ChatLogMessage } from "@models/chat/chat-log.ts";
import type { HookVariant } from "@models/content/content-types.ts";
import type { GlobalSettings } from "@models/presets/creative-settings.ts";
import type { SaveState } from "@models/content/create-content-model.ts";
import type { ElementSourceMap, RenderOverrides } from "@models/presets/element-sources.ts";
import type { ConversationDecision } from "@maleo/shared";

/** The stored fields outside the editable scope. */
interface PresentationBundle {
	pacingDevices: PacingDevices;
	presentation: RenderPresentation;
}

interface EditorStateBundle {
	chatMessages: ChatLogMessage[];
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
	/** Make the storyboard durable now; resolves with the head version's id. */
	flushStoryboard: () => Promise<{ id: string }>;
	flushEditorState: (overrides?: Partial<EditorStateBundle>) => Promise<void>;
	retrySave: () => Promise<void>;
	retrying: boolean;
}

export function useContentPersistence(input: {
	/* Required, both of them. Only the editor page mounts this hook, and that
	 * page has an id from the route and a type from the loaded project, so
	 * mounting IS the condition. */
	projectId: string;
	type: ContentType | null;
	commandLog: CommandLog;
	presentation: PresentationBundle;
	editorState: EditorStateBundle;
	config: Config;
	setSaveState: Dispatch<SetStateAction<SaveState>>;
	setSaveError: Dispatch<SetStateAction<string | null>>;
}): ContentPersistence {
	const {
		projectId,
		type,
		commandLog,
		presentation: pres,
		editorState: es,
		config,
		setSaveState,
		setSaveError,
	} = input;
	const [retrying, setRetrying] = useState(false);
	// Set when a presentation field changed and has not been written yet.
	const presentationDirty = useRef(false);
	const pendingPresentation = useRef<Promise<unknown>>(Promise.resolve());
	const writePresentation = (): Promise<unknown> => {
		presentationDirty.current = false;
		const write = pendingPresentation.current
			.catch(() => {})
			.then(() =>
				savePresentation(projectId, {
					pacingDevices: pres.pacingDevices,
					presentation: pres.presentation,
				}),
			);
		pendingPresentation.current = write;
		return write;
	};
	useDebouncedSave(!!type, [pres.pacingDevices, pres.presentation, projectId, type], 1200, () => {
		setSaveState("saving");
		void writePresentation()
			.then(() => setSaveState("saved"))
			.catch((err) => {
				presentationDirty.current = true;
				setSaveState("failed");
				setSaveError(`Auto-save failed: ${errMsg(err)}`);
			});
	});
	// Marked before the debounce fires, so an immediate flush does not miss it.
	useDebouncedSave(!!type, [pres.pacingDevices, pres.presentation], 0, () => {
		presentationDirty.current = true;
	});

	const writeStoryboard = async (): Promise<{ id: string }> => {
		if (presentationDirty.current) await writePresentation();
		await pendingPresentation.current;
		await commandLog.flush();
		const head = await readCommandLog(projectId);
		if (!head.headStoryboardId) throw new Error("the project has no saved storyboard yet");
		return { id: head.headStoryboardId };
	};

	/* One writer for editor state, used by both the debounce and the immediate
	 * flush. `overrides` exists because a caller that just changed something and
	 * needs it durable NOW holds the new value, while `es` still holds the old one
	 * until React re-renders. */
	const writeEditorState = (overrides?: Partial<EditorStateBundle>): Promise<void> => {
		const next = { ...es, ...overrides };
		return saveEditorState(projectId, {
			chat: next.chatMessages,
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

	// Editor state saves on its own debounce, decoupled from
	// the versioned storyboard so it isn't duplicated per version or lost on a
	// partial storyboard write.
	useDebouncedSave(
		true,
		[
			es.chatMessages,
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
