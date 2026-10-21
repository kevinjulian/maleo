/* The reveal effect a visual clip enters with, and the helpers that read and
 * write it on a scene's primary visual. Shared by the scene and b-roll bodies
 * of the clip inspector. */
import type { JSX } from "react";
import type { Scene, SceneVisualClip, VisualRevealEffect } from "@maleo/shared";
import { AccordionSection } from "./clip-canvas.tsx";
import { Select, onSelect } from "@design-system/components/select.tsx";
import { Switch } from "@design-system/components/switch.tsx";
import { AmountField, FieldRow, PropertyRow } from "@design-system/patterns/inspector.tsx";
import {
	CLIENT_VISUAL_REVEAL_COLOR_BUILDS,
	CLIENT_VISUAL_REVEAL_BLACK_DIRECTIONS,
	CLIENT_VISUAL_REVEAL_DIRECTIONS,
	CLIENT_VISUAL_REVEAL_PHASES,
	CLIENT_VISUAL_REVEAL_TEXTURES,
	CLIENT_VISUAL_REVEAL_TYPES,
	DEFAULT_VISUAL_REVEAL,
	VISUAL_REVEAL_COLOR_BUILD_LABEL,
	VISUAL_REVEAL_BLACK_DIRECTION_LABEL,
	VISUAL_REVEAL_DIRECTION_LABEL,
	VISUAL_REVEAL_PHASE_LABEL,
	VISUAL_REVEAL_TEXTURE_LABEL,
	VISUAL_REVEAL_TYPE_LABEL,
	clampRevealDurationSec,
	setRevealDurationMode,
} from "@models/timeline/timeline-editor-model.ts";

function withoutReveal<T extends { reveal?: VisualRevealEffect }>(value: T): T {
	return { ...value, reveal: undefined };
}

export function scenePrimaryVisual(scene: Scene): SceneVisualClip | undefined {
	return scene.visualClips?.find((clip) => clip.primary) ?? scene.visualClips?.[0];
}

export function sceneVisualsWithReveal(
	scene: Scene,
	reveal: VisualRevealEffect | undefined,
): SceneVisualClip[] {
	const clips = scene.visualClips?.length
		? scene.visualClips
		: scene.src
			? [
					{
						id: `scene-${scene.id}-visual-1`,
						kind: "image" as const,
						label: scene.name,
						url: scene.src,
						mediaAssetId: scene.mediaAssetId,
						startSec: 0,
						durationSec: scene.dur,
						primary: true,
					},
				]
			: [];
	const targetId = clips.find((clip) => clip.primary)?.id ?? clips[0]?.id;
	return clips.map((clip) =>
		clip.id === targetId ? (reveal ? { ...clip, reveal } : withoutReveal(clip)) : clip,
	);
}

export function RevealControls({
	reveal,
	clipDurationSec,
	onChange,
}: {
	reveal?: VisualRevealEffect;
	clipDurationSec: number;
	onChange: (reveal: VisualRevealEffect | undefined) => void;
}): JSX.Element {
	const current = reveal ?? DEFAULT_VISUAL_REVEAL;
	const durationMode = current.durationSec == null ? "auto" : "manual";
	return (
		<AccordionSection label="Reveal effect" defaultOpen>
			<PropertyRow label="Enabled">
				<Switch
					size="sm"
					checked={Boolean(reveal)}
					onCheckedChange={(on) => onChange(on ? DEFAULT_VISUAL_REVEAL : undefined)}
				/>
			</PropertyRow>
			{reveal ? (
				<>
					<>
						<PropertyRow label="Type">
							<Select
								size="xs"
								value={current.type}
								onValueChange={onSelect(CLIENT_VISUAL_REVEAL_TYPES, (type) =>
									onChange({ ...current, type }),
								)}
								aria-label={"Type"}
								phoneBreakpoint={860}
								options={[
									...(CLIENT_VISUAL_REVEAL_TYPES.map((type) => ({
										value: type,
										label: VISUAL_REVEAL_TYPE_LABEL[type],
									})) ?? []),
								]}
							/>
						</PropertyRow>
						<PropertyRow label="Direction">
							<Select
								size="xs"
								value={current.direction ?? "top_left_to_bottom_right"}
								onValueChange={onSelect(CLIENT_VISUAL_REVEAL_DIRECTIONS, (direction) =>
									onChange({ ...current, direction }),
								)}
								aria-label={"Direction"}
								phoneBreakpoint={860}
								options={[
									...(CLIENT_VISUAL_REVEAL_DIRECTIONS.map((direction) => ({
										value: direction,
										label: VISUAL_REVEAL_DIRECTION_LABEL[direction],
									})) ?? []),
								]}
							/>
						</PropertyRow>
					</>
					<PropertyRow label="Phase">
						<Select
							size="xs"
							value={current.phase ?? "direct"}
							onValueChange={onSelect(CLIENT_VISUAL_REVEAL_PHASES, (phase) =>
								onChange(
									phase === "direct" ? { ...current, phase: undefined } : { ...current, phase },
								),
							)}
							aria-label={"Phase"}
							phoneBreakpoint={860}
							options={[
								...(CLIENT_VISUAL_REVEAL_PHASES.map((phase) => ({
									value: phase,
									label: VISUAL_REVEAL_PHASE_LABEL[phase],
								})) ?? []),
							]}
						/>
					</PropertyRow>
					{(current.phase ?? "direct") === "black_then_color" ? (
						<PropertyRow label="Black slide">
							<Select
								size="xs"
								value={current.blackDirection ?? "right"}
								onValueChange={onSelect(CLIENT_VISUAL_REVEAL_BLACK_DIRECTIONS, (blackDirection) =>
									onChange(
										blackDirection === "right"
											? { ...current, blackDirection: undefined }
											: { ...current, blackDirection },
									),
								)}
								aria-label={"Black slide"}
								phoneBreakpoint={860}
								options={[
									...(CLIENT_VISUAL_REVEAL_BLACK_DIRECTIONS.map((direction) => ({
										value: direction,
										label: VISUAL_REVEAL_BLACK_DIRECTION_LABEL[direction],
									})) ?? []),
								]}
							/>
						</PropertyRow>
					) : null}
					<>
						<PropertyRow label="Edge">
							<Select
								size="xs"
								value={current.texture ?? "clean"}
								onValueChange={onSelect(CLIENT_VISUAL_REVEAL_TEXTURES, (texture) =>
									onChange(
										texture === "clean"
											? { ...current, texture: undefined }
											: { ...current, texture },
									),
								)}
								aria-label={"Edge"}
								phoneBreakpoint={860}
								options={[
									...(CLIENT_VISUAL_REVEAL_TEXTURES.map((texture) => ({
										value: texture,
										label: VISUAL_REVEAL_TEXTURE_LABEL[texture],
									})) ?? []),
								]}
							/>
						</PropertyRow>
						<PropertyRow label="Color">
							<Select
								size="xs"
								value={current.colorBuild ?? "none"}
								onValueChange={onSelect(CLIENT_VISUAL_REVEAL_COLOR_BUILDS, (colorBuild) =>
									onChange(
										colorBuild === "none"
											? { ...current, colorBuild: undefined }
											: { ...current, colorBuild },
									),
								)}
								aria-label={"Color"}
								phoneBreakpoint={860}
								options={[
									...(CLIENT_VISUAL_REVEAL_COLOR_BUILDS.map((colorBuild) => ({
										value: colorBuild,
										label: VISUAL_REVEAL_COLOR_BUILD_LABEL[colorBuild],
									})) ?? []),
								]}
							/>
						</PropertyRow>
					</>
					<>
						<PropertyRow label="Duration">
							<Select
								size="xs"
								value={durationMode}
								onValueChange={onSelect(["auto", "manual"] as const, (mode) =>
									onChange(setRevealDurationMode(current, mode, clipDurationSec)),
								)}
								aria-label={"Duration"}
								phoneBreakpoint={860}
								options={[
									{ value: "auto", label: "Auto (" + String(clipDurationSec.toFixed(1)) + "s)" },
									{ value: "manual", label: "Manual" },
								]}
							/>
						</PropertyRow>
					</>
					<FieldRow label="Timing">
						<AmountField
							label="Delay (s)"
							short="Delay"
							suffix="s"
							min={0}
							step={0.1}
							value={current.delaySec ?? 0}
							onChange={(v) => onChange({ ...current, delaySec: Math.max(0, v) })}
						/>
						{durationMode === "manual" && (
							<AmountField
								label="Reveal time"
								short="Time"
								suffix="s"
								min={0.1}
								max={Math.max(0.1, clipDurationSec)}
								step={0.1}
								value={current.durationSec ?? clipDurationSec}
								onChange={(durationSec) =>
									onChange({
										...current,
										durationSec: clampRevealDurationSec(durationSec, clipDurationSec),
									})
								}
							/>
						)}
						<AmountField
							label="Intensity"
							short="Int"
							min={0}
							max={1}
							step={0.05}
							value={current.intensity ?? 1}
							onChange={(intensity) => onChange({ ...current, intensity })}
						/>
					</FieldRow>
				</>
			) : null}
		</AccordionSection>
	);
}
