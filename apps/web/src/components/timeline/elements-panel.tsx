/* Elements tools: compact, renderer-backed tiles sharing one catalogue with Library. */
import { useState } from "react";
import type { DragEvent, JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { PanelHeader } from "@design-system/patterns/panel-header.tsx";
import { MediaCard, MediaGrid } from "@design-system/patterns/media.tsx";
import { SearchField } from "@design-system/components/search-field.tsx";
import { TabsList, TabsPanel, TabsRoot, TabsTab } from "@design-system/components/tabs.tsx";
import { CLIP_TEMPLATE_DND_MIME, DATA_CALLOUT_DND_MIME } from "@models/timeline/editor-media.ts";
import { defaultInfographicPayload } from "@models/presets/generation-defaults.ts";
import type {
	InfographicPayload,
	TextPreset,
	TemplateParams,
	ClipTemplateKind,
} from "@maleo/shared";
import type { CompositionConfig } from "@models/clip-templates/composition-config.ts";
import { CustomTemplatesBlock } from "@components/clip-templates/custom-clip-templates.tsx";
import { TextPresetPreview } from "./timeline-editor-panels.tsx";
import { InfographicTypePreview } from "@components/timeline/infographics/infographics-panel.tsx";
import {
	BASIC_ELEMENTS,
	BUILT_IN_TEXT_PRESETS,
	INFOGRAPHIC_KINDS,
	MOTION_ITEMS,
	textPresetLabel,
	textPresetSample,
	textPresetSampleOr,
} from "@models/timeline/element-catalogue.ts";
import type { BrandPalette } from "@models/timeline/panel-brand.ts";

import { SHAPE_ELEMENTS } from "@models/timeline/shape-elements.ts";

const MOTION_KINDS: ClipTemplateKind[] = ["text", "composition"];

type ElementFilter = "all" | "basic" | "shapes" | "text" | "motion" | "data";
const FILTER_TABS = [
	{ id: "all", label: "All" },
	{ id: "basic", label: "Basic" },
	{ id: "shapes", label: "Shapes" },
	{ id: "text", label: "Text" },
	{ id: "motion", label: "Motion" },
	{ id: "data", label: "Data" },
] as const;

export interface ElementsPanelProps {
	brand?: BrandPalette;
	aspect: number;
	onAddText: (preset?: TextPreset) => void;
	onPlaceCustomText: (preset: TextPreset, defaultParams?: TemplateParams) => void;
	onPlaceComposition: (config: CompositionConfig, label?: string) => void;
	onAddData: (type: InfographicPayload["type"]) => void;
	onPlaceCustomData: (payload: InfographicPayload) => void;
	onClose: () => void;
}

export function ElementsPanel({
	brand,
	aspect,
	onAddText,
	onPlaceCustomText,
	onPlaceComposition,
	onAddData,
	onPlaceCustomData,
	onClose,
}: ElementsPanelProps): JSX.Element {
	const [filter, setFilter] = useState<ElementFilter>("all"),
		[query, setQuery] = useState("");
	const q = query.trim().toLowerCase();
	const matches = (...fields: string[]) =>
		!q || fields.some((field) => field.toLowerCase().includes(q));
	const basics = BASIC_ELEMENTS.filter((item) => matches(item.label, item.kind));
	const shapes = SHAPE_ELEMENTS.filter((item) => matches(item.label, item.kind));
	const texts = BUILT_IN_TEXT_PRESETS.filter((preset) => matches(textPresetLabel(preset)));
	const motions = MOTION_ITEMS.filter((item) => matches(item.label, item.intent));
	const data = INFOGRAPHIC_KINDS.filter((item) => matches(item.label));
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
	const groups = (category: ElementFilter) => {
		const shows = (kind: ElementFilter) => category === "all" || category === kind;
		return (
			<>
				{shows("basic") && (
					<section className="tl2-elgroup" aria-label="Basic elements">
						<div className="tl2-elgroup-h">
							<span>Basic</span>
						</div>
						<MediaGrid label="Basic elements" min={72} density="compact">
							{basics.map((item) =>
								textTile(item.preset, item.label, textPresetSample(item.preset), () =>
									onAddText(item.preset),
								),
							)}
						</MediaGrid>
						{!basics.length && (
							<p className="tl2-elgroup-empty">No basic elements match “{query}”.</p>
						)}
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
					</section>
				)}
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
					</section>
				)}
				{shows("motion") && (
					<section className="tl2-elgroup" aria-label="Motion elements">
						<CustomTemplatesBlock
							heading="Motion"
							kind="text"
							kinds={MOTION_KINDS}
							brand={brand}
							query={q}
							studio={{ aspect, brand }}
							onPlace={(item) => {
								if (item.kind === "text") onPlaceCustomText(item.preset, item.defaultParams);
							}}
							onPlaceComposition={onPlaceComposition}
						>
							<MediaGrid label="Motion elements" min={72} density="compact">
								{motions.map((item) =>
									textTile(
										item.preset,
										item.label,
										textPresetSampleOr(item.preset, item.label),
										() => onAddText(item.preset),
									),
								)}
							</MediaGrid>
						</CustomTemplatesBlock>
					</section>
				)}
				{shows("data") && (
					<section className="tl2-elgroup" aria-label="Data elements">
						<CustomTemplatesBlock
							heading="Data"
							kind="data"
							brand={brand}
							query={q}
							onPlace={(item) => {
								if (item.kind === "data" && item.payload) onPlaceCustomData(item.payload);
							}}
						>
							<MediaGrid label="Data elements" min={72} density="compact">
								{data.map((item) => (
									<MediaCard
										key={item.type}
										variant="picker"
										title={item.label}
										label={`Add ${item.label} data callout`}
										ground="var(--media-bg)"
										preview={
											<InfographicTypePreview
												payload={defaultInfographicPayload(item.type)}
												brand={brand}
												compact
											/>
										}
										hint={`Add ${item.label}, or drag to the timeline`}
										onActivate={() => onAddData(item.type)}
										draggable
										onDragStart={(event) => {
											event.dataTransfer.setData(
												DATA_CALLOUT_DND_MIME,
												JSON.stringify(defaultInfographicPayload(item.type)),
											);
											event.dataTransfer.effectAllowed = "copy";
											event.dataTransfer.setDragImage(event.currentTarget, 12, 12);
										}}
									/>
								))}
							</MediaGrid>
						</CustomTemplatesBlock>
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
