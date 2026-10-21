/* Maleo — Content-First Create · clip-first Stock Media panel.
 *
 * Browses external stock across Images / Videos (Pexels), Music and SFX.
 *
 * A result is dragged straight onto the timeline. Placing it is what admits it
 * to the project — there is no save step to remember, because the drop path
 * admits the asset and records its identity on the clip it creates. The `+`
 * button remains for admitting without placing. */
import { useEffect, useState } from "react";
import type { DragEvent, JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { PanelHeader } from "@design-system/patterns/panel-header.tsx";
import { SearchField } from "@design-system/components/search-field.tsx";
import { fmtMMSS } from "@models/core/measures.ts";
import type { MediaAsset } from "@models/timeline/editor-media.ts";
import { get } from "@api/client.ts";
import { Button } from "@design-system/components/button.tsx";
import { FrameAction, FrameActions, FrameBadge } from "@design-system/components/frame.tsx";
import { AudioPreview } from "@design-system/components/audio-preview.tsx";
import { writeMediaDragPayload } from "@models/timeline/media-drag.ts";
import { MediaHoverPreview, type HoverTarget } from "./media-hover-preview.tsx";
import { MediaCard, MediaGrid } from "@design-system/patterns/media.tsx";

type StockTab = "images" | "videos" | "music" | "sfx";
export interface StockItem {
	id: string;
	thumb: string;
	url: string;
	kind: "image" | "video" | "audio";
	author?: string;
	dur?: number;
	title?: string;
	bpm?: number;
	tags?: string[];
	provider?: string;
	pageUrl?: string;
	authorUrl?: string;
	license?: string;
	licenseUrl?: string;
}
export interface StockResponse {
	configured: boolean;
	items: StockItem[];
	note?: string;
	error?: string;
}

export function StockAttribution({ item }: { item: StockItem }): JSX.Element {
	return (
		<span className="fc-stock-attribution">
			{item.pageUrl ? (
				<a href={item.pageUrl} target="_blank" rel="noreferrer">
					{item.provider ?? "Source"}
				</a>
			) : (
				item.provider
			)}
			{item.author && (
				<>
					{" "}
					·{" "}
					{item.authorUrl ? (
						<a href={item.authorUrl} target="_blank" rel="noreferrer">
							{item.author}
						</a>
					) : (
						item.author
					)}
				</>
			)}
			{item.license && (
				<>
					{" "}
					·{" "}
					{item.licenseUrl ? (
						<a href={item.licenseUrl} target="_blank" rel="noreferrer">
							{item.license}
						</a>
					) : (
						item.license
					)}
				</>
			)}
		</span>
	);
}

export function StockAudioResults({
	items,
	isSelected,
	onSelect,
	onDragStart,
	actionLabel = "Select",
	selectedLabel = "Selected",
}: {
	items: StockItem[];
	isSelected?: (item: StockItem) => boolean;
	onSelect: (item: StockItem) => void;
	/** Present only where there is a timeline to drop onto. The template pickers
	 *  reuse these rows to choose a cue and have nowhere to place one. */
	onDragStart?: (e: DragEvent<HTMLElement>, item: StockItem) => void;
	actionLabel?: string;
	selectedLabel?: string;
}): JSX.Element {
	return (
		<div className="fc-musiclist">
			{items.map((item) => {
				const selected = isSelected?.(item) ?? false;
				return (
					<div key={item.id} className={`fc-music ${selected ? "selected" : ""}`}>
						{/* The header is the drag handle, not the whole row: the scrub bar is a
				    range input, and a draggable ancestor would swallow the drag that
				    seeks it. */}
						<div
							className={`fc-music-head ${onDragStart ? "draggable" : ""}`.trim()}
							draggable={Boolean(onDragStart && item.url)}
							title={onDragStart ? "Drag onto the timeline" : undefined}
							onDragStart={onDragStart ? (e) => onDragStart(e, item) : undefined}
						>
							<div className="fc-music-id">
								<b>{item.title ?? "Sound"}</b>
								<span>{item.author ?? ""}</span>
							</div>
							<button
								type="button"
								className={`fc-music-add ${selected ? "saved" : ""}`}
								disabled={selected}
								onClick={() => onSelect(item)}
							>
								{selected ? (
									<>
										{Ic.check(ICON.xs)} {selectedLabel}
									</>
								) : (
									<>
										{Ic.plus(ICON.xs)} {actionLabel}
									</>
								)}
							</button>
						</div>
						<div className="fc-music-meta">
							{item.dur != null && <span>{fmtMMSS(Math.round(item.dur))}</span>}
							{(item.tags ?? []).map((tag) => (
								<span key={tag} className="fc-music-tag">
									{tag}
								</span>
							))}
						</div>
						<StockAttribution item={item} />
						<AudioPreview
							className="fc-music-audio"
							src={item.url}
							durationSec={item.dur}
							label={item.title ?? "sound"}
						/>
					</div>
				);
			})}
		</div>
	);
}

interface StockPanelProps {
	savedUrls: Set<string>;
	onAddToMedia: (asset: MediaAsset) => void;
	onClose: () => void;
	embedded?: boolean;
}

export function StockPanel({
	savedUrls,
	onAddToMedia,
	onClose,
	embedded = false,
}: StockPanelProps): JSX.Element {
	const [tab, setTab] = useState<StockTab>("images");
	const [query, setQuery] = useState("");
	const [submitted, setSubmitted] = useState("");
	const [data, setData] = useState<StockResponse | null>(null);
	const [loading, setLoading] = useState(false);
	// Which result the cursor is resting on. Stock cells are square thumbnails of
	// media that mostly is not, so the preview is the only place an operator sees
	// what they are about to place.
	const [hover, setHover] = useState<HoverTarget | null>(null);

	useEffect(() => {
		let alive = true;
		setLoading(true);
		setData(null);
		const qs = `type=${tab}${submitted ? `&q=${encodeURIComponent(submitted)}` : ""}`;
		void get<StockResponse>(`/api/stock/search?${qs}`)
			.then((res) => {
				if (alive) setData(res);
			})
			.catch(() => {
				if (alive) setData({ configured: true, items: [], error: "search failed" });
			})
			.finally(() => {
				if (alive) setLoading(false);
			});
		return () => {
			alive = false;
		};
	}, [tab, submitted]);

	const tabs: Array<[StockTab, string, JSX.Element]> = [
		["images", "Images", Ic.image(ICON.sm)],
		["videos", "Videos", Ic.film(ICON.sm)],
		["music", "Music", Ic.mic(ICON.sm)],
		["sfx", "SFX", Ic.spark(ICON.sm)],
	];
	const isAudioTab = tab === "music" || tab === "sfx";

	// One description of a result, used by both the `+` button and the drag, so
	// admitting it either way produces the same asset.
	const asAsset = (it: StockItem): MediaAsset => ({
		id: `stock-${it.id}`,
		label: it.title ?? (it.author ? `Pexels · ${it.author}` : "Stock"),
		url: it.url,
		kind: it.kind,
		audioKind: it.kind === "audio" ? (tab === "sfx" ? "sfx" : "music") : undefined,
		thumb: it.thumb || undefined,
		dur: it.dur,
		source: "stock",
	});
	const add = (it: StockItem): void => onAddToMedia(asAsset(it));
	const startDrag = (e: DragEvent<HTMLElement>, it: StockItem): void => {
		if (!it.url) return;
		const asset = asAsset(it);
		// No `mediaAssetId`: this asset is not admitted yet, and naming one here
		// would let the drop record an identity the project does not hold.
		writeMediaDragPayload(
			e.dataTransfer,
			{
				url: asset.url,
				kind: asset.kind,
				label: asset.label,
				source: "stock",
				thumb: asset.thumb,
				dur: asset.dur,
				audioKind: asset.audioKind,
			},
			e.currentTarget,
		);
	};

	const empty = (icon: JSX.Element, text: JSX.Element | string): JSX.Element => (
		<div className="tl2-empty">
			{icon}
			<span>{text}</span>
		</div>
	);

	return (
		<>
			{!embedded && (
				<PanelHeader density="tool" title="Stock Media" onClose={onClose} closeLabel="Hide panel" />
			)}
			{/* The rect the preview is anchored to goes stale the moment the results
			    move, so scrolling dismisses rather than repositions. */}
			<div className="tl2-panel-body fc-stock" onScroll={() => setHover(null)}>
				<div className="fc-stock-tabs">
					{tabs.map(([key, label, icon]) => (
						<button
							key={key}
							className={`fc-stock-tab ${tab === key ? "on" : ""}`}
							onClick={() => setTab(key)}
						>
							{icon} {label}
						</button>
					))}
				</div>

				<form
					className="tw:flex tw:items-center tw:gap-2"
					onSubmit={(e) => {
						e.preventDefault();
						setSubmitted(query.trim());
					}}
				>
					<SearchField
						size="sm"
						label={`Search ${tab}`}
						placeholder={`Search ${tab}…`}
						value={query}
						onValueChange={setQuery}
					/>
					<Button variant="primary" size="sm" type="submit">
						Search
					</Button>
				</form>

				{loading ? (
					empty(<span className="cv-spin" />, "Searching…")
				) : !data?.configured ? (
					empty(Ic.box(ICON.xl), data?.note ?? `Configure ${tab} in Settings to enable search.`)
				) : data.note ? (
					empty(Ic.mic(ICON.xl), data.note)
				) : data.items.length === 0 ? (
					empty(
						Ic.search(ICON.xl),
						data.error ? `Search error: ${data.error}` : "No results — try another search.",
					)
				) : isAudioTab ? (
					<StockAudioResults
						items={data.items}
						isSelected={(item) => savedUrls.has(item.url)}
						onSelect={add}
						onDragStart={startDrag}
						actionLabel="Add without placing"
						selectedLabel="Added"
					/>
				) : (
					<MediaGrid label="Stock results" min={72} density="compact" className="fc-mediagrid">
						{data.items.map((it) => {
							const saved = savedUrls.has(it.url);
							return (
								<MediaCard
									key={it.id}
									hint={`${it.author ?? "stock"} · drag onto the timeline`}
									draggable={Boolean(it.url)}
									onDragStart={(e) => {
										setHover(null);
										startDrag(e, it);
									}}
									onMouseEnter={(e) => {
										if (!it.url) return;
										const panel = e.currentTarget.closest(".tl2-panel-body");
										const host = (panel ?? e.currentTarget).getBoundingClientRect();
										setHover({
											url: it.url,
											thumb: it.thumb || undefined,
											kind: it.kind,
											label: it.title ?? (it.author ? `Pexels · ${it.author}` : "Stock"),
											rect: e.currentTarget.getBoundingClientRect(),
											host: { left: host.left, right: host.right },
										});
									}}
									onMouseLeave={() => setHover(null)}
									preview={
										it.kind === "video" && it.url ? (
											// A poster only; the hover preview is what plays. Two decoders on
											// one file for one cursor position is waste a 72px cell cannot show,
											// and `preload="none"` here keeps a grid of results cheap.
											<video muted playsInline preload="none" poster={it.thumb} src={it.url} />
										) : (
											<img src={it.thumb} alt={it.author ?? "stock"} loading="lazy" />
										)
									}
									overlay={
										it.kind === "video" && it.dur != null ? (
											<FrameBadge corner="tr">{fmtMMSS(Math.round(it.dur))}</FrameBadge>
										) : null
									}
									actions={
										<>
											<StockAttribution item={it} />
											<FrameActions corner="tl" reveal={!saved}>
												<FrameAction
													disabled={saved || !it.url}
													title={saved ? "Already in this project" : "Add without placing"}
													onClick={() => add(it)}
												>
													{saved ? Ic.check(ICON.xs) : Ic.plus(ICON.sm)}
												</FrameAction>
											</FrameActions>
										</>
									}
								/>
							);
						})}
					</MediaGrid>
				)}
				<p className="fc-stock-credit">
					{tab === "music"
						? "Music from Maleo's curated library."
						: tab === "sfx"
							? "Sound effects provided by Freesound."
							: "Stock provided by Pexels."}
				</p>
			</div>

			<MediaHoverPreview target={hover} />
		</>
	);
}

export default StockPanel;
