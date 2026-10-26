/* Motion Studio's composition, as the library's model.
 *
 * The normalisation is the only conversion this boundary makes, and it makes it
 * in both directions: the composition stores a keyframe as a fraction of its
 * layer's duration, the library counts absolute ticks, and neither has to know
 * about the other. These pin that round trip and the clamp that keeps a
 * keyframe inside the layer carrying it.
 *
 * `normalizedTimeIn`'s coverage arrived here from `motion-vui-adapter.test.ts`
 * when `motionKeyframeTimeForPhase` was removed: the kernel owns the gesture
 * PHASES now, but "where inside its layer does this land" is still the
 * consumer's question and still has to be answered the same way.
 */
import { describe, expect, test } from "vite-plus/test";
import type { CompositionLayer } from "@maleo/shared";
import {
	MOTION_TIMEBASE,
	motionMarkerId,
	motionRowId,
	motionStateOf,
	motionTicksToSeconds,
	normalizedTimeIn,
	parseMotionMarkerId,
} from "./motion-document-adapter.ts";

function layer(overrides: Partial<CompositionLayer> = {}): CompositionLayer {
	return {
		id: 1,
		content: "Title",
		start: 2,
		dur: 4,
		preset: "plain",
		anim: {
			tracks: {
				x: [
					{ t: 0, v: 0 },
					{ t: 0.5, v: 40 },
				],
			},
		},
		...overrides,
	} as CompositionLayer;
}

describe("motion document adapter", () => {
	test("a layer becomes an item carrying its tracks, not a row beside them", () => {
		const state = motionStateOf([layer()], 10);
		const item = state.items.get(motionRowId(1))!;
		expect(item.rowId).toBe(motionRowId(1));
		/* Nested, because a keyframe's position means nothing away from the item
		 * that carries it — flattening would force re-deriving that on every edit. */
		expect(item.tracks?.[0]?.markers).toHaveLength(2);
		expect(state.rows).toEqual([{ id: motionRowId(1), placement: "free", overlap: "permit" }]);
	});

	test("a keyframe's fraction becomes an absolute tick, and comes back the same fraction", () => {
		const source = layer();
		const state = motionStateOf([source], 10);
		const markers = state.items.get(motionRowId(1))!.tracks![0]!.markers;
		/* `t: 0.5` on a layer starting at 2s and lasting 4s is 4s on the timeline. */
		expect(motionTicksToSeconds(markers[1]!.at.ticks)).toBeCloseTo(4, 6);
		expect(normalizedTimeIn(source, motionTicksToSeconds(markers[1]!.at.ticks))).toBeCloseTo(
			0.5,
			6,
		);
		expect(state.timebase.ticksPerFrame).toBe(MOTION_TIMEBASE.ticksPerFrame);
	});

	test("a keyframe cannot leave the layer that carries it", () => {
		const source = layer();
		/* Outside the layer there is no time for the keyframe to be at, which is
		 * the same reason its track is nested rather than beside it. */
		expect(normalizedTimeIn(source, 1)).toBe(0);
		expect(normalizedTimeIn(source, 99)).toBe(1);
		expect(normalizedTimeIn(source, 3)).toBeCloseTo(0.25, 6);
		/* A zero-length layer has no inside; answering 0 beats dividing by zero. */
		expect(normalizedTimeIn(layer({ dur: 0 }), 5)).toBe(0);
	});

	test("a marker identity round-trips to the layer, track, and index it names", () => {
		const id = motionMarkerId(7, { kind: "value", prop: "x" }, 3);
		expect(parseMotionMarkerId(id)).toEqual({ layerId: 7, trackId: "value-x", index: 3 });
		expect(parseMotionMarkerId("not-a-marker")).toBeNull();
	});
});
