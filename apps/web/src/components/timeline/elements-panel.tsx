/* Elements tools: compact, renderer-backed tiles sharing one catalogue with Library. */
import { useState } from "react";
import type { DragEvent, JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { PanelHeader } from "@design-system/patterns/panel-header.tsx";
import { MediaCard, MediaGrid } from "@design-system/patterns/media.tsx";
import { SearchField } from "@design-system/components/search-field.tsx";
import { TabsList, TabsPanel, TabsRoot, TabsTab } from "@design-system/components/tabs.tsx";
import { CLIP_TEMPLATE_DND_MIME } from "@models/timeline/editor-media.ts";
import type { TextPreset, TemplateParams, ClipTemplateKind } from "@maleo/shared";
import type { CompositionConfig } from "@models/clip-templates/composition-config.ts";
import { CustomTemplatesBlock } from "@components/clip-templates/custom-clip-templates.tsx";
import { TextPresetPreview } from "./timeline-editor-panels.tsx";
import {
	BUILT_IN_TEXT_PRESETS,
	textPresetLabel,
	textPresetSample,
} from "@models/timeline/element-catalogue.ts";
import type { BrandPalette } from "@models/timeline/panel-brand.ts";

import { SHAPE_ELEMENTS } from "@models/timeline/shape-elements.ts";

const MOTION_KINDS: ClipTemplateKind[] = ["text", "composition"];

type ElementFilter = "all" | "shapes" | "text" | "motion";
const FILTER_TABS = [
	{ id: "all", label: "All" },
	{ id: "text", label: "Text" },
	{ id: "shapes", label: "Shapes" },
	{ id: "motion", label: "Motion" },
] as const;

export interface ElementsPanelProps {
	brand?: BrandPalette;
	aspect: number;
	onAddText: (preset?: TextPreset) => void;
	onPlaceCustomText: (preset: TextPreset, defaultParams?: TemplateParams) => void;
	onPlaceComposition: (config: CompositionConfig, label?: string) => void;
	onClose: () => void;
}

export function ElementsPanel({
	brand,
	aspect,
	onAddText,
	onPlaceCustomText,
	onPlaceComposition,
	onClose,
}: ElementsPanelProps): JSX.Element {
	const [filter, setFilter] = useState<ElementFilter>("all"),
		[query, setQuery] = useState("");
	const q = query.trim().toLowerCase();
	const matches = (...fields: string[]) =>
		!q || fields.some((field) => field.toLowerCase().includes(q));
	const shapes = SHAPE_ELEMENTS.filter((item) => matches(item.label, item.kind));
	const texts = BUILT_IN_TEXT_PRESETS.filter((preset) => matches(textPresetLabel(preset)));
	const dragText = (event: DragEvent<HTMLElement>, preset: TextPreset) => {
		event.dataTransfer.setData(CLIP_TEMPLATE_DND_MIME, JSON.stringify({ kind: "text", preset }));
		event.dataTransfer.effectAllowed = "copy";
		event.dataTransfer.setDragImage(event.currentTarget, 12, 12);
	};
	const textTile = (preset: TextPreset, label: string, sample: string, add: () => void) => (
		<MediaCard
			key={preset}
			variant="picker"
			title={label}
			label={`Add ${label}`}
			ground={preset === "plain" ? undefined : "var(--media-bg)"}
			preview={
				preset === "plain" ? (
					Ic.type(ICON.display)
				) : (
					<TextPresetPreview preset={preset} content={sample} brand={brand} compact />
				)
			}
			hint={`Add ${label}, or drag to the timeline`}
			onActivate={add}
			draggable
			onDragStart={(event) => dragText(event, preset)}
		/>
	);
	const variants = (group: "text" | "shapes") => (
		<CustomTemplatesBlock
			group={group}
			kind="text"
			kinds={MOTION_KINDS}
			brand={brand}
			query={q}
			onPlace={(item) => onPlaceCustomText(item.preset, item.defaultParams)}
		/>
	);
	const groups = (category: ElementFilter) => {
		const shows = (kind: ElementFilter) => category === "all" || category === kind;
		return (
			<>
				{shows("text") && (
					<section className="tl2-elgroup">
						<div className="tl2-elgroup-h">
							<span>Text</span>
						</div>
						<MediaGrid label="Text presets" min={72} density="compact">
							{texts.map((preset) =>
								textTile(preset, textPresetLabel(preset), textPresetSample(preset), () =>
									onAddText(preset),
								),
							)}
						</MediaGrid>
						{!texts.length && <p className="tl2-elgroup-empty">No text matches “{query}”.</p>}
						{variants("text")}
					</section>
				)}
				{shows("shapes") && (
					<section className="tl2-elgroup" aria-label="Shape elements">
						<div className="tl2-elgroup-h">
							<span>Shapes</span>
						</div>
						<MediaGrid label="Shape elements" min={72} density="compact">
							{shapes.map((item) =>
								textTile(item.preset, item.label, textPresetSample(item.preset), () =>
									onAddText(item.preset),
								),
							)}
						</MediaGrid>
						{!shapes.length && <p className="tl2-elgroup-empty">No shapes match “{query}”.</p>}
						{variants("shapes")}
					</section>
				)}
				{shows("motion") && (
					<section className="tl2-elgroup" aria-label="Motion elements">
						<CustomTemplatesBlock
							heading="Motion"
							group="motion"
							kind="text"
							kinds={MOTION_KINDS}
							brand={brand}
							query={q}
							studio={{ aspect, brand }}
							onPlace={(item) => {
								if (item.kind === "text") onPlaceCustomText(item.preset, item.defaultParams);
							}}
							onPlaceComposition={onPlaceComposition}
						></CustomTemplatesBlock>
					</section>
				)}
			</>
		);
	};
	return (
		<>
			<PanelHeader density="tool" title="Elements" onClose={onClose} closeLabel="Hide panel" />
			<TabsRoot
				className="tl2-panel-body tl2-elements-body"
				value={filter}
				onValueChange={(value) => {
					const tab = FILTER_TABS.find((item) => item.id === value);
					if (tab) setFilter(tab.id);
				}}
			>
				<div className="tl2-elements-toolbar">
					<SearchField
						size="sm"
						label="Search elements"
						placeholder="Search elements…"
						value={query}
						onValueChange={setQuery}
					/>
					<TabsList variant="bar" aria-label="Element category">
						{FILTER_TABS.map((tab) => (
							<TabsTab key={tab.id} value={tab.id}>
								{tab.label}
							</TabsTab>
						))}
					</TabsList>
				</div>
				{FILTER_TABS.map((tab) => (
					<TabsPanel key={tab.id} value={tab.id}>
						{groups(tab.id)}
					</TabsPanel>
				))}
			</TabsRoot>
		</>
	);
}
