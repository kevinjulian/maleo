/* The Scene Studio's top strip: a thumbnail per item, the add and generate-all
 * actions, and the Studio / Board / List / Storyboard switcher. */
import type { JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { Frame } from "@design-system/components/frame.tsx";
import { Shimmer } from "@design-system/components/shimmer.tsx";
import { Button } from "@design-system/components/button.tsx";
import { isScene, type StudioItem } from "./studio-item.ts";

export type StudioView = "studio" | "board" | "list" | "storyboard";

interface StudioStripProps {
	isVideo: boolean;
	items: StudioItem[];
	active: number | undefined;
	setActive: (id: number) => void;
	view: StudioView;
	setView: (v: StudioView) => void;
	gen: Record<number, boolean>;
	aspect: number;
	addScene: () => void;
	genAll: () => void;
}

export function StudioStrip({
	isVideo,
	items,
	active,
	setActive,
	view,
	setView,
	gen,
	aspect,
	addScene,
	genAll,
}: StudioStripProps): JSX.Element {
	const done = items.filter((s) => s.img).length;
	const stripW = Math.max(46, Math.min(150, Math.round(78 * aspect)));
	return (
		<div className="cv-strip">
			<div className="cv-strip-left">
				<div className="cv-strip-scenes">
					{items.map((s, i) => (
						<button
							key={s.id}
							data-entity-key={isScene(s) ? undefined : s.key}
							className={`cv-stripcard ${view === "studio" && active === s.id ? "on" : ""}`}
							onClick={() => {
								setActive(s.id);
								if (view !== "studio") setView("studio");
							}}
							style={{ width: stripW }}
						>
							<Frame
								generated={s.img && !gen[s.id]}
								src={s.src}
								seed={s.seed || s.id}
								aspect={aspect}
								w="100%"
								badge={i + 1}
							>
								{gen[s.id] && <Shimmer />}
							</Frame>
							<span className="cv-striplbl">
								{isScene(s) ? s.name : s.cap ? s.cap.slice(0, 16) : `Slide ${i + 1}`}
							</span>
						</button>
					))}
					{view === "studio" && (
						<button className="cv-stripadd" onClick={addScene} style={{ width: stripW }}>
							{Ic.plus(ICON.md)}
							<span>{isVideo ? "Scene" : "Slide"}</span>
						</button>
					)}
				</div>
				{isVideo && view === "studio" && (
					<Button variant="primary" size="sm" onClick={genAll} disabled={done === items.length}>
						{Ic.spark(ICON.sm)} Generate all
					</Button>
				)}
			</div>
			<div className="cv-viewseg">
				{(
					[
						["studio", "Studio"],
						["board", "Board"],
						["list", "List"],
						...(isVideo ? ([["storyboard", "Storyboard"]] as const) : []),
					] as const
				).map(([v, l]) => (
					<button key={v} className={view === v ? "on" : ""} onClick={() => setView(v)}>
						{l}
					</button>
				))}
			</div>
		</div>
	);
}
