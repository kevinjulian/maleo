import type { Meta, StoryObj } from "@storybook/react-vite";
import { ClipUploadBadge } from "@components/timeline/media/pending-upload.tsx";
import type { PendingUploadState } from "@models/core/pending-media-sources.ts";
import "@components/timeline/tracks.css";

/* The compact badge every clip of a pending asset carries
 * (docs/design-system/patterns/timeline-clip.md#pending-media-badge), on a clip-sized
 * box at normal and narrow widths. */
const states: PendingUploadState[] = [
	{ phase: "uploading", progress: 0.4 },
	{ phase: "processing" },
	{ phase: "failed", reason: "Upload service unavailable", canRetry: true },
	{ phase: "interrupted" },
];

function Clips() {
	return (
		<div className="tw:flex tw:flex-col tw:gap-3 tw:bg-background tw:p-4">
			{[160, 44].map((width) => (
				<div key={width} className="tw:flex tw:flex-wrap tw:gap-3">
					{states.map((state) => (
						<div
							key={state.phase}
							className={`tw:relative tw:h-10 tw:overflow-hidden tw:rounded-[var(--r-2)] tw:bg-[var(--surface-strong)] ${width < 60 ? "tl2-clip-compact" : ""}`}
							style={{ width }}
						>
							<span className="tw:px-2 tw:text-[length:var(--type-label-size)] tw:text-[var(--muted)]">
								beach.mov
							</span>
							<ClipUploadBadge state={state} />
						</div>
					))}
				</div>
			))}
		</div>
	);
}

const meta = { title: "Patterns/Timeline/Pending clip badge", component: Clips } satisfies Meta<
	typeof Clips
>;
export default meta;
export const States: StoryObj<typeof meta> = {};
