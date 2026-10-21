import type { JSX } from "react";
import type { TextOverlay } from "@maleo/shared";
import { shapeElement, patchShapeNumber } from "@models/timeline/shape-elements.ts";
import { InspectorSection, PropertyRow } from "@design-system/patterns/inspector.tsx";
import { AlphaColorControl } from "@design-system/components/color-control.tsx";
import { NumberField } from "@design-system/components/number-field.tsx";
import { Note } from "@design-system/components/note.tsx";

export function ShapeContent({
	overlay,
	brandFill,
	disabled,
	onChange,
}: {
	overlay: TextOverlay;
	brandFill: string;
	disabled?: boolean;
	onChange: (patch: Partial<TextOverlay>) => void;
}): JSX.Element {
	const shape = shapeElement(overlay.preset),
		params = overlay.params;
	const color = (key: string, fallback: string) =>
		typeof params?.[key] === "string" ? String(params[key]) : fallback;
	const number = (key: string) => {
		const value = Number(params?.[key] ?? 0);
		return Number.isFinite(value) ? Math.max(0, value) : 0;
	};
	const change = (patch: Partial<TextOverlay>) => {
		if (!disabled) onChange(patch);
	};
	const setNumber = (key: "strokeWidth" | "radius", value: number) => {
		const next = patchShapeNumber(params, key, value);
		if (next) change({ params: next });
	};
	return (
		<InspectorSection title="Shape" defaultOpen>
			{disabled && <Note>Track locked. Unlock the track to edit this shape.</Note>}
			<fieldset disabled={disabled} className="tw:m-0 tw:min-w-0 tw:border-0 tw:p-0">
				<PropertyRow label="Shape type" as="div">
					<span>{shape?.label}</span>
				</PropertyRow>
				<PropertyRow label="Fill">
					<AlphaColorControl
						label="Shape fill"
						display="value"
						value={color("fill", brandFill)}
						fallback={brandFill}
						onChange={(fill) => change({ params: { ...params, fill } })}
					/>
				</PropertyRow>
				<PropertyRow label="Stroke">
					<AlphaColorControl
						label="Shape stroke"
						display="value"
						value={color("stroke", "transparent")}
						fallback="#00000000"
						onChange={(stroke) => change({ params: { ...params, stroke } })}
					/>
				</PropertyRow>
				<PropertyRow label="Stroke width">
					<NumberField
						aria-label="Stroke width"
						value={number("strokeWidth")}
						min={0}
						step={1}
						suffix="px"
						onValueChange={(value) => setNumber("strokeWidth", value)}
					/>
				</PropertyRow>
				{shape?.preset === "shape-rect" && (
					<PropertyRow label="Corner radius">
						<NumberField
							aria-label="Corner radius"
							value={number("radius")}
							min={0}
							step={1}
							suffix="px"
							onValueChange={(value) => setNumber("radius", value)}
						/>
					</PropertyRow>
				)}
			</fieldset>
		</InspectorSection>
	);
}
