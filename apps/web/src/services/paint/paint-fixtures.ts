/* TEST SUPPORT ONLY. Timelines and scene options the paint, surface and query
 * suites share: a uniform row layout and a large evenly spaced timeline. */
import { framesToProject, projectTime } from "@models/timeline-view/tick.ts";
import { resolveViewport } from "@models/timeline-view/viewport.ts";
import { type TimelineItem, type TimelineState } from "@models/timeline-view/types.ts";
import { magneticSingleRow, BASE_30 } from "@models/timeline-view/fixtures.ts";
import { DEFAULT_PAINT_PALETTE } from "./palette.ts";
import { uniformRows, type SceneOptions } from "./scene.ts";
import { testEngine } from "@models/editor-engine/engine-fixture.ts";

/* Ruler labels as the engine formats them. */
function timecode(
	frames: number,
	base: { frameRate: { numerator: number; denominator: number }; ticksPerFrame: number },
): string {
	const label = testEngine.formatTimecode(frames, base.frameRate, base.ticksPerFrame, false);
	if (!label.ok) throw new Error(label.error.message);
	return label.value;
}

export const ROW_HEIGHT_PX = 40;
export const RULER_HEIGHT_PX = 28;

export function sceneOptions(
	state: TimelineState,
	overrides: Partial<SceneOptions> = {},
): SceneOptions {
	return {
		palette: DEFAULT_PAINT_PALETTE,
		rows: uniformRows(
			state.rows.map((row) => row.id),
			ROW_HEIGHT_PX,
		),
		heightPx: RULER_HEIGHT_PX + Math.max(1, state.rows.length) * ROW_HEIGHT_PX,
		rulerHeightPx: RULER_HEIGHT_PX,
		timecode,
		...overrides,
	};
}

/** A timeline of `count` items, one frame of gap apart, for the scale cases. */
export function largeTimeline(count: number, widthPx = 800): TimelineState {
	const items: TimelineItem[] = [];
	for (let index = 0; index < count; index += 1) {
		items.push({
			id: `item-${index}`,
			kind: "clip",
			start: framesToProject(index * 30, BASE_30),
			duration: framesToProject(30, BASE_30),
		});
	}
	const base = magneticSingleRow();
	return {
		...base,
		items: new Map(items.map((item) => [item.id, item])),
		order: items.map((item) => item.id),
		duration: framesToProject(count * 30, BASE_30),
		/* One pixel per frame, so 800px shows a shade under 27 items. */
		viewport: resolveViewport({ start: projectTime(0), scale: 1 / BASE_30.ticksPerFrame, widthPx }),
	};
}
