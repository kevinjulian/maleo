/* The Scene Studio's overview layouts: a board of cards and a dense list. Both
 * open an item back in the Studio view on click. */
import type { JSX } from "react";
import type { RefImage, RefsState } from "@maleo/shared";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { Frame, FrameBadge } from "@design-system/components/frame.tsx";
import { Shimmer } from "@design-system/components/shimmer.tsx";
import { fmtMMSS } from "@models/core/measures.ts";
import { isScene, labelOf, type StudioItem } from "./studio-item.ts";

interface SceneViewProps {
	isVideo: boolean;
	items: StudioItem[];
	aspect: number;
	gen: Record<number, boolean>;
	refs: RefsState;
	pool: RefImage[];
	setActive: (id: number) => void;
	setView: (v: "studio" | "board" | "list") => void;
	refCountFor: (item: StudioItem) => number;
}

export function SceneBoard({
	isVideo,
	items,
	aspect,
	gen,
	setActive,
	setView,
	refCountFor,
}: SceneViewProps): JSX.Element {
	const bw = Math.max(92, Math.min(260, Math.round(166 * aspect)));
	return (
		<div className="cv-board">
			{items.map((s, i) => {
				const isGen = gen[s.id];
				const eff = refCountFor(s);
				return (
					<div
						key={s.id}
						className="cv-boardcard"
						role="button"
						tabIndex={0}
						onClick={() => {
							setActive(s.id);
							setView("studio");
						}}
						onKeyDown={(e) => {
							if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
							e.preventDefault();
							setActive(s.id);
							setView("studio");
						}}
						title="Open in Studio"
					>
						<div className="cv-boardframe">
							<div style={{ width: bw, maxWidth: "100%", position: "relative" }}>
								<Frame
									generated={s.img && !isGen}
									src={s.src}
									seed={s.seed || s.id}
									aspect={aspect}
									icon={isVideo ? Ic.film(ICON.lg) : Ic.image(ICON.lg)}
									label="frame"
									badge={i + 1}
								>
									{isGen && <Shimmer />}
									{isScene(s) && <FrameBadge corner="br">{fmtMMSS(s.dur)}</FrameBadge>}
								</Frame>
							</div>
						</div>
						<div className="cv-boardbody">
							<div className="cv-boardname-ro">{labelOf(s, i)}</div>
							{isScene(s) && (
								<div className="cv-boardmeta">
									{s.beat ? `${s.beat} · ` : ""}
									{s.shot} · {s.move}
								</div>
							)}
							<div className="cv-boardvo">{isScene(s) && s.vo ? `“${s.vo}”` : s.vis}</div>
							<div className="cv-boardrefs">
								{Ic.layers(ICON.xs)} {eff} ref
							</div>
						</div>
					</div>
				);
			})}
		</div>
	);
}

export function SceneList({
	isVideo,
	items,
	aspect,
	gen,
	setActive,
	setView,
	refCountFor,
}: SceneViewProps): JSX.Element {
	return (
		<div className="cv-list">
			<div className="cv-listrow cv-listhead">
				<span className="cv-lc-num">#</span>
				<span className="cv-lc-frame"></span>
				<span className="cv-lc-name">{isVideo ? "Scene" : "Slide"}</span>
				{isVideo && <span className="cv-lc-shot">Shot</span>}
				{isVideo && <span className="cv-lc-dur">Dur</span>}
				<span className="cv-lc-ref">Ref</span>
				<span className="cv-lc-tools"></span>
			</div>
			{items.map((s, i) => {
				const isGen = gen[s.id];
				const eff = refCountFor(s);
				return (
					<div
						key={s.id}
						className="cv-listrow"
						role="button"
						tabIndex={0}
						onClick={() => {
							setActive(s.id);
							setView("studio");
						}}
						onKeyDown={(e) => {
							if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
							e.preventDefault();
							setActive(s.id);
							setView("studio");
						}}
						title="Open in Studio"
					>
						<span className="cv-lc-num">{i + 1}</span>
						<span className="cv-lc-frame">
							<Frame
								generated={s.img && !isGen}
								src={s.src}
								seed={s.seed || s.id}
								aspect={aspect}
								w={isVideo ? 26 : 38}
							>
								{isGen && <Shimmer />}
							</Frame>
						</span>
						<span className="cv-lc-name">
							<b>{labelOf(s, i)}</b>
							<span className="cv-listsub">{isScene(s) ? s.vo || s.vis : s.vis}</span>
						</span>
						{isScene(s) && <span className="cv-lc-shot">{s.shot}</span>}
						{isScene(s) && <span className="cv-lc-dur mono">{fmtMMSS(s.dur)}</span>}
						<span className="cv-lc-ref">{eff}</span>
						<span className="cv-lc-tools">
							<span className="cv-lc-open">{Ic.chevR(ICON.sm)}</span>
						</span>
					</div>
				);
			})}
		</div>
	);
}
