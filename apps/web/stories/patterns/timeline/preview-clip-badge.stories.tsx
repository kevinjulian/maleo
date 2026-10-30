import type { Meta, StoryObj } from "@storybook/react-vite";
import {
	ClipPreviewBadge,
	previewLoadingLabel,
	type ClipReadiness,
} from "@components/timeline/media/preview-loading.tsx";
import "@components/timeline/tracks.css";
import "@components/timeline/tracks-clips.css";

const states: ClipReadiness["state"][] = [
	{ state: "queued" },
	{ state: "loading", loaded: 40, total: 100 },
	{ state: "loading", loaded: 40, total: null },
	{ state: "validating" },
	{ state: "ready" },
	{ state: "failed", message: "Unsupported video track" },
];

function Clips() {
	return (
		<div className="tw:flex tw:flex-col tw:gap-3 tw:bg-background tw:p-4">
			{[160, 44].map((width) => (
				<div key={width} className="tw:flex tw:flex-wrap tw:gap-3">
					{states.map((state, index) => {
						const clip: ClipReadiness = {
							id: String(index),
							state,
							loaded: state.state === "loading" ? state.loaded : 0,
							total: state.state === "loading" ? state.total : null,
							blockers: [],
						};
						return (
							<div key={index} className="tw:flex tw:flex-col tw:gap-1">
								<div
									className={`tw:relative tw:h-10 tw:overflow-hidden tw:rounded-[var(--r-2)] tw:bg-[var(--surface-strong)] tl2-clip ${width < 60 ? "narrow" : ""}`}
									style={{ width }}
								>
									<ClipPreviewBadge clip={clip} />
								</div>
								<span className="tw:text-xs">{previewLoadingLabel(clip)}</span>
							</div>
						);
					})}
				</div>
			))}
		</div>
	);
}

const meta = { title: "Patterns/Timeline/Preview clip badge", component: Clips } satisfies Meta<
	typeof Clips
>;
export default meta;
export const States: StoryObj<typeof meta> = {};
