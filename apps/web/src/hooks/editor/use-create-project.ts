/* Creating the project the form collected.
 *
 * A page composes and does not fetch, so the create form renders and this holds
 * the one request it makes. It also owns the two pieces of state that belong to
 * the request rather than to the form: whether a create is in flight (which
 * guards a double submit) and what failed.
 *
 * Everything the preset applied goes with the row rather than to a later
 * autosave — see `create-project-seed.test.ts`, which round-trips this body
 * through the loader. The editor reads it back from the project; nothing
 * survives this page in memory.
 */
import { useState } from "react";
import { createProject } from "@api/projects.ts";
import { errMsg } from "@models/core/cc-helpers.ts";
import type { ChatLogMessage } from "@models/chat/chat-log.ts";
import type {
	Config,
	ContentType,
	InfographicStyle,
	PacingDevices,
	ProjectSelection,
	RefImage,
	RefsState,
	CreativeDirection,
	ProjectMaterials,
} from "@maleo/shared";
import type { GlobalSettings } from "@models/presets/creative-settings.ts";
import type { ElementSourceMap } from "@models/presets/element-sources.ts";

export interface CreateProjectRequest {
	type: ContentType;
	config: Config;
	title: string;
	refs: RefsState;
	/** The reference pool at creation time; its entity ids become the roster. */
	pool: RefImage[];
	settings: GlobalSettings;
	direction: CreativeDirection;
	projectReferences: ProjectSelection;
	/** The generation context the project starts with: the selected preset's
	 *  materials, or the operator's override of them. */
	materials: ProjectMaterials;
	/** The Video Template the project is built to, or "" for none. */
	videoTemplateId: string;
	pacingDevices: PacingDevices;
	infographicStyle: InfographicStyle;
	/** Which layer supplied each element at creation. Written WITH the row: the
	 *  editor-state autosave is debounced, so a reload that races it would otherwise
	 *  open a project whose values came from a preset with nothing recording that. */
	elementSources: ElementSourceMap;
	/** The preset the project started from, or "" for none. */
	activePresetId: string;
}

export interface CreateProjectFlow {
	/** A create is in flight. The form disables its submit on this. */
	creating: boolean;
	error: string | null;
	clearError: () => void;
	/** Creates the project and calls back with its id. No-op while in flight. */
	create: (request: CreateProjectRequest, onCreated: (projectId: string) => void) => void;
}

export function useCreateProject(): CreateProjectFlow {
	const [creating, setCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const create = (request: CreateProjectRequest, onCreated: (projectId: string) => void): void => {
		if (creating) return;
		setError(null);
		setCreating(true);
		// Setup creates project metadata only; generation starts later from chat.
		const initialChat: ChatLogMessage[] = [];
		void createProject({
			type: request.type,
			config: request.config,
			refs: request.refs,
			pool: request.pool,
			title: request.title,
			status: "brief",
			/* The Video Template selection lands on `settings.timelineTemplateId`, which is
			 * where the editor already reads it from. The create form is the sole writer of
			 * it at this point, so it is set explicitly rather than merged: leaving a stale
			 * id from the settings snapshot would silently outrank the operator's override. */
			editorState: {
				chat: initialChat,
				settings: { ...request.settings, timelineTemplateId: request.videoTemplateId },
				direction: request.direction,
				elementSources: request.elementSources,
				activePresetId: request.activePresetId,
			},
			projectReferences: request.projectReferences,
			materials: request.materials,
			pacingDevices: request.pacingDevices,
			infographicStyle: request.infographicStyle,
		})
			.then((id) => {
				if (!id) throw new Error("project was not created");
				onCreated(id);
			})
			.catch((err) => {
				setError(`Could not create project: ${errMsg(err)}`);
			})
			.finally(() => {
				setCreating(false);
			});
	};

	return { creating, error, clearError: () => setError(null), create };
}
