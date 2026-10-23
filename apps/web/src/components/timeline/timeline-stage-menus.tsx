/* The stage's three right-click menus: the clip menu, the scene menu and the
 * Add-clip menu that opens on empty lane space.
 *
 * Split out of `timeline-stage.tsx`, which still mounts them — they are
 * fixed-position overlays and belong to whichever surface paints on top (see
 * that module's header). Their open state stays in the editor; this draws
 * whichever is open and closes it after acting. */
import type { JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { ExpandKeyframesItem, KeyframeClipboardItems } from "./clip-keyframe-lanes.tsx";
import { EFFECT_DEFS } from "@models/timeline/editor-media.ts";
import { fmtTC } from "@models/timeline/timeline-editor-model.ts";
import type { Scene } from "@maleo/shared";
import type { EditorChromeStore } from "@stores/editor-chrome-store.ts";
import type { TimelineDocumentStore } from "@stores/timeline-document-store.ts";
import type { DocumentWriters } from "@stores/document-writers.ts";
import type { TimelineStageOps, TimelineStageView } from "./timeline-stage.tsx";

interface TimelineStageMenusProps {
	store: TimelineDocumentStore;
	writers: DocumentWriters;
	chromeStore: EditorChromeStore;
	projectId: string | null;
	scenes: Scene[];
	ops: TimelineStageOps;
	view: TimelineStageView;
}

export function TimelineStageMenus({
	store,
	writers,
	chromeStore,
	projectId,
	scenes,
	ops,
	view,
}: TimelineStageMenusProps): JSX.Element {
	const {
		trackLocked,
		addOverlay,
		addAudio,
		addEffect,
		addSceneAt,
		dupScene,
		rmScene,
		copySelection,
		pasteClipboard,
		duplicateSelection,
		deleteSelection,
		rippleDeleteSelection,
		reorderSelection,
		setCtxMenu,
		setSceneMenu,
		setAddMenu,
		clampMenuToViewport,
	} = ops;
	const { selectionIds, clipboard, ctxMenu, sceneMenu, addMenu } = view;
	return (
		<>
			{ctxMenu &&
				(() => {
					const n = selectionIds().length;
					return (
						<>
							<button
								type="button"
								className="tl2-ctxscrim"
								aria-label="Close menu"
								onPointerDown={() => setCtxMenu(null)}
								onContextMenu={(e) => {
									e.preventDefault();
									setCtxMenu(null);
								}}
							/>
							<div
								ref={clampMenuToViewport}
								className="tl2-ctxmenu"
								style={{ left: ctxMenu.x, top: ctxMenu.y }}
								role="menu"
							>
								<button
									type="button"
									role="menuitem"
									onClick={() => {
										duplicateSelection();
										setCtxMenu(null);
									}}
								>
									{Ic.layers(ICON.sm)} Duplicate <kbd>⌘D</kbd>
								</button>
								<button
									type="button"
									role="menuitem"
									onClick={() => {
										copySelection();
										setCtxMenu(null);
									}}
								>
									{Ic.layers(ICON.sm)} Copy <kbd>⌘C</kbd>
								</button>
								<button
									type="button"
									role="menuitem"
									disabled={!clipboard.length}
									onClick={() => {
										pasteClipboard();
										setCtxMenu(null);
									}}
								>
									{Ic.plus(ICON.sm)} Paste here <kbd>⌘V</kbd>
								</button>
								<ExpandKeyframesItem
									store={store}
									selection={view.selection}
									chromeStore={chromeStore}
									onDone={() => setCtxMenu(null)}
								/>
								<KeyframeClipboardItems
									projectId={projectId}
									store={store}
									selection={view.selection}
									chromeStore={chromeStore}
									writers={writers}
									onDone={() => setCtxMenu(null)}
								/>
								<div className="tl2-ctxsep" />
								<button
									type="button"
									role="menuitem"
									onClick={() => {
										reorderSelection("front");
										setCtxMenu(null);
									}}
								>
									{Ic.layers(ICON.sm)} Bring to front
								</button>
								<button
									type="button"
									role="menuitem"
									onClick={() => {
										reorderSelection("back");
										setCtxMenu(null);
									}}
								>
									{Ic.layers(ICON.sm)} Send to back
								</button>
								<div className="tl2-ctxsep" />
								<button
									type="button"
									role="menuitem"
									className="danger"
									onClick={() => {
										deleteSelection();
										setCtxMenu(null);
									}}
								>
									{Ic.x(ICON.sm)} Delete{n > 1 ? ` ${n} clips` : ""} <kbd>⌫</kbd>
								</button>
								<button
									type="button"
									role="menuitem"
									className="danger"
									onClick={() => {
										rippleDeleteSelection();
										setCtxMenu(null);
									}}
								>
									{Ic.x(ICON.sm)} Ripple delete <kbd>⇧⌫</kbd>
								</button>
							</div>
						</>
					);
				})()}

			{sceneMenu &&
				(() => {
					const scene = scenes.find((s) => s.id === sceneMenu.sceneId);
					const locked = trackLocked(-1);
					const close = (): void => setSceneMenu(null);
					if (!scene) return null;
					return (
						<>
							<button
								type="button"
								className="tl2-ctxscrim"
								aria-label="Close scene menu"
								onPointerDown={close}
								onContextMenu={(e) => {
									e.preventDefault();
									close();
								}}
							/>
							<div
								ref={clampMenuToViewport}
								className="tl2-ctxmenu"
								style={{ left: sceneMenu.x, top: sceneMenu.y }}
								role="menu"
							>
								<div className="tl2-ctxhead">{scene.name || "Scene"}</div>
								<button
									type="button"
									role="menuitem"
									disabled={locked}
									onClick={() => {
										dupScene(scene);
										close();
									}}
								>
									{Ic.layers(ICON.sm)} Duplicate scene
								</button>
								<ExpandKeyframesItem
									store={store}
									selection={view.selection}
									chromeStore={chromeStore}
									onDone={close}
								/>
								<KeyframeClipboardItems
									projectId={projectId}
									store={store}
									selection={view.selection}
									chromeStore={chromeStore}
									writers={writers}
									onDone={close}
								/>
								<button
									type="button"
									role="menuitem"
									className="danger"
									disabled={locked || scenes.length <= 1}
									onClick={() => {
										rmScene(scene.id);
										close();
									}}
								>
									{Ic.trash(ICON.sm)} Delete scene
								</button>
							</div>
						</>
					);
				})()}

			{/* Right-click on empty lane space → context-aware Add clip menu. Base
    lane splices a scene into the reel; free lanes place the clip at the
    snapped time on that row. */}
			{addMenu &&
				(() => {
					const { t, row } = addMenu;
					const close = (): void => setAddMenu(null);
					return (
						<>
							<button
								type="button"
								className="tl2-ctxscrim"
								aria-label="Close menu"
								onPointerDown={close}
								onContextMenu={(e) => {
									e.preventDefault();
									close();
								}}
							/>
							<div
								ref={clampMenuToViewport}
								className="tl2-ctxmenu"
								style={{ left: addMenu.x, top: addMenu.y }}
								role="menu"
							>
								<div className="tl2-ctxhead">Add at {fmtTC(t)}</div>
								{row === -1 ? (
									<button
										type="button"
										role="menuitem"
										onClick={() => {
											addSceneAt(t);
											close();
										}}
									>
										{Ic.film(ICON.sm)} Scene here
									</button>
								) : (
									<>
										<button
											type="button"
											role="menuitem"
											onClick={() => {
												addOverlay(t, row);
												close();
											}}
										>
											{Ic.type(ICON.sm)} Text
										</button>
										<button
											type="button"
											role="menuitem"
											onClick={() => {
												addAudio("voiceover", { start: t, track: row });
												close();
											}}
										>
											{Ic.mic(ICON.sm)} Voiceover
										</button>
										<button
											type="button"
											role="menuitem"
											onClick={() => {
												addAudio("music", { start: t, track: row });
												close();
											}}
										>
											{Ic.music(ICON.sm)} Music
										</button>
										<button
											type="button"
											role="menuitem"
											onClick={() => {
												addAudio("sfx", { start: t, track: row });
												close();
											}}
										>
											{Ic.spark(ICON.sm)} SFX
										</button>
										<button
											type="button"
											role="menuitem"
											onClick={() => {
												addEffect(EFFECT_DEFS[0]!.kind, t, row);
												close();
											}}
										>
											{Ic.spark(ICON.sm)} Effect
										</button>
									</>
								)}
								<div className="tl2-ctxsep" />
								<button
									type="button"
									role="menuitem"
									disabled={!clipboard.length}
									onClick={() => {
										pasteClipboard(t, row >= 0 ? row : undefined);
										close();
									}}
								>
									{Ic.plus(ICON.sm)} Paste here <kbd>⌘V</kbd>
								</button>
							</div>
						</>
					);
				})()}
		</>
	);
}
