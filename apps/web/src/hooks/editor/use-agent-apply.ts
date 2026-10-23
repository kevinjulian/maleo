import { applyCommand } from "@maleo/shared/editor";
import { withGeneratedNarrationCaptions } from "@maleo/shared";
/* Applying an agent run onto the editor.
 *
 * Two passes, and the difference between them matters: while the run streams,
 * only the scenes are patched, so the editor stays responsive and the user can
 * watch it fill in. On completion a full pass upserts the overlays, audio and
 * characters the agent produced. A job result stored before infographics were
 * removed may still carry `infographicOverlays`; the merge does not read it.
 *
 * Pure merges live in `apply-agent-job.ts`. Settled video output reads the live
 * document and commits one command; streaming scene updates retain their existing
 * setter path. Scene/slide/post refs keep multi-minute runs off stale closures.
 *
 * Split out of `create-content.tsx`.
 */
import { useRef } from "react";
import type { MutableRefObject, Dispatch, SetStateAction } from "react";
import {
	mergeAgentAudioOverlays,
	mergeAgentCharacters,
	mergeAgentScenes,
	mergeAgentTextOverlays,
	mergeAgentVideoOverlays,
} from "@models/agent/apply-agent-job.ts";
import { defaultCastId } from "@models/agent/agent-request.ts";
import {
	projectMaterialsSchema,
	agentSceneFromScene,
	clipId,
	fromTimelineDoc,
	rebuildDocWith,
	EMPTY_CHAT_PROJECT_INDEX,
	type EntityFingerprint,
	type ChatEntityRef,
	type StyleKnobs,
} from "@maleo/shared";
import { scopeFingerprints } from "@models/timeline/agent-result-scope.ts";
import {
	buildChatEnvelope,
	resolveCommandFocus,
	type BuildChatEnvelopeInput,
} from "@models/chat/build-chat-envelope.ts";
import {
	chipsForFocus,
	labelFor,
	EMPTY_COMMAND_SCOPE,
	type ChatCommandScope,
	type ComposerFocusPreview,
} from "@models/chat/chat-composer.ts";
import type { Selection } from "@models/timeline/selection-model.ts";
import type { ChatLogMessage } from "@models/chat/chat-log.ts";
import type { ConversationDecision, ChatCommandInputs } from "@maleo/shared";
import {
	type EditorCommand,
	type EditScope,
	commandClipIds,
	type AgentEditMarker,
} from "@maleo/shared/editor";
import { diffScopeToCommand } from "@maleo/shared/editor";
import { settleAgentCommands } from "@models/agent/apply-agent-commands.ts";
import type { AgentApply, AgentSettleOutcome } from "./use-content-agent.ts";
import type { AgentJobScene, AgentJobState } from "@models/agent/agent-wire.ts";
import type { ChatAgentContext, StartChatAgentInput } from "@api/chat.ts";
import type {
	Config,
	ContentType,
	RefImage,
	RefsState,
	Scene,
	CreativeDirection,
	ProjectMaterials,
} from "@maleo/shared";
import type { Post, Slide } from "@models/content/content-types.ts";
import type { EditorDoc } from "@stores/timeline-document-store.ts";
import type { GlobalSettings } from "@models/presets/creative-settings.ts";
import type { DocumentWriters } from "@stores/document-writers.ts";
import type { MediaAssetSeed } from "@models/timeline/media-admission.ts";
import type { MediaAsset } from "@models/timeline/editor-media.ts";

export interface AgentApplyInput {
	getMediaAssets: () => MediaAsset[];
	/** The loaded version's `agentEdit` marker: the run whose commands it already holds. */
	loadedAgentEdit?: () => AgentEditMarker | undefined;
	type: ContentType | null;
	config: Config;
	settings: GlobalSettings;
	pool: RefImage[];
	refs: RefsState;
	projectReferences: { entityIds: string[] };
	store: { getDoc: () => EditorDoc };
	slides: Slide[];
	posts: Post[];
	scenesRef: MutableRefObject<Scene[]>;
	slidesRef: MutableRefObject<Slide[]>;
	postsRef: MutableRefObject<Post[]>;
	styleRef: MutableRefObject<StyleKnobs | undefined>;
	setScenes: Dispatch<SetStateAction<Scene[]>>;
	setOverlays: DocumentWriters["setOverlays"];
	setVideoOverlays: DocumentWriters["setVideoOverlays"];
	setAudioOverlays: DocumentWriters["setAudioOverlays"];
	setPool: Dispatch<SetStateAction<RefImage[]>>;
	runCommand: (cmd: EditorCommand, before?: EditScope) => string | null;
	/** Admission for the media an agent job places. An agent acting on the
	 *  operator's behalf is a placement path like any other. */
	ensureMediaAsset: (seed: MediaAssetSeed) => string;
	agentBrief: () => string;
	effectiveDirection: () => CreativeDirection;
	projectMaterials: () => ProjectMaterials;
	contextFor: () => ChatAgentContext;
	/* Everything the envelope needs that this hook does not already hold.
	 *
	 * One accessor rather than five props: it is read once, at the moment a run
	 * starts, and passing the pieces separately would invite reading them at five
	 * slightly different times. */
	envelopeContext?: () => {
		projectId: string;
		selection: Selection | null;
		playheadSec: number | null;
		messages: ChatLogMessage[];
		decisions: ConversationDecision[];
	};
	assets?: () => Array<{ id: string; label?: string; kind?: string }>;
}

export interface AgentApplyBinding {
	apply: AgentApply;
	buildStart: (
		instruction: string,
		scope?: ChatCommandScope,
	) => Omit<StartChatAgentInput, "projectId" | "instruction" | "contentType">;
	/** What a command with this text and scope would be focused on right now —
	 *  the composer's chips, from the same resolver the envelope uses. */
	previewFocus: (instruction: string, scope: ChatCommandScope) => ComposerFocusPreview;
}

export function useAgentApply(input: AgentApplyInput): AgentApplyBinding {
	const {
		getMediaAssets,
		type,
		config,
		settings,
		pool,
		refs,
		projectReferences,
		store,
		scenesRef,
		slidesRef,
		postsRef,
		styleRef,
		setScenes,
		setPool,
		runCommand,
		ensureMediaAsset,
		agentBrief,
		effectiveDirection,
		projectMaterials,
		contextFor,
		envelopeContext,
		assets,
	} = input;
	// Apply a video job back into the editor: live scene patch while running, then
	// a full pass that upserts the agent's overlays/characters on completion.
	/* Apply an agent run onto the document. The merges are pure and live in
	 * `apply-agent-job.ts`; each runs inside a functional setter so a burst of
	 * streaming commits reads the live value rather than this render's closure.
	 * The seed replaces four `Date.now()` calls, so a re-applied job is stable. */
	const applyAgentScenes = (
		job: AgentJobState,
		opts: { running: boolean },
	): AgentSettleOutcome | void => {
		/* A run that only edited the timeline carries the commands it executed. They
		 * apply once, when it settles: previewing them would put the edit in the
		 * document before the commands arrive to make it. */
		if (job.commands?.length)
			return opts.running ? undefined : applyAgentCommands(job, job.commands);
		// A resumed run has no preview baseline; its snapshot predates local saves.
		if (opts.running && !previewRef.current) return;
		// A plan-only result has no document mutation to show or undo.
		if (
			!opts.running &&
			!job.scenes.length &&
			!job.textOverlays.length &&
			!job.videoOverlays.length &&
			!job.audioOverlays.length
		) {
			if (job.characters.length) setPool((prev) => mergeAgentCharacters(prev, job.characters));
			return { status: "applied", touched: [], undoable: false };
		}
		const idSeed = Date.now();
		const scope: EditScope = {
			mediaAssets: getMediaAssets(),
			doc: store.getDoc(),
			slides: slidesRef.current,
			posts: postsRef.current,
		};
		const views = fromTimelineDoc(scope.doc);
		const before = views.scenes;
		const merged = mergeAgentScenes(before, job.scenes, {
			idSeed,
			defaultCastId: defaultCastId(refs),
			style: styleRef.current,
			styleName: config.styleName,
			admit: ensureMediaAsset,
		});
		if (opts.running) {
			setScenes(merged);
			return;
		}
		// Keep the settled document in one history entry, including admitted assets.
		const result: EditScope = {
			...scope,
			doc: rebuildDocWith(scope.doc, {
				scenes: merged,
				textOverlays: job.textOverlays.length
					? mergeAgentTextOverlays(views.textOverlays, job.textOverlays, idSeed)
					: views.textOverlays,
				videoOverlays: job.videoOverlays.length
					? mergeAgentVideoOverlays(
							views.videoOverlays,
							job.videoOverlays,
							idSeed,
							ensureMediaAsset,
						)
					: views.videoOverlays,
				audioOverlays: job.audioOverlays.length
					? mergeAgentAudioOverlays(
							views.audioOverlays,
							job.audioOverlays,
							idSeed,
							ensureMediaAsset,
						)
					: views.audioOverlays,
			}),
			mediaAssets: getMediaAssets(),
		};
		result.doc = withGeneratedNarrationCaptions(
			applyCommand(scope, diffScopeToCommand(scope, result, "agent.sources")).doc,
			job.generatedCaptionSources,
			applyCommand,
		);
		const command = diffScopeToCommand(scope, result, "agent.video");
		const step = runCommand(command, scope);
		const previous = new Map(before.map((scene) => [scene.id, JSON.stringify(scene)]));
		const touched: ChatEntityRef[] = merged
			.filter((scene) => previous.get(scene.id) !== JSON.stringify(scene))
			.map((scene) => ({ kind: "clip", id: clipId("scene", scene.id) }));
		if (job.characters.length) setPool((prev) => mergeAgentCharacters(prev, job.characters));
		return {
			status: "applied",
			touched,
			undoable: command.type !== "noop",
			...(step ? { step } : {}),
		};
	};

	const applyAgentCommands = (
		job: AgentJobState,
		commands: EditorCommand[],
	): AgentSettleOutcome => {
		if (job.characters.length) setPool((prev) => mergeAgentCharacters(prev, job.characters));
		/* The version this editor loaded was saved by this run, with these commands in
		 * it (a reload while the run worked): applying them again would edit twice. */
		const loaded = input.loadedAgentEdit?.();
		if (job.commandRun && loaded?.runId === job.commandRun && loaded.applied >= commands.length) {
			return {
				status: "applied",
				touched: commandClipIds(commands, store.getDoc().clips).map((id) => ({ kind: "clip", id })),
				undoable: false,
			};
		}
		const current: EditScope = {
			mediaAssets: getMediaAssets(),
			doc: store.getDoc(),
			slides: slidesRef.current,
			posts: postsRef.current,
		};
		/* This editor's capture when it started the run; otherwise the document the run
		 * itself started from (an MCP edit, another tab), so neither goes unfenced. */
		const captured = capturedRef.current.length ? capturedRef.current : (job.commandBase ?? []);
		const settled = settleAgentCommands({
			commands,
			captured,
			current,
			admit: ensureMediaAsset,
			mediaAssets: getMediaAssets,
			label: "agent.video",
		});
		if (settled.status === "hold")
			return {
				status: "held",
				touched: settled.touched,
				reason: settled.reason,
				conflicts: settled.conflicts,
			};
		const step = runCommand(settled.command, current);
		// The executor refused (a target the user removed, a locked track): nothing was written.
		if (!step)
			return { status: "held", touched: settled.touched, reason: "refused", conflicts: [] };
		return { status: "applied", touched: settled.touched, undoable: true, step };
	};

	/* What the run read, captured when it started.
	 *
	 * Empty until a run is started through `buildStart`, which is the capture
	 * moment. A settled result with nothing captured falls back to writing
	 * wholesale — the behaviour before fencing existed — because without a
	 * baseline there is no way to tell what the run changed from what the user
	 * did, and inventing an answer is worse than the old behaviour. */
	const capturedRef = useRef<EntityFingerprint[]>([]);
	/* Expected editor state after this run's latest live preview. Kept separate
	 * from current editor state so the settled fence can distinguish agent-owned
	 * preview writes from user edits made between patches. */
	const previewRef = useRef<EditScope | null>(null);

	const apply: AgentApply = {
		onContext: (context) => {
			if (!capturedRef.current.length && context?.fingerprints.length) {
				capturedRef.current = context.fingerprints;
				/* No local preview baseline survived reload. Skip further live previews;
				 * the settled result will fence against captured fingerprints. */
				previewRef.current = null;
			}
		},
		onScenes: applyAgentScenes,
	};
	/* Everything focus resolution reads, sampled now. Shared by the chip preview
	 * and the envelope so the two can never disagree about scope. */
	const focusInput = (
		instruction: string,
		scope: ChatCommandScope,
		liveScope: EditScope,
	): BuildChatEnvelopeInput | null => {
		const focus = envelopeContext?.();
		if (!focus) return null;
		return {
			projectId: focus.projectId,
			scope: liveScope,
			materials: projectMaterials(),
			referenceIds: projectReferences.entityIds,
			references: pool
				.filter((reference) => projectReferences.entityIds.includes(reference.id))
				.map((reference) => ({
					id: reference.id,
					label: reference.label,
					role: reference.role,
					description: reference.description,
				})),
			assets: assets?.(),
			instruction,
			mentions: scope.mentions,
			excludedSources: scope.excludedSources,
			selection: focus.selection,
			playheadSec: focus.playheadSec,
			messages: focus.messages,
			decisions: focus.decisions,
		};
	};
	const previewFocus = (instruction: string, scope: ChatCommandScope): ComposerFocusPreview => {
		const input = focusInput(instruction, scope, {
			mediaAssets: getMediaAssets(),
			doc: store.getDoc(),
			slides: slidesRef.current,
			posts: postsRef.current,
		});
		if (!input) return { chips: [], index: EMPTY_CHAT_PROJECT_INDEX };
		const { index, resolution } = resolveCommandFocus(input);
		if (resolution.status === "ambiguous") {
			return {
				chips: [],
				index,
				ambiguous: {
					phrase: resolution.phrase,
					labels: resolution.candidates.map((ref) => labelFor(ref, index)),
				},
			};
		}
		return { chips: chipsForFocus(resolution.focus, index), index };
	};
	const buildStart = (
		instruction: string,
		scope: ChatCommandScope = EMPTY_COMMAND_SCOPE,
	): Omit<StartChatAgentInput, "projectId" | "instruction" | "contentType"> => {
		const ctx = contextFor();
		/* Capture here: this is called once, as the run starts, so it records the
		 * project exactly as the run is about to read it. */
		const liveScope: EditScope = {
			mediaAssets: getMediaAssets(),
			doc: store.getDoc(),
			slides: slidesRef.current,
			posts: postsRef.current,
		};
		capturedRef.current = scopeFingerprints(liveScope);
		previewRef.current = liveScope;
		/* Built from the live scope for the same reason it is captured from it: the
		 * user usually edits and then asks about what they just edited, and both the
		 * storyboard and editor state autosave on a debounce. */
		/* One assembly of the prompt inputs, shared by all three content types.
		 * They used to be spelled out per branch, which is how two branches drifted
		 * into sending different things. */
		const inputs: ChatCommandInputs = {
			brief: agentBrief(),
			aspect: type === "video" ? settings.aspectRatio || config.format : config.format,
			referenceIds: projectReferences.entityIds,
			direction: effectiveDirection(),
			/* Normalised through the schema rather than cast: the domain type leaves
			 * several fields optional that the wire shape fills in, and a cast would
			 * ship whichever the caller happened to hold. Invalid materials become
			 * absent rather than failing the command — the run then reads the
			 * project's own materials server-side. */
			materials: projectMaterialsSchema.safeParse(projectMaterials()).data,
			audience: ctx.audience,
			targetDurationSec: ctx.targetDurationSec,
			slideCount: ctx.slideCount,
			platform: ctx.platform,
			thread: ctx.thread,
			voiceProvider: ctx.voiceProvider,
			voice: ctx.voice,
			language: ctx.language,
			style: ctx.style,
			styleKnobs: ctx.styleKnobs,
			styleName: ctx.styleName,
			timelineTemplateId: ctx.timelineTemplateId,
		};
		const input = focusInput(instruction, scope, liveScope);
		const envelope = input ? buildChatEnvelope({ ...input, inputs }).envelope : undefined;
		if (type === "video") {
			// Each scene's effective ids, by the one rule (`agentSceneFromScene`).
			const agentScenes: AgentJobScene[] = scenesRef.current.map(agentSceneFromScene);
			// The store is the live source of truth (stable ref), so its document is
			// current even across the multi-minute agent loop — no stale-closure risk.
			const liveClips = store.getDoc().clips;
			const styleRef = settings.globalStyleRefId
				? pool.find((r) => r.id === settings.globalStyleRefId)
				: undefined;
			return {
				scenes: agentScenes,
				clips: liveClips,
				captionSet: liveScope.doc.captionSet,
				styleImageUrl: styleRef?.imageUrl,
				envelope,
			};
		}
		// Image and text projects are retired and never start a run.
		return { envelope };
	};
	return { apply, buildStart, previewFocus };
}
