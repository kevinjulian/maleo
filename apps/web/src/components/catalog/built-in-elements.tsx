/* The built-in placeable elements, as catalogue tiles.
 *
 * The rail renders these same definitions as buttons that put something on a
 * timeline. Here there is no timeline and no playhead, so a tile is a record you
 * look at: it shows what the element renders as and what it is called, and it
 * does not offer an action it cannot perform. That is the whole difference
 * between the two surfaces, and it is why this is a separate component rather
 * than the rail with its handlers stubbed out — a stubbed handler is still a
 * control, and the operator finds out it does nothing by clicking it.
 *
 * Definitions come from `models/timeline/element-catalogue.ts`, the same module
 * the rail reads. The previews are the editor's own components, which already
 * default their brand to `DEFAULT_BRAND` and so render outside a project without
 * being handed a stand-in one.
 */
import { SHAPE_ELEMENTS } from "@models/timeline/shape-elements.ts";
import type { JSX, ReactNode } from "react";
import {
	BASIC_ELEMENTS,
	BUILT_IN_TEXT_PRESETS,
	MOTION_ITEMS,
	textPresetLabel,
	textPresetSample,
	textPresetSampleOr,
} from "@models/timeline/element-catalogue.ts";
import { TextPresetPreview } from "@components/timeline/timeline-editor-panels.tsx";
import { LazyPreview } from "./lazy-preview.tsx";

/** A catalogue tile: a preview, a name, and the family it belongs to. */
function ElementTile({
	preview,
	label,
	meta,
}: {
	preview: () => ReactNode;
	label: string;
	meta: string;
}): JSX.Element {
	return (
		<figure className="catalog-el-tile">
			<LazyPreview className="catalog-el-tile-preview">{preview}</LazyPreview>
			<figcaption>
				<b>{label}</b>
				<em>{meta}</em>
			</figcaption>
		</figure>
	);
}

const matches = (query: string, ...fields: string[]): boolean => {
	const q = query.trim().toLowerCase();
	return !q || fields.some((field) => field.toLowerCase().includes(q));
};

export function BuiltInBasicTiles({ query }: { query: string }): JSX.Element {
	const items = BASIC_ELEMENTS.filter((item) => matches(query, item.label, item.kind));
	return (
		<div className="catalog-el-tiles">
			{items.map((item) => (
				<ElementTile
					key={item.preset}
					label={item.label}
					meta={item.kind}
					preview={() => (
						<TextPresetPreview preset={item.preset} content={textPresetSample(item.preset)} />
					)}
				/>
			))}
		</div>
	);
}

export function BuiltInShapeTiles({ query }: { query: string }): JSX.Element {
	const items = SHAPE_ELEMENTS.filter((item) => matches(query, item.label, item.kind));
	return (
		<div className="catalog-el-tiles">
			{items.map((item) => (
				<ElementTile
					key={item.preset}
					label={item.label}
					meta={item.kind}
					preview={() => <TextPresetPreview preset={item.preset} content={item.label} />}
				/>
			))}
		</div>
	);
}

export function BuiltInTextTiles({ query }: { query: string }): JSX.Element {
	const items = BUILT_IN_TEXT_PRESETS.filter((preset) => matches(query, textPresetLabel(preset)));
	return (
		<div className="catalog-el-tiles">
			{items.map((preset) => (
				<ElementTile
					key={preset}
					label={textPresetLabel(preset)}
					meta="Text"
					preview={() => <TextPresetPreview preset={preset} content={textPresetSample(preset)} />}
				/>
			))}
		</div>
	);
}

export function BuiltInMotionTiles({ query }: { query: string }): JSX.Element {
	const items = MOTION_ITEMS.filter((item) => matches(query, item.label, item.intent));
	return (
		<div className="catalog-el-tiles">
			{items.map((item) => (
				<ElementTile
					key={`${item.preset}-${item.label}`}
					label={item.label}
					meta={item.intent}
					preview={() => (
						<TextPresetPreview
							preset={item.preset}
							content={textPresetSampleOr(item.preset, item.label)}
						/>
					)}
				/>
			))}
		</div>
	);
}

/** How many built-ins each family contributes for a query, for the group counts. */
export interface BuiltInCounts {
	basic: number;
	shapes: number;
	text: number;
	motion: number;
}

export function builtInCounts(query: string): BuiltInCounts {
	return {
		shapes: SHAPE_ELEMENTS.filter((item) => matches(query, item.label, item.kind)).length,
		basic: BASIC_ELEMENTS.filter((item) => matches(query, item.label, item.kind)).length,
		text: BUILT_IN_TEXT_PRESETS.filter((preset) => matches(query, textPresetLabel(preset))).length,
		motion: MOTION_ITEMS.filter((item) => matches(query, item.label, item.intent)).length,
	};
}
