/* The clip inspector's bodies for infographic callouts and effect clips. One
 * branch per property group, each called from TimelineClipInspector with the
 * context it derived. */
import type { JSX } from "react";
import type { EffectClip, EffectKind } from "@maleo/shared";
import type { TimelineStageView } from "./timeline-stage.tsx";
import { AccordionSection, BlendingSection, TransformSection } from "./clip-canvas.tsx";
import { InfographicFields } from "./timeline-editor-panels.tsx";
import { AlphaColorControl } from "@design-system/components/color-control.tsx";
import { Button } from "@design-system/components/button.tsx";
import { Input } from "@design-system/components/input.tsx";
import { Note } from "@design-system/components/note.tsx";
import { Select, onSelect } from "@design-system/components/select.tsx";
import { AmountField, FieldRow, PropertyRow } from "@design-system/patterns/inspector.tsx";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { EFFECT_DEFS } from "@models/timeline/editor-media.ts";
import type { ClipLayout } from "@models/timeline/clip-layout.ts";
import { patchCanvasLayout } from "@models/timeline/canvas-transform.ts";
import { clearSelection as clearSelectionIn } from "@models/timeline/selection-model.ts";
import type { ClipBodyContext } from "./clip-body-context.ts";

const INFOGRAPHIC_INS = ["fade", "slide_up", "scale"] as const;
const INFOGRAPHIC_IN_LABEL = {
	fade: "Fade (calm)",
	slide_up: "Rise (neutral)",
	scale: "Pop (high energy)",
} satisfies Record<(typeof INFOGRAPHIC_INS)[number], string>;
const EFFECT_KINDS: EffectKind[] = EFFECT_DEFS.map((d) => d.kind);

export function infographicClipBody(
	c: ClipBodyContext,
	ig: NonNullable<TimelineStageView["selectedInfographic"]>,
): JSX.Element {
	const { tab, writers, rowKeying, transform } = c;
	const { playhead } = c.view;
	const { updateInfographicPayload, removeInfographic } = c.ops;
	const { setInfographicOverlays } = writers;
	const igLayout = ig.layout ?? { xPct: 8, yPct: 16, widthPct: 84, fit: "contain" as const };
	const igPatch = (p: Partial<ClipLayout>) =>
		writers.mutate((doc) => patchCanvasLayout(doc, { source: "infographic", id: ig.id }, p));
	if (tab === "transform")
		return (
			<>
				{transform(
					<TransformSection
						layout={igLayout}
						kind="image"
						sourceEditing={false}
						keying={rowKeying}
						onChange={igPatch}
					/>,
				)}
			</>
		);
	if (tab === "blending")
		return transform(
			<BlendingSection layout={igLayout} kind="image" keying={rowKeying} onChange={igPatch} />,
		);
	if (tab === "motion")
		return (
			<>
				<AccordionSection label="Entrance" defaultOpen>
					<PropertyRow label="Animation">
						<Select
							size="xs"
							value={ig.animation?.in ?? "fade"}
							onValueChange={onSelect(INFOGRAPHIC_INS, (into) =>
								setInfographicOverlays((g) =>
									g.map((x) =>
										x.id === ig.id ? { ...x, animation: { ...x.animation, in: into } } : x,
									),
								),
							)}
							aria-label={"Animation"}
							phoneBreakpoint={860}
							options={[
								...(INFOGRAPHIC_INS.map((a) => ({
									value: a,
									label: INFOGRAPHIC_IN_LABEL[a],
								})) ?? []),
							]}
						/>
					</PropertyRow>
				</AccordionSection>
				<AccordionSection label="Reveal timing" defaultOpen>
					<Note style={{ marginTop: 0 }}>Build starts here, not at clip start.</Note>
					<span style={{ display: "flex", gap: 6 }}>
						<Input
							size="sm"
							aria-label="Reveal time (s)"
							type="number"
							min={ig.start}
							max={ig.start + ig.dur}
							step={0.1}
							value={ig.revealAt ?? ""}
							placeholder="clip start"
							onChange={(e) => {
								const v =
									e.target.value === ""
										? undefined
										: Math.max(ig.start, Math.min(ig.start + ig.dur, Number(e.target.value) || 0));
								setInfographicOverlays((g) =>
									g.map((x) => (x.id === ig.id ? { ...x, revealAt: v } : x)),
								);
							}}
						/>
						<Button
							size="sm"
							title="Set reveal to current playhead"
							onClick={() =>
								setInfographicOverlays((g) =>
									g.map((x) =>
										x.id === ig.id
											? {
													...x,
													revealAt: Math.max(ig.start, Math.min(ig.start + ig.dur, playhead.get())),
												}
											: x,
									),
								)
							}
						>
							@ playhead
						</Button>
					</span>
				</AccordionSection>
			</>
		);
	if (tab === "background")
		return (
			<AccordionSection label="Background" defaultOpen>
				<PropertyRow label="Fill" as="div">
					<AlphaColorControl
						display="value"
						label="Background"
						value={ig.style?.bgColor}
						fallback="#080a10"
						onChange={(bgColor) =>
							setInfographicOverlays((g) =>
								g.map((x) =>
									x.id === ig.id
										? {
												...x,
												style: {
													...x.style,
													bgColor,
													bgOpacity:
														bgColor === "transparent"
															? 0
															: x.style?.bgOpacity && x.style.bgOpacity > 0
																? x.style.bgOpacity
																: 0.72,
												},
											}
										: x,
								),
							)
						}
					/>
				</PropertyRow>
			</AccordionSection>
		);
	return (
		<>
			<AccordionSection label="Data" defaultOpen>
				<InfographicFields
					payload={ig.payload}
					onChange={(next) => updateInfographicPayload(ig.id, next)}
				/>
			</AccordionSection>
			<Button
				variant="secondary"
				size="sm"
				style={{ justifyContent: "center" }}
				onClick={() => {
					removeInfographic(ig.id);
				}}
			>
				{Ic.trash(ICON.sm)} Delete callout
			</Button>
		</>
	);
}

export function effectClipBody(c: ClipBodyContext, fx: EffectClip): JSX.Element {
	const { setEffects } = c.writers;
	const { removeEffect, setSelection } = c.ops;
	const upFx = (patch: Partial<EffectClip>): void =>
		setEffects((es) => es.map((x) => (x.id === fx.id ? { ...x, ...patch } : x)));
	return (
		<>
			<AccordionSection label="Type" defaultOpen>
				<PropertyRow label="Effect">
					<Select
						size="xs"
						value={fx.effect}
						onValueChange={onSelect(EFFECT_KINDS, (effect) => upFx({ effect }))}
						aria-label={"Effect"}
						phoneBreakpoint={860}
						options={[...(EFFECT_DEFS.map((d) => ({ value: d.kind, label: d.label })) ?? [])]}
					/>
				</PropertyRow>
			</AccordionSection>
			<AccordionSection label="Settings" defaultOpen>
				<FieldRow label="Duration and intensity">
					<AmountField
						label="Duration (s)"
						short="Dur"
						suffix="s"
						min={0.2}
						max={10}
						step={0.1}
						value={fx.dur}
						onChange={(v) => upFx({ dur: Math.max(0.2, v) })}
					/>
					<AmountField
						label="Intensity"
						short="Int"
						suffix="%"
						min={0}
						max={100}
						step={5}
						value={Math.round((fx.intensity ?? 1) * 100)}
						onChange={(v) => upFx({ intensity: v / 100 })}
					/>
				</FieldRow>
			</AccordionSection>
			<Button
				variant="secondary"
				size="sm"
				style={{ justifyContent: "center" }}
				onClick={() => {
					removeEffect(fx.id);
					setSelection(clearSelectionIn());
				}}
			>
				{Ic.trash(ICON.sm)} Delete effect
			</Button>
		</>
	);
}
