/* Maleo — the content editor, on a project that exists. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import "./create-content.css";
import {
	agentContext,
	agentBrief as briefForAgent,
	effectiveDirection as directionForAgent,
} from "@models/agent/agent-request.ts";
import { useTimelineTemplates } from "@hooks/editor/use-timeline-templates.ts";
import type { Config, ContentType, ConversationDecision } from "@maleo/shared";
import {
	EMPTY_PROJECT_MATERIALS,
	type TimelineTemplate,
	type CreativeDirection,
} from "@maleo/shared";
import { withReadyPending } from "@models/core/pending-media-sources.ts";
import { createSelectionStore } from "@stores/selection-store.ts";
import {
	createShellChromeStore,
	useShellChromeField,
	type EditorMode,
	type ShellChromeStore,
} from "@stores/shell-chrome-store.ts";
import type { ScriptDensity } from "@models/script/script-rows.ts";
import { renderPresentation } from "./editor-settings.tsx";
import { useAgentApply } from "@hooks/editor/use-agent-apply.ts";
import { useRenderFlow } from "@hooks/editor/use-render-flow.ts";
import { isPhoneViewport } from "@hooks/editor/use-phone-layout.ts";
import { useLiveMirrors } from "@hooks/editor/use-live-mirrors.ts";
import { useInitialRun } from "@hooks/editor/use-initial-run.ts";
import { useChatSession, type ContentChat } from "@hooks/editor/use-chat-session.ts";
import type { PlayheadHandle } from "@models/timeline/playhead-handle.ts";
import { useCreativeSettings } from "@hooks/editor/use-creative-settings.ts";
import { useReferenceLibrary } from "@hooks/editor/use-reference-library.ts";
import type { StoredLayout } from "@models/editor/sync-bridge.ts";
import { useMediaReconcile } from "@hooks/editor/use-media-reconcile.ts";
import { type ChatAgentContext } from "@api/chat.ts";
import { saveStoryboard } from "@api/projects.ts";
import { storyboardJson } from "@models/storyboard/document-wire.ts";
import { agentRunSucceeded, buildRenderPreflight, errMsg } from "@models/core/cc-helpers.ts";
import type { AgentEditMarker, CommandExecutor } from "@maleo/shared/editor";
import { useContentPersistence } from "@hooks/editor/use-content-persistence.ts";
import { useProjectLoad } from "@hooks/editor/use-project-load.ts";
import { useCommandLog } from "@hooks/editor/use-command-log.ts";
// Re-export pure helpers so existing import sites (and tests) keep their paths.
export {
	logicalRefId,
	renderButtonIntent,
	agentRunSucceeded,
	renderButtonLabel,
	type RenderButtonIntent,
} from "@models/core/cc-helpers.ts";

import { type PendingInitialRun } from "@models/content/create-content-model.ts";
import {
	titleForCrumb,
	titleForOutput,
	titleFromContent,
	titleSlug,
} from "@models/content/project-title.ts";
import { hasRenderableVisual } from "@models/render/draft-request.ts";
import { revealEntities } from "./reveal-entities.ts";
import { EditorTopbar } from "./editor-topbar.tsx";
import type { LibraryType } from "@models/core/routing.ts";
import { EditorNotices } from "./editor-notices.tsx";
import { useEditorDocument } from "./use-editor-document.ts";
import { EditorViews } from "./editor-views.tsx";
import { exportFastDraft, persistSubmission } from "./editor-export.ts";

interface CreateContentProps {
	/* Required. It used to be optional because this component was also the create
	 * form, where no project exists yet — so every consumer had to distinguish
	 * "no project yet" from "not in the editor", and `screen` existed to answer
	 * the second half. The route carries an id or this component does not render. */
	projectId: string;
	/** The Rust engine's executor: the only thing that runs an edit (task 4.5). */
	executor: CommandExecutor;
	onExit?: () => void;
	// Opens the shared nav drawer (hamburger). The create flow is fullscreen, so
	// navigation is reachable on demand instead of via a persistent rail.
	onOpenNav?: () => void;
	onOpenLibrary?: (type: LibraryType, editId?: string) => void;
	initialEditorMode?: EditorMode;
	initialScriptDensity?: ScriptDensity;
	/** Back to the create form, after an image/text project is submitted. */
	onCreateAnother?: () => void;
	// Breadcrumb prefix rendered before the editor's own segments. e.g.
	// [{ label: "Work" }, { label: "Content", onClick: goContentList }]. The flow
	// appends "Create > <Type>" (new) or the content name (editing).
	crumbs?: CrumbSeg[];
}

export interface CrumbSeg {
	label: string;
	onClick?: () => void;
}

// Doc-level caption config lives on the EditorDoc (folded into the document per D7),
// not in the derived per-type arrays. Module-scoped so the selector identity is

export function CreateContent({
	projectId: initialProjectId,
	executor,
	onOpenNav,
	onOpenLibrary,
	initialEditorMode,
	initialScriptDensity,
	onCreateAnother,
	crumbs,
}: CreateContentProps): JSX.Element {
	/* Two screens remain, not four: the editor, and the completion card an
	 * image or text project shows after submit. `screenFor()` and its four-way
	 * vocabulary went with the create form — the route is the screen now, and
	 * this page only renders when the route carries a project id. */
	const [submitted, setSubmitted] = useState(false);
	const [type, setType] = useState<ContentType | null>(null);
	const [config, setConfig] = useState<Config>({});
	/* The workspace's reference material: the pool (library + this project's
	 * roster, `inRoster` marking the attachment), the rest of `refs` (notes,
	 * speakers, style), the product catalogue, and the media library. Owned by
	 * `use-reference-library.ts`, which also runs the catalogue fetch that seeds
	 * three of them; destructured here so the container's call sites are unchanged. */
	const library = useReferenceLibrary();
	const { refs, pool, setPool, mediaAssets, ensureMediaAsset } = library;
	/* The document, the image and text arrays beside it, and the command stack
	 * every edit runs through (see use-editor-document.ts). */
	const doc = useEditorDocument({
		executor,
		library,
		liveLists: () => ({ slides: slidesRef.current, posts: postsRef.current }),
	});
	const { store, slides, setSlides, posts, setPosts, scenes } = doc;
	const { overlays, audioOverlays, videoOverlays } = doc;
	const { effects, projectReferences, trackFlags, writers } = doc;
	const { runCommand, isLatest, doUndo } = doc;
	const { setScenes, setOverlays, setAudioOverlays, setVideoOverlays } = writers;

	/* The net under the writers: any clip holding a media URL with no asset
	 * identity is admitted and the identity written back. Expected to find
	 * nothing — it fires on load so a project saved before the writers recorded
	 * identities repairs itself without a migration, and it catches a writer
	 * added later that forgets. Bookkeeping, so it bypasses the undo ledger. */
	useMediaReconcile({
		scenes,
		videoOverlays,
		audioOverlays,
		mediaAssets,
		ensureMediaAsset,
		reviseArrays: writers.reviseArrays,
	});

	/* The project's creative choices — global settings, direction, A/B hook takes,
	 * retention devices. One value because they are always read
	 * and written together (preset, template, load, save); destructured here so the
	 * container's own call sites stay unchanged. */
	const creative = useCreativeSettings();
	const {
		settings,
		setSettings,
		direction,
		hookVariants,
		pacingDevices,
		elementSources,
		renderOverrides,
		activePresetId,
	} = creative;
	// Memoized because it is an autosave dependency. `renderPresentation` builds a
	// fresh object every call, so computing it inline in the storyboard bundle gave
	// the save effect a new identity on EVERY render: the save set `saveState`, that
	// re-rendered, that re-allocated this, that re-armed the debounce — a permanent
	// ~1.2s loop writing a new storyboard VERSION each pass, with no edit behind it.
	const presentation = useMemo(() => renderPresentation(settings), [settings]);

	// The shell's chrome, in a store rather than thirteen `useState` calls, so a
	// region can be extracted at a few props (see shell-chrome-store.ts).
	const chromeRef = useRef<ShellChromeStore | null>(null);
	if (!chromeRef.current)
		chromeRef.current = createShellChromeStore(isPhoneViewport() ? { chatOpen: false } : undefined);
	const chrome = chromeRef.current;
	const [, setRailOpen] = useShellChromeField(chrome, "railOpen");
	const [editorMode, setEditorMode] = useShellChromeField(chrome, "editorMode");
	/* A route can land on one of the views. Applied once, on mount: after that the
	 * view is the operator's tab choice and the address stops speaking for it. */
	useEffect(() => {
		if (initialEditorMode) chrome.patch("editorMode", initialEditorMode);
	}, [initialEditorMode, chrome]);

	/* Selection is OWNED here and read in the timeline. The shell holds it so the
	 * script view can hand over the scene the operator was writing when they
	 * switch; it does not subscribe, because reading it here would re-render the
	 * whole editor on every selection change. */
	const [selectionStore] = useState(() => createSelectionStore());
	/* The project this page is open on. Seeded from the route, so it is a string
	 * from the first render rather than a null that becomes one — the ambiguity
	 * that made every consumer ask "is there a project yet, or am I not in the
	 * editor at all?" and answer it with a `screen` string. */
	const projectId = initialProjectId;

	const [, setSubmitting] = useShellChromeField(chrome, "submitting");
	const [saveError, setSaveError] = useShellChromeField(chrome, "saveError");
	const [, setSaveState] = useShellChromeField(chrome, "saveState");
	const [pendingInitial, setPendingInitial] = useState<PendingInitialRun | null>(null);
	/** Set once the persisted project — chat log included — has been applied. */
	const [projectLoaded, setProjectLoaded] = useState(false);
	// The command log sequence of the loaded version; null until a project loads.
	const [loadedSeq, setLoadedSeq] = useState<number | null>(null);
	const storedLayoutRef = useRef<StoredLayout | undefined>(undefined);
	const [agentFailed, setAgentFailed] = useShellChromeField(chrome, "agentFailed");

	/* Live mirrors for the agent loop: a multi-minute run's closure would
	 * otherwise name-match against the lists as they were when it started (see
	 * use-live-mirrors.ts). */
	const { scenesRef, slidesRef, postsRef, styleRef } = useLiveMirrors(
		scenes,
		slides,
		posts,
		config.style ?? undefined,
	);

	const loadedAgentEditRef = useRef<AgentEditMarker | undefined>(undefined);
	useProjectLoad({
		initialProjectId,
		onStart: () => {
			setSaveError(null);
			setLoadedSeq(null);
		},
		onError: (message) => setSaveError(message),
		persistIdentityRepair: async (p) => {
			await saveStoryboard(
				p.projectId,
				storyboardJson(
					p.type,
					{ slides: p.slides, posts: p.posts },
					{
						projectReferences: p.projectReferences,
						materials: p.materials,
					},
				),
			);
		},
		apply: (p) => {
			setType(p.type);
			loadedAgentEditRef.current = p.agentEdit;
			setConfig(p.config);
			// Seed the canonical document in ONE write from the clip-native load target:
			// `parseLoadedProject` already projected the loaded arrays into `clips[]` and
			// merged persisted marker metadata (D3), so the store seeds directly — arrays
			// are NOT re-projected at load (the load-time array boundary lives once, in parse).
			// `trackFlags` seeds here rather than through its writer: the writer commits
			// to the undo ledger, and loading a project is not an undoable edit.
			store.setDoc({
				schemaVersion: 2,
				clips: p.clips,
				markers: p.markers,
				chapters: p.chapters,
				bookmarks: p.bookmarks,
				projectReferences: p.projectReferences,
				materials: p.materials,
				captions: p.captions,
				captionSet: p.captionSet,
				trackFlags: p.trackFlags,
			});
			setSlides(p.slides);
			setPosts(p.posts);
			chat.setMessages(p.chatMessages);
			chat.setDecisions(p.decisions);
			creative.hydrate(p);
			/* Re-attaching to a live job may only start once this has run. The load
			 * replaces the whole chat log, so a replay that began earlier has its cards
			 * wiped and then re-appended — the log grew by a full replay on every
			 * reload, which is how one project reached 262 messages for a run that
			 * emitted 32 events. */
			setProjectLoaded(true);
			storedLayoutRef.current = p.storedLayout;
			setLoadedSeq(p.commandSeq);
			// The media library, plus the project's own entities (generated images,
			// notes, voices) merged back in so they survive reloads.
			library.hydrate(p);
		},
	});

	// ── Unified agent: brief + every chat command run through one server agent. ──
	// What the agent is told is derived in domain/agent-request.ts; these bind it
	// to the current editor state.
	const agentBrief = (): string => briefForAgent(config, settings, pool);
	// Materials are what the operator now edits, so they decide what the agent is
	// told; direction and the legacy ref prompt remain the fallbacks for projects
	// that predate them.
	const effectiveDirection = (): CreativeDirection =>
		directionForAgent(direction, projectReferences, store.getDoc().materials);
	const contextFor = (): ChatAgentContext => agentContext(type, config, settings);
	/* Selecting a template records WHICH template, and nothing else.
	 *
	 * It used to also write two project-scope values behind the operator's back: the
	 * template's background into `settings.backgroundFill`, and the template's
	 * reference ids into the project's generation lock. Both are project-scope
	 * elements a render-scope defaulter has no business setting, and because the
	 * write left no trace, nothing downstream could say the background came from a
	 * template rather than from the operator — which is the exact class of invisible
	 * cross-scope write that `defaulter-element-provenance` exists to make legible.
	 *
	 * Removing it is a behaviour loss, deliberately taken: picking a template no
	 * longer sets the project's background or pre-selects its references. */
	const selectTimelineTemplate = (template: TimelineTemplate): void => {
		setSettings((prev) => ({ ...prev, timelineTemplateId: template.id }));
	};
	const timelineTemplates = useTimelineTemplates({
		onApply: selectTimelineTemplate,
		selectedId: () => settings.timelineTemplateId,
		enabled: type === "video" && !submitted,
	});
	/* The agent's writes back into the editor: scenes patched live while the run
	 * streams, everything else upserted on completion (see use-agent-apply.ts). */
	const {
		apply: applyLocally,
		buildStart,
		previewFocus,
	} = useAgentApply({
		type,
		config,
		settings,
		pool,
		refs,
		projectReferences,
		store,
		slides,
		posts,
		scenesRef,
		slidesRef,
		postsRef,
		styleRef,
		setScenes,
		setOverlays,
		setVideoOverlays,
		setAudioOverlays,
		setPool,
		runCommand,
		ensureMediaAsset,
		getMediaAssets: library.getMediaAssets,
		agentBrief,
		effectiveDirection,
		loadedAgentEdit: () => loadedAgentEditRef.current,
		projectMaterials: () => store.getDoc().materials ?? EMPTY_PROJECT_MATERIALS,
		assets: () =>
			mediaAssets.map((asset) => ({ id: asset.id, label: asset.label, kind: asset.kind })),
		contextFor,
		// Refs make capture read send-time state despite hook declaration order.
		envelopeContext: () => ({
			projectId: projectId ?? "",
			selection: selectionStore.get(),
			playheadSec: playheadRef.current?.get() ?? null,
			messages: chatRef.current?.messages ?? [],
			decisions: chatRef.current?.decisions ?? [],
		}),
	});

	/* Edits reach the server through the project command log (use-command-log.ts). */
	const commandLog = useCommandLog({
		projectId: projectId ?? "",
		loadedSeq: projectId ? loadedSeq : null,
		storedLayout: () => storedLayoutRef.current,
		executor,
		log: doc.log,
		scope: () => ({
			doc: store.getDoc(),
			slides: slidesRef.current,
			posts: postsRef.current,
			mediaAssets: library.getMediaAssets(),
		}),
		onSaving: () => setSaveState("saving"),
		onSaved: () => setSaveState("saved"),
		onFailed: (message) => {
			setSaveState("failed");
			setSaveError(message);
		},
		onProblems: (message) => setSaveError(message),
		// ponytail: a divergence reloads the saved project and loses unsent edits; re-applying them onto a snapshot is the upgrade.
		onDiverged: () => {
			setSaveError("The editor disagreed with the saved project; reloading the saved version.");
			window.location.reload();
		},
	});
	/* An agent run's preview and settled merge stay local: the run's own version
	 * arrives from the log when it settles and replaces them (design D4). */
	const apply: typeof applyLocally = {
		...applyLocally,
		onScenes: (job, opts) => {
			const outcome = doc.log.bridge.localOnly(() => applyLocally.onScenes?.(job, opts));
			if (!opts.running) void commandLog.pull().catch(() => {});
			return outcome;
		},
	};

	// The chat log and the run that writes to it, as one value — every workspace's
	// ChatPanel and the timeline editor take exactly this.
	// Refs break chat/persistence declaration cycle without stale closures.
	const flushEditorStateRef = useRef<
		((overrides?: { decisions?: ConversationDecision[] }) => Promise<void>) | null
	>(null);
	const chatRef = useRef<ContentChat | null>(null);
	// Playhead moves need no shell render; commands sample it at capture time.
	const playheadRef = useRef<PlayheadHandle | null>(null);
	const registerPlayhead = useCallback((playhead: PlayheadHandle) => {
		playheadRef.current = playhead;
	}, []);
	const chat = useChatSession({
		projectId,
		contentType: type ?? "video",
		apply,
		buildStart,
		editor: {
			composer: { preview: previewFocus, subscribe: selectionStore.subscribe },
			reveal: revealEntities,
			isLatest,
			undo: doUndo,
			openStoryboard:
				type === "video" && editorMode !== "storyboard"
					? () => setEditorMode("storyboard")
					: undefined,
		},
		onRunStart: () => setAgentFailed(false),
		// A settled decision is written through immediately; see the note on the option.
		onDecisionRecorded: async (decisions) => {
			const flush = flushEditorStateRef.current;
			if (!flush) throw new Error("editor persistence is not ready");
			await flush({ decisions });
		},
	});

	// Debounced persistence: versioned storyboard, decoupled editor state, project meta.
	const { flushStoryboard, flushEditorState, retrySave, retrying } = useContentPersistence({
		projectId,
		type,
		commandLog,
		presentation: { pacingDevices, presentation },
		editorState: {
			chatMessages: chat.messages,
			settings,
			trackFlags,
			hookVariants,
			direction,
			elementSources,
			renderOverrides,
			activePresetId,
			decisions: chat.decisions,
		},
		config,
		setSaveState,
		setSaveError,
	});
	flushEditorStateRef.current = flushEditorState;
	chatRef.current = chat;

	const generateStoryboardFromBrief = async (): Promise<void> => {
		const instruction = config.brief?.trim()
			? `Generate a storyboard for this video brief:\n\n${config.brief.trim()}`
			: "Generate a storyboard for this video project.";
		const job = await chat.start(instruction);
		if (!agentRunSucceeded(job)) setAgentFailed(true);
	};

	/* The one-time initial run, guarded per runKey against StrictMode's
	 * double-invoke, and the retry that re-fires it without creating a second
	 * project (see use-initial-run.ts). */
	const { retryInitial } = useInitialRun({
		pendingInitial,
		setPendingInitial,
		projectId,
		chat,
		setAgentFailed,
		generateStoryboardFromBrief,
	});
	const hasRenderableVideo = (): boolean => hasRenderableVisual(store.getDoc().clips);
	/* The export flow: menu, job, in-progress button and status modal. One
	 * control with two jobs, so the intent is derived rather than branched at the
	 * call site (see use-render-flow.ts). */
	const {
		renderJobId,
		setRenderJobId,
		rendering,
		setRendering,
		renderStatus,
		setRenderStatus,
		renderInfoOpen,
		setRenderInfoOpen,
		setExportMenuOpen,
		exportMenuRef,
		onRenderClick,
		confirmRender,
	} = useRenderFlow({
		chrome,
		projectId,
		getBlockers: () => [...renderPreflight.blockers, ...renderPreflight.serverBlockers],
		isVideo: () => type === "video",
		submit: () => submit(),
		setSaveError,
	});
	const [sourceProcessing, setSourceProcessing] = useState<Record<string, string>>({});
	const renderPreflight = buildRenderPreflight({
		processingSources: Object.values(sourceProcessing),
		mediaAssets,
		clips: withReadyPending(store.getDoc().clips),
		scenes,
		videoOverlays,
		audioOverlays,
		textOverlays: overlays,
		effects,
		agentRunning: chat.running,
		rendering,
	});
	const onLocalRender = async (): Promise<void> => {
		if (
			chrome.get().rendering ||
			["checking", "disconnected"].includes(chrome.get().exportConnection)
		)
			return;
		if (type === "video" && !hasRenderableVideo()) {
			setSaveError("Add media or generate a storyboard before exporting.");
			return;
		}
		setExportMenuOpen(false);
		setRenderJobId(null);
		chrome.patch("exportOrigin", "browser");
		chrome.patch("exportConnection", "idle");
		chrome.patch("exportError", null);
		await exportFastDraft({
			doc,
			aspect: settings.aspectRatio || config.format || "9:16",
			filename: `${titleSlug(titleByType) || "video"}-fast.mp4`,
			setRenderStatus,
			setRendering,
			setSaveError,
		});
	};

	// Reload during generation: re-attach to the project's still-running job (no
	// second generation). Only for loaded projects; fresh creates use pendingInitial.
	useEffect(() => {
		if (!projectId || !initialProjectId || pendingInitial || !projectLoaded) return;
		void chat.reattach();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [projectId, initialProjectId, projectLoaded]);
	const submit = (backendOverride?: "local" | "lambda"): void => {
		if (!type) return;
		setSubmitting(true);
		setSaveError(null);
		const outputTitle = titleForOutput(titleByType, type);
		void persistSubmission({
			saveStoryboard: flushStoryboard,
			projectId,
			type,
			title: outputTitle,
			doc,
			config,
			refs,
			creative,
			backendOverride,
			onRenderJob: setRenderJobId,
		})
			.then(() => {
				// Video render keeps the editor open with an in-progress indicator;
				// image/text submit flips to the done screen as before.
				if (type !== "video") setSubmitted(true);
			})
			.catch((err) => {
				setSaveError(`Submit failed to persist: ${errMsg(err)}`);
				setRendering(false);
			})
			.finally(() => {
				setSubmitting(false);
			});
	};

	const titleByType = titleFromContent({
		type,
		firstMarkerTitle: store.getDoc().markers[0]?.title,
		firstSlideName: slides[0]?.name,
		firstPostBody: posts[0]?.body,
	});
	const showRail = !submitted && type === "text";
	// One chain now: the project's title. The Create > Type chain belonged to the
	// setup screens and went to the form page with them.
	const editorCrumbs: CrumbSeg[] = [
		...(crumbs ?? []),
		{ label: titleForCrumb(config.title, titleByType) },
	];

	return (
		<div className="cv-shell">
			<div className="cv-root" style={{ flex: 1, minWidth: 0 }}>
				<EditorTopbar
					chrome={chrome}
					crumbs={editorCrumbs}
					type={type}
					submitted={submitted}
					onOpenNav={onOpenNav}
					showRail={showRail}
					onToggleRail={() => setRailOpen((o) => !o)}
					exportMenuRef={exportMenuRef}
					preflight={renderPreflight}
					onRenderClick={onRenderClick}
					onLocalRender={() => {
						void onLocalRender();
					}}
					onConfirmRender={() => confirmRender()}
					onOpenRenderStatus={() => setRenderInfoOpen(true)}
					onSubmit={() => submit()}
				/>

				<EditorNotices
					saveError={saveError}
					retrying={retrying}
					retrySave={retrySave}
					dismissSaveError={() => setSaveError(null)}
					agentFailed={agentFailed && !submitted}
					retryInitial={retryInitial}
					running={chat.running}
				/>
				<EditorViews
					chrome={chrome}
					type={type}
					submitted={submitted}
					projectId={projectId}
					config={config}
					setConfig={setConfig}
					library={library}
					doc={doc}
					creative={creative}
					chat={chat}
					selectionStore={selectionStore}
					onPlayheadReady={registerPlayhead}
					templates={timelineTemplates}
					onSelectTimelineTemplate={selectTimelineTemplate}
					onOpenLibrary={onOpenLibrary}
					onProcessingChange={(key, label) =>
						setSourceProcessing((prev) =>
							label === null
								? Object.fromEntries(Object.entries(prev).filter(([id]) => id !== key))
								: { ...prev, [key]: label },
						)
					}
					render={{ renderJobId, renderStatus, renderInfoOpen, setRenderInfoOpen }}
					initialScriptDensity={initialScriptDensity}
					onCreateAnother={onCreateAnother}
				/>
			</div>
		</div>
	);
}

export default CreateContent;
