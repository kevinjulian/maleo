/* The right-hand scene drawer: the ONLY place a single scene is edited.
 * Opened by double-clicking a video clip; the left rail is never scene-scoped. */
import { focalPointAt, nudgeFocalPoint } from "@models/timeline/focal-point.ts";
import { useState } from "react";
import type { Dispatch, SetStateAction, JSX, ReactNode } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { Frame } from "@design-system/components/frame.tsx";
import { Shimmer } from "@design-system/components/shimmer.tsx";
import { MentionTextarea } from "./mention-textarea.tsx";
import { STUDIO_SHOTS, STUDIO_MOVES } from "@models/timeline/editor-media.ts";
import type { ToggleCat } from "./timeline-editor-panels.tsx";
import { MotionEditor } from "@components/timeline/motion/motion-editor.tsx";
import { resolveSceneRefs } from "@hooks/timeline/use-scene-refs.ts";
import { SceneReferenceChips } from "./scene-reference-chips.tsx";
import type { ProjectSelection, RefImage, RefsState, Scene, CatalogueProduct } from "@maleo/shared";
import { ClipControls } from "./clip-canvas.tsx";
import { normalizeLayout } from "@models/timeline/clip-layout.ts";
import { Button } from "@design-system/components/button.tsx";
import { Select } from "@design-system/components/select.tsx";
import { Field } from "@design-system/components/field.tsx";
import { Note } from "@design-system/components/note.tsx";
import { Input } from "@design-system/components/input.tsx";
import { NumberField } from "@design-system/components/number-field.tsx";
import { PropertyRow } from "@design-system/patterns/inspector.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";
import { Section } from "@design-system/components/panel.tsx";

interface SceneEditorDrawerProps {
	scene: Scene;
	index: number;
	aspect: number;
	refs: RefsState;
	setRefs: Dispatch<SetStateAction<RefsState>>;
	/** The reference pool: workspace library + this project's roster. */
	pool: RefImage[];
	projectReferences: ProjectSelection;
	products: CatalogueProduct[];
	projectId: string | null;
	genBusy: boolean;
	genEndBusy: boolean;
	onClose: () => void;
	onGenerate: (slot?: "start" | "end") => void;
	onClearEnd: () => void;
	onUpd: (id: number, f: keyof Scene, v: unknown) => void;
	onToggleRef: (cat: ToggleCat, id: string) => void;
}

export function SceneEditorDrawer(p: SceneEditorDrawerProps): JSX.Element {
	const { scene, index, aspect } = p;
	// Per-clip motion: when a scene holds several visual clips, motion can target
	// the scene default OR a specific clip. Reset the target if the clip vanishes.
	const motionVisClips = scene.visualClips ?? [];
	const [motionTarget, setMotionTarget] = useState<string>("scene");
	const motionTargetClip =
		motionTarget !== "scene" ? motionVisClips.find((v) => v.id === motionTarget) : undefined;
	const refPool = p.pool;
	// One resolver decides what generates: opt-out, roster defaulting, and the
	// subject cap. The cap used to be re-implemented right here, which is why this
	// drawer and the studio cards described different sets.
	const resolved = resolveSceneRefs(refPool, p.projectReferences, scene);
	return (
		<div className="tl2-scenedrawer-inner">
			<header className="tl2-scenedrawer-head">
				<div className="tl2-scenedrawer-id">
					<span className="tl2-scenedrawer-kicker">Scene {index + 1}</span>
					<Input
						className="tl2-scenedrawer-title"
						value={scene.name}
						onChange={(e) => p.onUpd(scene.id, "name", e.target.value)}
						placeholder="Scene name"
					/>
				</div>
				<IconButton size="xs" onClick={p.onClose} title="Close scene editor">
					{Ic.x(ICON.sm)}
				</IconButton>
			</header>

			<div className="tl2-scenedrawer-body">
				<Section>
					<div className="tl2-dsec-h">{Ic.film(ICON.sm)} Frames</div>
					<div className="tl2-frames">
						<FrameSlot
							cap="Start frame"
							src={scene.src}
							seed={scene.seed || scene.id}
							aspect={aspect}
							busy={p.genBusy}
							onGenerate={() => p.onGenerate("start")}
						/>
						<FrameSlot
							cap="End frame"
							optional
							src={scene.endSrc}
							seed={(scene.seed || scene.id) + 1}
							aspect={aspect}
							busy={p.genEndBusy}
							onGenerate={() => p.onGenerate("end")}
							onClear={scene.endSrc ? p.onClearEnd : undefined}
						/>
					</div>
					<Note>
						The clip animates from the start frame to the end frame. Leave the end empty to animate
						from a single image.
					</Note>
				</Section>

				<Section>
					<div className="tl2-dsec-h">{Ic.layers(ICON.sm)} Placement</div>
					<ClipControls
						layout={scene.layout}
						kind="scene"
						onChange={(patch) =>
							p.onUpd(scene.id, "layout", { ...normalizeLayout(scene.layout, "scene"), ...patch })
						}
					/>
				</Section>
				<Section>
					<div className="tl2-dsec-h">{Ic.layers(ICON.sm)} Shot</div>
					<RailField label="Visual prompt">
						<MentionTextarea
							rows={3}
							value={scene.vis}
							selectedRefIds={scene.refIds}
							refs={refPool}
							onChange={(value) => p.onUpd(scene.id, "vis", value)}
							onRefIdsChange={(ids) => p.onUpd(scene.id, "refIds", ids)}
							placeholder="Describe this shot. Type @ to use a reference…"
						/>
					</RailField>
					<PropertyRow label="Camera">
						<Select
							size="xs"
							value={scene.shot}
							onValueChange={(e) => p.onUpd(scene.id, "shot", e)}
							aria-label={"Camera"}
							phoneBreakpoint={860}
							options={[...(STUDIO_SHOTS.map((x) => ({ value: x, label: x })) ?? [])]}
						/>
					</PropertyRow>
					<PropertyRow label="Movement">
						<Select
							size="xs"
							value={scene.move}
							disabled={!!scene.motion}
							onValueChange={(e) => p.onUpd(scene.id, "move", e)}
							aria-label={"Movement"}
							phoneBreakpoint={860}
							options={[...(STUDIO_MOVES.map((x) => ({ value: x, label: x })) ?? [])]}
						/>
					</PropertyRow>
					{motionVisClips.length > 1 && (
						<PropertyRow label="Motion applies to">
							<Select
								size="xs"
								value={motionTarget}
								onValueChange={(e) => setMotionTarget(e)}
								aria-label={"Motion applies to"}
								phoneBreakpoint={860}
								options={[
									{ value: "scene", label: "All clips (scene default)" },
									...(motionVisClips.map((v, i) => ({
										value: v.id,
										label:
											"Clip" +
											String(i + 1) +
											String(v.primary ? " (primary)" : "") +
											String(v.motion ? " · custom" : ""),
									})) ?? []),
								]}
							/>
						</PropertyRow>
					)}
					{/* A `div`, not a label: a label names the first control inside it, and
					    this block holds a whole editor — its first button was being
					    announced as the entire block's text. */}
					<RailField
						as="div"
						label={motionTargetClip ? "Custom motion (this clip)" : "Custom motion"}
					>
						<MotionEditor
							move={scene.move}
							motion={motionTargetClip ? motionTargetClip.motion : scene.motion}
							src={motionTargetClip ? motionTargetClip.url : scene.src}
							aspect={aspect}
							onChange={(motion) => {
								if (motionTargetClip)
									p.onUpd(
										scene.id,
										"visualClips",
										motionVisClips.map((v) =>
											v.id === motionTargetClip.id ? { ...v, motion } : v,
										),
									);
								else p.onUpd(scene.id, "motion", motion);
							}}
						/>
					</RailField>
					<PropertyRow label="Duration">
						<NumberField
							suffix="s"
							min={1}
							max={3600}
							value={scene.dur}
							onValueChange={(v) => p.onUpd(scene.id, "dur", Math.max(1, Math.min(3600, v || 1)))}
						/>
					</PropertyRow>
					<Note tone="muted">
						The transition into the next clip is edited on the timeline handle between them.
					</Note>
					{scene.src && (
						<RailField as="div" label="Focal point — click where the camera should zoom">
							<div
								className="tl2-focal"
								style={{ aspectRatio: String(aspect) }}
								role="group"
								tabIndex={0}
								aria-label={
									scene.focalPoint
										? `Focal point ${scene.focalPoint.xPct}% across, ${scene.focalPoint.yPct}% down; arrow keys move it`
										: "Focal point not set; arrow keys set it"
								}
								onClick={(e) =>
									p.onUpd(
										scene.id,
										"focalPoint",
										focalPointAt(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect()),
									)
								}
								onKeyDown={(e) => {
									const next = nudgeFocalPoint(scene.focalPoint, e.key);
									if (!next) return;
									e.preventDefault();
									p.onUpd(scene.id, "focalPoint", next);
								}}
							>
								<img src={scene.src} alt="Focal point picker" draggable={false} />
								{scene.focalPoint && (
									<span
										className="tl2-focal-dot"
										style={{ left: `${scene.focalPoint.xPct}%`, top: `${scene.focalPoint.yPct}%` }}
									/>
								)}
							</div>
							{scene.focalPoint && (
								<Button
									variant="secondary"
									size="sm"
									style={{ marginTop: 6 }}
									onClick={() => p.onUpd(scene.id, "focalPoint", undefined)}
								>
									{Ic.x(ICON.xs)} Reset to center
								</Button>
							)}
						</RailField>
					)}
					<PropertyRow label="On-screen action">
						<Input
							size="xs"
							value={scene.action || ""}
							onChange={(e) => p.onUpd(scene.id, "action", e.target.value)}
							placeholder="What happens in the shot…"
						/>
					</PropertyRow>
					<label className="tl2-checkrow">
						<input
							type="checkbox"
							checked={scene.useGlobalReferences !== false}
							onChange={(e) =>
								p.onUpd(scene.id, "useGlobalReferences", e.target.checked ? undefined : false)
							}
						/>
						<span>Use project references</span>
					</label>
				</Section>

				<Section>
					<div className="tl2-dsec-h">
						{Ic.image(ICON.sm)} References used{" "}
						<span className="tl2-dsec-hint">@ mention in prompt</span>
					</div>
					<SceneReferenceChips
						resolved={resolved}
						emptyHint="No references selected yet. Type @ in the visual prompt and choose a reference."
					/>
				</Section>
			</div>
		</div>
	);
}

interface FrameSlotProps {
	cap: string;
	optional?: boolean;
	src?: string;
	seed: number;
	aspect: number;
	busy: boolean;
	onGenerate: () => void;
	onClear?: () => void;
}
function FrameSlot({
	cap,
	optional,
	src,
	seed,
	aspect,
	busy,
	onGenerate,
	onClear,
}: FrameSlotProps): JSX.Element {
	return (
		<div className="tl2-frameslot">
			<span className="tl2-frame-cap">
				{cap}
				{optional && <em> optional</em>}
			</span>
			<Frame
				generated={Boolean(src) && !busy}
				src={src}
				seed={seed}
				aspect={aspect}
				icon={Ic.image(ICON.lg)}
				label={cap}
				enlargeable
			>
				{busy && <Shimmer />}
				{!src && !busy && (
					<button className="tl2-frame-gen" onClick={onGenerate}>
						{Ic.spark(ICON.xs)} Generate
					</button>
				)}
				{src && !busy && (
					<button className="tl2-frame-regen" onClick={onGenerate} title="Regenerate">
						{Ic.regen(ICON.xs)}
					</button>
				)}
				{src && !busy && onClear && (
					<button className="tl2-frame-clear" onClick={onClear} title="Remove">
						{Ic.x(ICON.xs)}
					</button>
				)}
			</Frame>
		</div>
	);
}

/* ════════ Audio clip controls (right drawer) ════════ */
/* This file had already invented Field locally, which is the duplication the
 * shared primitive exists to end. Kept as a named local for the label shape the
 * rail variant uses; it delegates rather than re-declaring the class. */
function RailField({
	label,
	as,
	children,
}: {
	label: string;
	as?: "label" | "div";
	children: ReactNode;
}): JSX.Element {
	return (
		<Field as={as}>
			<span>{label}</span>
			{children}
		</Field>
	);
}

/* ════════ Edit Timeline Item modal (double-click a clip) ════════ */
