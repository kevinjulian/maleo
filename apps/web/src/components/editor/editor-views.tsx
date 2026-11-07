/* The editor body: whichever view the mode tab picked, the image and text
 * workspaces, the completion card after a submit, and the render status modal.
 *
 * The reference-library handlers live here because only these views draw the
 * library, and the script view's density and current row because nothing else
 * reads them. Split out of `create-content.tsx`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps, JSX } from "react";
import type { Slide } from "@models/content/content-types.ts";
import type { ContentType, Scene } from "@maleo/shared";
import { EMPTY_PROJECT_MATERIALS } from "@maleo/shared";
import { selectScene } from "@models/timeline/selection-model.ts";
import { useShellChromeField, type ShellChromeStore } from "@stores/shell-chrome-store.ts";
import { Modal } from "@design-system/components/modal.tsx";
import { persistPrimaryEntity, persistProjectSelection, ReferenceLibrary } from "./references.tsx";
import { SceneStudio } from "./studio.tsx";
import { TimelineEditor } from "@components/timeline/timeline-editor.tsx";
import { ScriptView } from "@components/script/script-view.tsx";
import { StoryboardView } from "@components/storyboard/storyboard-view.tsx";
import type { ScriptDensity } from "@models/script/script-rows.ts";
import { TextWorkspace } from "./workspaces.tsx";
import type { RenderFlow } from "@hooks/editor/use-render-flow.ts";
import type { ContentChat } from "@hooks/editor/use-chat-session.ts";
import { scriptArcRoles } from "@models/script/arc-chapters.ts";
import { removeFromPool } from "@models/references/pool.ts";
import { RenderStatusBody } from "./render-status-body.tsx";
import { removeSelected, toggleSelected } from "@models/references/reference-ops.ts";
import { deleteGlobalReference } from "@api/workspace-catalogue.ts";
import { DoneView } from "./launcher.tsx";
import { ChatSplit } from "./chat-split.tsx";
import type { EditorDocument } from "./use-editor-document.ts";

type TimelineProps = ComponentProps<typeof TimelineEditor>;

interface EditorViewsProps {
	chrome: ShellChromeStore;
	type: ContentType | null;
	submitted: boolean;
	projectId: string;
	config: TimelineProps["config"];
	setConfig: TimelineProps["setConfig"];
	library: TimelineProps["library"];
	doc: EditorDocument;
	creative: TimelineProps["creative"];
	chat: ContentChat;
	selectionStore: TimelineProps["selectionStore"];
	onPlayheadReady: TimelineProps["onPlayheadReady"];
	onExportSource: TimelineProps["onExportSource"];
	templates: TimelineProps["templates"];
	onSelectTimelineTemplate: TimelineProps["onSelectTimelineTemplate"];
	onOpenLibrary: TimelineProps["onOpenLibrary"];
	onProcessingChange: TimelineProps["onProcessingChange"];
	render: Pick<
		RenderFlow,
		"renderJobId" | "renderStatus" | "renderInfoOpen" | "setRenderInfoOpen"
	> & {
		/** Stops a running browser export; the status modal offers it. */
		cancelBrowserExport: () => void;
	};
	initialScriptDensity?: ScriptDensity;
	onCreateAnother?: () => void;
}

export function EditorViews({
	chrome,
	type,
	submitted,
	projectId,
	config,
	setConfig,
	library,
	doc,
	creative,
	chat,
	selectionStore,
	onPlayheadReady,
	onExportSource,
	templates,
	onSelectTimelineTemplate,
	onOpenLibrary,
	onProcessingChange,
	render,
	initialScriptDensity,
	onCreateAnother,
}: EditorViewsProps): JSX.Element {
	const { refs, setRefs, pool, setPool, products, ensureMediaAsset } = library;
	const { store, writers, scenes, slides, setSlides, posts, setPosts, projectReferences } = doc;
	const { setScenes, setProjectReferences } = writers;
	const { renderJobId, renderStatus, renderInfoOpen, setRenderInfoOpen, cancelBrowserExport } =
		render;
	const [railOpen, setRailOpen] = useShellChromeField(chrome, "railOpen");
	const [chatOpen, setChatOpen] = useShellChromeField(chrome, "chatOpen");
	const [editorMode] = useShellChromeField(chrome, "editorMode");

	/* Exactly one lead subject per project; marking a new one clears the old. */
	/* Select = lock it AND attach it to the project roster, because generation
	 * resolves through the roster; a lock without an attachment renders nothing. */
	const toggleProjectSelection = (id: string): void => {
		const willSelect = !projectReferences.entityIds.includes(id);
		setProjectReferences((p) => toggleSelected(p, id));
		if (projectId) persistProjectSelection(projectId, id, willSelect);
	};

	const setPrimaryEntity = (id: string, next: boolean): void => {
		if (projectId) persistPrimaryEntity(projectId, id, next);
		setPool((entries) => entries.map((r) => ({ ...r, default: next && r.id === id })));
	};

	/* The reference library is workspace-scoped. Deleting removes the entity from
	 * that library and from this project's selection; clips keep their copies. */
	const deleteRef = async (id: string): Promise<boolean> => {
		try {
			await deleteGlobalReference(id);
		} catch {
			return false;
		}
		setPool((entries) => removeFromPool(entries, id));
		setRefs((r) => ({ ...r, notes: r.notes.filter((n) => n.id !== id) }));
		setProjectReferences((p) => removeSelected(p, id));
		return true;
	};

	/* Density is the script view's own concern and nothing else reads it, so it
	 * stays local rather than joining the shell's chrome. A route can seed it —
	 * the same bargain the view itself has: the address lands you somewhere, and
	 * after that it is the operator's choice. */
	const [scriptDensity, setScriptDensity] = useState<ScriptDensity>(
		initialScriptDensity ?? "write",
	);
	/* A ref, not state: the script marks its own current row internally, and the
	 * shell only needs to remember which one to hand over. Holding it as state
	 * would re-render the editor every time the cursor moved between rows. */
	const scriptSceneRef = useRef<number | undefined>(undefined);
	useEffect(() => {
		if (editorMode !== "timeline" || scriptSceneRef.current === undefined) return;
		selectionStore.set(selectScene(scriptSceneRef.current));
	}, [editorMode, selectionStore]);

	/* The plan's arc and per-chapter functions, for the script view.
	 *
	 * Read from the chat log rather than threaded down from the run: the plan
	 * artifact is already there, replayed with the project, so a reloaded project
	 * shows its structure without the run that made it. Display only — nothing here
	 * derives a chapter or writes to the document. */
	const arcRoles = useMemo(() => scriptArcRoles(chat.messages), [chat.messages]);

	return (
		<>
			{/* The completion card after an image or text project is submitted. The
			    launcher and setup screens that used to share this branch are the
			    create form page now. "Create another" is a navigation, not a teardown:
			    the form page mounts fresh and this page unmounts. */}
			{submitted && type && (
				<div className="cv-page">
					<DoneView
						type={type}
						renderJobId={renderJobId}
						onAnother={() => onCreateAnother?.()}
						onViewQueue={() => {
							window.location.href = "/video";
						}}
					/>
				</div>
			)}

			{!submitted && type === "video" && editorMode === "storyboard" && (
				<ChatSplit
					chat={chat}
					projectId={projectId}
					open={chatOpen}
					onOpenChange={setChatOpen}
					quickCommands={[
						"Improve selected beat",
						"Rewrite selected beat",
						"Regenerate selected beat",
					]}
				>
					<StoryboardView
						projectId={projectId}
						runChat={(instruction) => chat.start(instruction)}
					/>
				</ChatSplit>
			)}

			{/* Script reads and writes generated scenes shared with Timeline and Studio.
			    Storyboard above owns separate pre-production plan state. */}
			{!submitted && type === "video" && editorMode === "script" && (
				<ScriptView
					projectId={projectId}
					scenes={scenes}
					setScenes={setScenes}
					chapters={doc.chapters}
					store={store}
					config={config}
					refs={refs}
					pool={pool}
					projectReferences={projectReferences}
					settings={creative.settings}
					ensureMediaAsset={ensureMediaAsset}
					density={scriptDensity}
					onDensityChange={setScriptDensity}
					arcRoles={arcRoles}
					onCurrentSceneChange={(sceneId) => {
						scriptSceneRef.current = sceneId;
					}}
				/>
			)}

			{!submitted && type === "video" && editorMode === "timeline" && (
				<TimelineEditor
					onProcessingChange={onProcessingChange}
					selectionStore={selectionStore}
					onPlayheadReady={onPlayheadReady}
					onExportSource={onExportSource}
					config={config}
					setConfig={setConfig}
					library={library}
					projectId={projectId}
					store={store}
					writers={writers}
					undoStack={doc.undoStack}
					creative={creative}
					templates={templates}
					onSelectTimelineTemplate={onSelectTimelineTemplate}
					onOpenLibrary={onOpenLibrary}
					trackFlags={doc.trackFlags}
					setTrackFlags={writers.setTrackFlags}
					chat={chat}
				/>
			)}

			{!submitted && type === "video" && editorMode === "studio" && (
				<SceneStudio
					type={type}
					config={config}
					refs={refs}
					setRefs={setRefs}
					pool={pool}
					setPool={setPool}
					products={products}
					projectId={projectId}
					projectSelection={projectReferences}
					projectMaterials={store.getDoc().materials ?? EMPTY_PROJECT_MATERIALS}
					onToggleProjectSelection={toggleProjectSelection}
					onSetPrimary={setPrimaryEntity}
					onDeleteRef={deleteRef}
					items={scenes}
					// SAFETY: with type "video" the studio only builds and edits Scene rows
					// (`add` constructs a Scene for that type), so the wider setter sees Scenes only.
					setItems={setScenes as React.Dispatch<React.SetStateAction<(Scene | Slide)[]>>}
				/>
			)}

			{/* Image and text projects are retired: they open as manual editors with no
			    chat, in the same layout the chat split gave them. */}
			{!submitted && type === "image" && (
				<div className="cv-chatsplit">
					<div className="cv-chatsplit-main">
						<SceneStudio
							type={type}
							config={config}
							refs={refs}
							setRefs={setRefs}
							pool={pool}
							setPool={setPool}
							products={products}
							projectId={projectId}
							projectSelection={projectReferences}
							projectMaterials={store.getDoc().materials ?? EMPTY_PROJECT_MATERIALS}
							onToggleProjectSelection={toggleProjectSelection}
							onSetPrimary={setPrimaryEntity}
							onDeleteRef={deleteRef}
							items={slides}
							// SAFETY: with type "image" the studio only builds and edits Slide rows
							// (`add` constructs a Slide for that type), so the wider setter sees Slides only.
							setItems={setSlides as React.Dispatch<React.SetStateAction<(Scene | Slide)[]>>}
						/>
					</div>
				</div>
			)}

			{!submitted && type === "text" && (
				<div className="cv-chatsplit">
					<div className={`cv-chatsplit-main cv-grid ${railOpen ? "rail-open" : ""}`}>
						<main className="cv-main">
							<TextWorkspace config={config} posts={posts} setPosts={setPosts} />
						</main>
						<aside className="cv-rail">
							<ReferenceLibrary
								mode="rail"
								type={type}
								refs={refs}
								setRefs={(fn) => setRefs(fn)}
								pool={pool}
								setPool={(fn) => setPool(fn)}
								products={products}
								projectId={projectId}
								projectSelection={projectReferences}
								onToggleProjectSelection={toggleProjectSelection}
								sceneCasts={scenes.map((s) => s.refIds ?? [])}
								primaryEntityId={pool.find((r) => r.primary)?.id ?? null}
								onSetPrimary={setPrimaryEntity}
								onDeleteRef={deleteRef}
								onClose={() => setRailOpen(false)}
							/>
						</aside>
						{railOpen && (
							<div
								aria-hidden="true"
								className="cv-rail-scrim"
								onClick={() => setRailOpen(false)}
							/>
						)}
					</div>
				</div>
			)}

			{renderInfoOpen && (
				<Modal
					dismissOnBack
					title="Render status"
					sub="Live status of the current export"
					onClose={() => setRenderInfoOpen(false)}
					width={440}
				>
					<RenderStatusBody
						status={renderStatus}
						jobId={renderJobId}
						chrome={chrome}
						onCancelBrowserExport={cancelBrowserExport}
					/>
				</Modal>
			)}
		</>
	);
}
