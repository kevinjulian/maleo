/* The clip inspector's body for a selected scene: one branch per property
 * group. Called from TimelineClipInspector with the context it derived. */
import type { JSX } from "react";
import type { Scene } from "@maleo/shared";
import { AccordionSection, BlendingSection, TransformSection } from "./clip-canvas.tsx";
import { AlphaColorControl } from "@design-system/components/color-control.tsx";
import { Button } from "@design-system/components/button.tsx";
import { Input } from "@design-system/components/input.tsx";
import { Note } from "@design-system/components/note.tsx";
import { Select } from "@design-system/components/select.tsx";
import { PropertyRow } from "@design-system/patterns/inspector.tsx";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { STUDIO_SHOTS, STUDIO_MOVES } from "@models/timeline/editor-media.ts";
import { canvasLayoutOf } from "@models/editor-engine/canvas-document.ts";
import { normalizeLayout } from "@models/timeline/clip-layout.ts";
import { SourcePlaybackControl } from "./source-playback-control.tsx";
import { SceneVisualSource } from "./scene-visual-source.tsx";
import {
	RevealControls,
	scenePrimaryVisual,
	sceneVisualsWithReveal,
} from "./clip-reveal-controls.tsx";
import type { ClipBodyContext } from "./clip-body-context.ts";

export function sceneClipBody(c: ClipBodyContext, selectedScene: Scene): JSX.Element {
	const { tab, liveDoc, rowKeying, transform, compositing, blendMode, editHost } = c;
	const { projectId, onProcessingChange, store, writers, chromeStore, library } = c;
	const { settings, setSettings } = c.creative;
	const { previewProps } = c.view;
	const { openSceneEditor, setSceneLayout, upd } = c.ops;
	const primaryVisual = scenePrimaryVisual(selectedScene);
	if (tab === "content")
		return (
			<>
				<AccordionSection label="Prompt & references" defaultOpen>
					{editHost({ type: "scene", id: selectedScene.id })}
				</AccordionSection>
				<AccordionSection label="Frames">
					<Note style={{ marginTop: 0 }}>
						Start / end frames, focal point and shot live in the full editor.
					</Note>
					<Button
						variant="secondary"
						size="sm"
						style={{ justifyContent: "center", width: "100%" }}
						onClick={() => openSceneEditor(selectedScene.id)}
					>
						{Ic.film(ICON.sm)} Open frames & shot editor
					</Button>
				</AccordionSection>
			</>
		);
	if (tab === "shot")
		return (
			<>
				<AccordionSection label="Camera" defaultOpen>
					<PropertyRow label="Shot">
						<Select
							size="xs"
							value={selectedScene.shot}
							onValueChange={(e) => upd(selectedScene.id, "shot", e)}
							aria-label={"Shot"}
							phoneBreakpoint={860}
							options={[...(STUDIO_SHOTS.map((x) => ({ value: x, label: x })) ?? [])]}
						/>
					</PropertyRow>
					<PropertyRow label="Movement">
						<Select
							size="xs"
							value={selectedScene.move}
							onValueChange={(e) => upd(selectedScene.id, "move", e)}
							aria-label={"Movement"}
							phoneBreakpoint={860}
							options={[...(STUDIO_MOVES.map((x) => ({ value: x, label: x })) ?? [])]}
						/>
					</PropertyRow>
				</AccordionSection>
				<AccordionSection label="Timing & action" defaultOpen>
					<PropertyRow label="Duration (s)">
						<Input
							size="xs"
							type="number"
							min={1}
							max={3600}
							value={selectedScene.dur}
							onChange={(e) =>
								upd(
									selectedScene.id,
									"dur",
									Math.max(1, Math.min(3600, Number(e.target.value) || 1)),
								)
							}
						/>
					</PropertyRow>
					<PropertyRow label="On-screen action">
						<Input
							size="xs"
							value={selectedScene.action || ""}
							onChange={(e) => upd(selectedScene.id, "action", e.target.value)}
							placeholder="What happens in the shot…"
						/>
					</PropertyRow>
				</AccordionSection>
				<RevealControls
					reveal={primaryVisual?.reveal}
					clipDurationSec={primaryVisual?.durationSec ?? selectedScene.dur}
					onChange={(reveal) =>
						upd(selectedScene.id, "visualClips", sceneVisualsWithReveal(selectedScene, reveal))
					}
				/>
			</>
		);
	if (tab === "background")
		return (
			<AccordionSection label="Background fill" defaultOpen>
				<PropertyRow label="Fill" as="div">
					<AlphaColorControl
						display="value"
						label="Background"
						value={settings.backgroundFill}
						fallback={previewProps.bgColor || "#000000"}
						onChange={(backgroundFill) => setSettings((prev) => ({ ...prev, backgroundFill }))}
					/>
				</PropertyRow>
			</AccordionSection>
		);
	const sceneTarget = { source: "scene" as const, id: selectedScene.id };
	if (tab === "blending")
		return (
			<>
				{transform(
					<BlendingSection
						layout={normalizeLayout(
							canvasLayoutOf(liveDoc, { source: "scene", id: selectedScene.id })?.layout ??
								selectedScene.layout,
							"scene",
						)}
						kind="scene"
						keying={rowKeying}
						blend={blendMode(sceneTarget)}
						onChange={(p) => setSceneLayout(selectedScene.id, p)}
					/>,
				)}
			</>
		);
	if (tab === "masks") return compositing(sceneTarget, ["mask"]);
	if (tab === "adjust") return compositing(sceneTarget, ["color"]);
	if (tab === "timing")
		return (
			<AccordionSection label="Playback" defaultOpen>
				{selectedScene.visualClips
					?.filter((v) => v.kind === "video")
					.map((v) => (
						<SourcePlaybackControl
							key={v.id}
							onProcessingChange={onProcessingChange}
							projectId={projectId}
							target={{ source: "scene", id: selectedScene.id, visualId: v.id }}
							store={store}
							writers={writers}
							library={library}
							label={`Reverse ${v.label || "video"}`}
						/>
					))}
			</AccordionSection>
		);
	return (
		<>
			<SceneVisualSource sceneId={selectedScene.id} store={store} chromeStore={chromeStore} />
			{transform(
				<TransformSection
					layout={normalizeLayout(
						canvasLayoutOf(liveDoc, { source: "scene", id: selectedScene.id })?.layout ??
							selectedScene.layout,
						"scene",
					)}
					kind="scene"
					keying={rowKeying}
					onChange={(p) => setSceneLayout(selectedScene.id, p)}
				/>,
			)}
		</>
	);
}
