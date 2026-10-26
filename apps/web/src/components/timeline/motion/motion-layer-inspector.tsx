/* Motion Studio's inspector for one selected layer: its header, the keyframe
 * bar while a mark is focused, and the five sections of value inputs.
 *
 * Split out of `motion-studio-modal.tsx`. The modal owns the layers and the
 * mark; this draws them and routes every edit back through `upd`. What an edit
 * writes lives in `motion-studio-edits.ts`. */
import type { JSX } from "react";
import type {
	AnimatableProp,
	ColorAnimatableProp,
	CompositionLayer,
	MotionEasing,
} from "@maleo/shared";
import { keysOf, oneOf } from "@maleo/shared";
import { findTextTemplate } from "@models/clip-templates/registry.ts";
import { TemplateFieldsEditor } from "@components/clip-templates/template-fields-editor.tsx";
import type { MotionMarkSelection } from "@models/timeline/motion-vui-adapter.ts";
import { Button } from "@design-system/components/button.tsx";
import { Select } from "@design-system/components/select.tsx";
import { Input, Textarea } from "@design-system/components/input.tsx";
import { AccordionSection } from "../inspector-section.tsx";
import type { MotionLayerSectionKey } from "./motion-layer-sections.tsx";
import { layerLabel } from "./motion-keyframes.ts";
import {
	COLOR_LABEL,
	EASINGS,
	EASING_LABEL,
	PROP_LABEL,
	PROP_STEP,
	colorEditPatch,
	displayColor,
	displayValue,
	markLabel,
	valueEditPatch,
} from "./motion-studio-edits.ts";

type SectionKey = MotionLayerSectionKey | "identity";

interface MotionLayerInspectorProps {
	selected: CompositionLayer;
	mark: MotionMarkSelection | null;
	/** The playhead as a fraction of the selected layer's span. */
	progress: number;
	compact: boolean;
	openSection: SectionKey;
	setOpenSection: (k: SectionKey) => void;
	sectionFocusKey: number;
	upd: (id: number, patch: Partial<CompositionLayer>) => void;
	removeLayer: (id: number) => void;
	setMark: (mark: MotionMarkSelection | null) => void;
	setMarkEasing: (easing: MotionEasing) => void;
	deleteMark: () => void;
}

export function MotionLayerInspector({
	selected,
	mark,
	progress,
	compact,
	openSection,
	setOpenSection,
	sectionFocusKey,
	upd,
	removeLayer,
	setMark,
	setMarkEasing,
	deleteMark,
}: MotionLayerInspectorProps): JSX.Element {
	const selTemplate = selected.preset === "plain" ? undefined : findTextTemplate(selected.preset);
	const markFocused = Boolean(mark && mark.layerId === selected.id);
	const lockUnless = (prop?: AnimatableProp): boolean =>
		markFocused && !(mark!.kind === "value" && mark!.prop === prop);
	const lockUnlessColor = (prop?: ColorAnimatableProp): boolean =>
		markFocused && !(mark!.kind === "color" && mark!.prop === prop);
	const selMarkKf = markFocused
		? mark!.kind === "value"
			? selected.anim?.tracks[mark!.prop]?.[mark!.index]
			: selected.anim?.colorTracks?.[mark!.prop]?.[mark!.index]
		: undefined;

	const valueRow = (prop: AnimatableProp): JSX.Element => {
		const focusedHere = markFocused && mark!.kind === "value" && mark!.prop === prop;
		return (
			<label key={prop} className={focusedHere ? "is-mark-focus" : undefined}>
				<span>
					{PROP_LABEL[prop]}
					{selected.anim?.tracks[prop]?.length ? " ◆" : ""}
				</span>
				<Input
					type="number"
					step={PROP_STEP[prop]}
					disabled={lockUnless(prop)}
					value={Number(displayValue(selected, prop, mark, progress).toFixed(3))}
					onChange={(e) => {
						const v = Number(e.target.value);
						if (!Number.isNaN(v))
							upd(selected.id, valueEditPatch(selected, prop, v, mark, progress));
					}}
				/>
			</label>
		);
	};

	const colorRow = (prop: ColorAnimatableProp): JSX.Element => {
		const focusedHere = markFocused && mark!.kind === "color" && mark!.prop === prop;
		return (
			<label key={prop} className={focusedHere ? "is-mark-focus" : undefined}>
				<span>
					{COLOR_LABEL[prop]}
					{selected.anim?.colorTracks?.[prop]?.length ? " ◆" : ""}
				</span>
				<Input
					type="color"
					disabled={lockUnlessColor(prop)}
					value={displayColor(selected, prop, mark, progress)}
					onChange={(e) =>
						upd(selected.id, colorEditPatch(selected, prop, e.target.value, mark, progress))
					}
				/>
			</label>
		);
	};

	return (
		<>
			<header className="tl2-scenedrawer-head tl2-studio-insp-head">
				<div className="tl2-scenedrawer-id">
					<span className="tl2-scenedrawer-kicker">Layer</span>
					<span className="tl2-studio-insp-title">{layerLabel(selected)}</span>
				</div>
				<Button type="button" size="sm" variant="ghost" onClick={() => removeLayer(selected.id)}>
					Delete layer
				</Button>
			</header>
			{markFocused && (
				<div className="tl2-studio-markbar">
					<span>
						◆ {markLabel(mark!)} keyframe @ {(selMarkKf?.t ?? 0).toFixed(2)}
					</span>
					<Select
						width="auto"
						className="tl2-anim-easing"
						value={selMarkKf?.easing ?? "linear"}
						onValueChange={(e) => {
							const easing = oneOf(e, keysOf(EASING_LABEL));
							if (easing) setMarkEasing(easing);
						}}
						phoneBreakpoint={860}
						options={[...(EASINGS.map((z) => ({ value: z, label: EASING_LABEL[z] })) ?? [])]}
					/>
					<Button type="button" size="sm" variant="ghost" onClick={deleteMark}>
						Delete key
					</Button>
					<Button type="button" size="sm" variant="ghost" onClick={() => setMark(null)}>
						Done
					</Button>
				</div>
			)}
			<AccordionSection
				label="Content"
				defaultOpen
				open={compact ? openSection === "content" : undefined}
				onOpenChange={(o) => setOpenSection(o ? "content" : "identity")}
				focusKey={openSection === "content" ? sectionFocusKey : null}
			>
				<div className={markFocused ? "tl2-studio-lockable is-locked" : "tl2-studio-lockable"}>
					{selTemplate ? (
						<TemplateFieldsEditor
							fields={selTemplate.fields}
							values={selected.params ?? selTemplate.defaultParams}
							onChange={(params) => {
								if (!markFocused) upd(selected.id, { params });
							}}
						/>
					) : (
						<Textarea
							rows={2}
							disabled={markFocused}
							value={selected.content}
							onChange={(e) => upd(selected.id, { content: e.target.value })}
							placeholder="Text…"
						/>
					)}
				</div>
			</AccordionSection>
			<AccordionSection
				label="Placement"
				defaultOpen
				open={compact ? openSection === "placement" : undefined}
				onOpenChange={(o) => setOpenSection(o ? "placement" : "identity")}
				focusKey={openSection === "placement" ? sectionFocusKey : null}
			>
				<div className="tl2-studio-grid4">
					{valueRow("x")}
					{valueRow("y")}
					{valueRow("width")}
					{valueRow("height")}
				</div>
			</AccordionSection>
			<AccordionSection
				label="Motion"
				defaultOpen
				open={compact ? openSection === "motion" : undefined}
				onOpenChange={(o) => setOpenSection(o ? "motion" : "identity")}
				focusKey={openSection === "motion" ? sectionFocusKey : null}
			>
				<div className="tl2-studio-grid4">
					{valueRow("scale")}
					{valueRow("rotate")}
					{valueRow("opacity")}
					{valueRow("blur")}
				</div>
			</AccordionSection>
			<AccordionSection
				label="Style"
				defaultOpen
				open={compact ? openSection === "style" : undefined}
				onOpenChange={(o) => setOpenSection(o ? "style" : "identity")}
				focusKey={openSection === "style" ? sectionFocusKey : null}
			>
				<div className="tl2-studio-grid4">
					{selected.preset === "plain" && colorRow("fill")}
					{colorRow("background")}
					{valueRow("bgOpacity")}
					{selected.preset === "plain" && (
						<>
							{valueRow("fontSize")}
							{valueRow("letterSpacing")}
							{valueRow("lineHeight")}
						</>
					)}
				</div>
			</AccordionSection>
			<AccordionSection
				label="Timing"
				defaultOpen
				open={compact ? openSection === "timing" : undefined}
				onOpenChange={(o) => setOpenSection(o ? "timing" : "identity")}
				focusKey={openSection === "timing" ? sectionFocusKey : null}
			>
				<div className="tl2-studio-grid4">
					<label>
						<span>Start s</span>
						<Input
							type="number"
							min={0}
							step={0.1}
							disabled={markFocused}
							value={selected.start}
							onChange={(e) =>
								upd(selected.id, { start: Math.max(0, Number(e.target.value) || 0) })
							}
						/>
					</label>
					<label>
						<span>Length s</span>
						<Input
							type="number"
							min={0.2}
							step={0.1}
							disabled={markFocused}
							value={selected.dur}
							onChange={(e) =>
								upd(selected.id, { dur: Math.max(0.2, Number(e.target.value) || 0.2) })
							}
						/>
					</label>
				</div>
			</AccordionSection>
		</>
	);
}
