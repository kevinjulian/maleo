/* The Templates rail's one project-level render override: the longest a
 * visual beat may run, held against the selected template's own value.
 *
 * Split out of `timeline-panel-host.tsx`; it reads the template list and the
 * project's render overrides and writes only the latter. */
import type { JSX } from "react";
import { DEFAULT_TIMELINE_TEMPLATE, type TimelineTemplate } from "@maleo/shared";
import { clearRenderOverride, writeRenderOverride } from "@models/presets/element-writes.ts";
import type { CreativeSettings } from "@hooks/editor/use-creative-settings.ts";
import { PropertyRow } from "@design-system/patterns/inspector.tsx";
import { Input } from "@design-system/components/input.tsx";

interface TemplateRenderOverrideProps {
	templates: TimelineTemplate[];
	selectedTemplateId: string | undefined;
	renderOverrides: CreativeSettings["renderOverrides"];
	setRenderOverrides: CreativeSettings["setRenderOverrides"];
}

export function TemplateRenderOverride({
	templates,
	selectedTemplateId,
	renderOverrides,
	setRenderOverrides,
}: TemplateRenderOverrideProps): JSX.Element {
	const selectedTemplate =
		templates.find((template) => template.id === selectedTemplateId) ?? DEFAULT_TIMELINE_TEMPLATE;

	const templateValue =
		selectedTemplate.maxVisualBeatSec ?? DEFAULT_TIMELINE_TEMPLATE.maxVisualBeatSec;
	const projectValue =
		typeof renderOverrides.maxVisualBeatSec === "number"
			? renderOverrides.maxVisualBeatSec
			: templateValue;
	const overridden = "maxVisualBeatSec" in renderOverrides;
	return (
		<>
			<p className="fc-cap-desc">Default: {selectedTemplate.name}</p>
			<PropertyRow label="Max visual beat">
				<Input
					size="xs"
					aria-label="Max visual beat"
					type="number"
					min={2}
					max={15}
					step={0.5}
					value={projectValue}
					onChange={(event) => {
						const value = Math.max(2, Math.min(15, Number(event.target.value) || templateValue));
						setRenderOverrides(
							(overrides) => writeRenderOverride("maxVisualBeatSec", value, overrides).overrides,
						);
					}}
				/>
			</PropertyRow>
			<small className="fc-cap-desc">
				Template stays at {templateValue.toFixed(1)}s until you edit it below.
			</small>
			{overridden && (
				<button
					type="button"
					className="cv-ghostbtn sm"
					onClick={() =>
						setRenderOverrides(
							(overrides) => clearRenderOverride("maxVisualBeatSec", overrides).overrides,
						)
					}
				>
					Revert to template
				</button>
			)}
		</>
	);
}
