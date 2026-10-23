/* The content project itself: create, storyboard versions, editor state, metadata
 * and submit.
 *
 * The UI stays the source of truth while editing; these persist at the meaningful
 * transitions, and callers treat failure as non-fatal so the immersive flow never
 * breaks on a transient backend error. */
import { post, put } from "./client.ts";
import type {
	ConversationDecision,
	Config,
	ContentType,
	InfographicStyle,
	PacingDevices,
	ProjectSelection,
	RefImage,
	RefsState,
	TrackFlags,
	ContentProjectBrief,
	ProjectMaterials,
} from "@maleo/shared";
import type { ChatLogMessage } from "@models/chat/chat-log.ts";
import { BASE } from "./base.ts";
import {
	briefFromConfig,
	speakersFromState,
	storyboardJson,
} from "@models/storyboard/document-wire.ts";
import { withReadyPending } from "@models/core/pending-media-sources.ts";

interface ProjectEnvelope {
	project: { project: { id: string } };
}

export interface SavedStoryboard {
	storyboard_json?: Record<string, unknown>;
	id: string;
	version: number;
}

/** Create the project with its first storyboard version and reference library.
 *  `storyboard` is optional: the unified create flow creates the project FIRST
 *  (empty storyboard) and lets the chat agent write the first real version, so
 *  the UI never enters the editable workspace before the project exists. */
export async function createProject(input: {
	type: ContentType;
	config: Config;
	refs: RefsState;
	/** The reference pool at creation time; its entity ids become the project roster. */
	pool?: RefImage[];
	title: string;
	storyboard?: Record<string, unknown>;
	status?: string;
	/** Widened to what the editor-state route already stores: `direction` had a
	 *  slot on the way out and nowhere to go on the way in, so a preset's creative
	 *  direction was dropped at create and only reappeared once the debounced
	 *  autosave ran. */
	editorState?: {
		chat?: ChatLogMessage[];
		settings?: unknown;
		direction?: unknown;
		elementSources?: unknown;
		activePresetId?: unknown;
	};
	/** The preset-applied axes the seed storyboard carries. Written with the row so
	 *  they survive a reload that races the first editor-state autosave — the same
	 *  reason the first chat message is persisted here rather than saved later. */
	projectReferences?: ProjectSelection;
	/** The project's generation context, resolved from the selected preset and any
	 *  operator override. Written with the row for the same reason as the axes above. */
	materials?: ProjectMaterials;
	pacingDevices?: PacingDevices;
	infographicStyle?: InfographicStyle;
	trackFlags?: TrackFlags;
}): Promise<string | null> {
	const { type, config, refs, title } = input;
	const target_duration_sec = null;
	const description = config.description?.trim() || null;
	// A storyboard appropriate to the type keeps the version chain valid (loaders
	// read storyboards[0]) until the agent persists real content — and carries the
	// preset's axes, which `storyboardJson` already has slots for, so creating with
	// a preset writes them rather than leaving them to the debounced autosave.
	const storyboard =
		input.storyboard ??
		storyboardJson(
			type,
			{},
			{
				projectReferences: input.projectReferences,
				materials: input.materials,
				pacingDevices: input.pacingDevices,
				infographicStyle: input.infographicStyle,
				trackFlags: input.trackFlags,
			},
		);
	const body = {
		title,
		type,
		status: input.status ?? "storyboard",
		target_platform: type === "text" ? (config.platform ?? null) : null,
		target_audience: config.audience?.trim() || null,
		target_duration_sec,
		target_format: config.format ?? null,
		brief_json: briefFromConfig(config),
		reference_notes: description,
		// The roster, as entity ids. This used to send `references:` in the shape of
		// the retired `content_references` table, which the route never declared and
		// therefore discarded — so a project created with references selected loaded
		// back with an empty roster.
		reference_entity_ids: (input.pool ?? []).map((r) => r.id),
		lead_entity_id: (input.pool ?? []).find((r) => r.primary)?.id ?? null,
		speakers: speakersFromState(type, refs),
		seed_storyboard: {
			source_prompt: config.brief?.trim() || null,
			reference_notes: description,
			storyboard_json: storyboard,
			status: "draft",
		},
		// Persisted atomically with the row so the first chat message survives a
		// reload that races the debounced editor-state autosave.
		...(input.editorState
			? {
					editor_state: {
						chat: input.editorState.chat ?? [],
						settings: input.editorState.settings ?? null,
						direction: input.editorState.direction ?? null,
						element_sources: input.editorState.elementSources ?? null,
						active_preset_id: input.editorState.activePresetId ?? null,
					},
				}
			: {}),
	};
	const res = await post<ProjectEnvelope>(`${BASE}/projects`, body);
	return res.project?.project?.id ?? null;
}

/** What the save did with the document's reference lock: which selected ids are
 *  now attached to the roster, and which could not be. An unresolved id renders
 *  nothing and blocks generation, so the surface marks it rather than leaving the
 *  selection looking applied. */
export interface SavedStoryboardReferences {
	attached: string[];
	unresolved: string[];
}

/** Persist the latest edits as a new storyboard version.
 *
 *  The save is also where the document's reference lock reaches the project
 *  roster — the two used to drift, which is how a preset could select a
 *  reference the project never attached. */
export async function saveStoryboard(
	projectId: string,
	storyboard: Record<string, unknown>,
	expectedCaptionState?: string,
): Promise<SavedStoryboard & { references?: SavedStoryboardReferences }> {
	const res = await post<{ storyboard: SavedStoryboard; references?: SavedStoryboardReferences }>(
		`${BASE}/projects/${projectId}/storyboards`,
		// Ready imports take their server metadata; unfinished ones keep their minted URL.
		{ storyboard_json: withReadyPending(storyboard), expectedCaptionState },
	);
	return { ...res.storyboard, references: res.references };
}

/** Mutable editor state (chat log + media library), persisted separately from the
 *  versioned storyboard so it isn't duplicated per version or lost on partial saves. */
export async function saveEditorState(
	projectId: string,
	state: {
		chat?: ChatLogMessage[];
		settings?: unknown;
		trackFlags?: unknown;
		hookVariants?: unknown;
		direction?: unknown;
		elementSources?: unknown;
		renderOverrides?: unknown;
		activePresetId?: unknown;
		decisions?: ConversationDecision[];
	},
): Promise<void> {
	await put(`${BASE}/projects/${projectId}/editor-state`, {
		// An empty map and an absent one mean the same thing on read: no element has a
		// recorded source, so every element resolves to operator-owned. That equivalence
		// is what makes a project predating provenance safe, and it is why the `?? null`
		// here is only a shape guard rather than a meaningful distinction — the editor
		// state holds `{}` from load, so `{}` is what normally persists.
		editor_state: {
			chat: state.chat ?? [],
			settings: state.settings ?? null,
			track_flags: state.trackFlags ?? null,
			hook_variants: state.hookVariants ?? null,
			direction: state.direction ?? null,
			element_sources: state.elementSources ?? null,
			render_overrides: state.renderOverrides ?? null,
			active_preset_id: state.activePresetId ?? null,
			decisions: state.decisions ?? [],
		},
	});
}

/** Update editable project metadata (title, brief, …). Best-effort; non-fatal. */
export async function updateProjectMeta(
	projectId: string,
	patch: {
		title?: string;
		brief_json?: ContentProjectBrief;
		target_audience?: string | null;
		target_platform?: string | null;
		reference_notes?: string | null;
	},
): Promise<void> {
	await put(`${BASE}/projects/${projectId}`, patch);
}

/** Submit for review: video kicks off a render, image/text flip to ready. */
export async function submitProject(input: {
	projectId: string;
	type: ContentType;
	title: string;
	platform?: string | null;
	content?: Record<string, unknown> | null;
}): Promise<void> {
	const { projectId, type, title, platform, content } = input;
	if (type === "video") {
		await post(`${BASE}/projects/${projectId}/renders`, { status: "queued" });
		return;
	}
	await put(`${BASE}/projects/${projectId}`, { status: "ready" });
	await post(`${BASE}/projects/${projectId}/outputs`, {
		channel: "social",
		platform: platform ?? null,
		kind: type === "image" ? "image_set" : "text_post",
		title,
		status: "ready",
		content_json: content ?? null,
	});
}
