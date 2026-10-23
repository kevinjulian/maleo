/* The clip inspector's body for effect clips, called from TimelineClipInspector
 * with the context it derived. */
import type { JSX } from "react";
import type { EffectClip, EffectKind } from "@maleo/shared";
import { AccordionSection } from "./clip-canvas.tsx";
import { Button } from "@design-system/components/button.tsx";
import { Select, onSelect } from "@design-system/components/select.tsx";
import { AmountField, FieldRow, PropertyRow } from "@design-system/patterns/inspector.tsx";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { EFFECT_DEFS } from "@models/timeline/editor-media.ts";
import { clearSelection as clearSelectionIn } from "@models/timeline/selection-model.ts";
import type { ClipBodyContext } from "./clip-body-context.ts";

const EFFECT_KINDS: EffectKind[] = EFFECT_DEFS.map((d) => d.kind);

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
