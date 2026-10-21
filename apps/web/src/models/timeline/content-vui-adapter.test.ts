import { describe, expect, test } from "vite-plus/test";
import {
	CONTENT_TIMELINE_DOMAIN_OWNERS,
	contentScrubDecision,
	contentTimeAtClientX,
	contentTimeToPixels,
	contentViewportFromScroller,
	contentZoomCommand,
} from "./content-vui-adapter.ts";

describe("content VUI adapter ownership", () => {
	test("keeps every Maleo timeline policy and persistence boundary in web", () => {
		expect(CONTENT_TIMELINE_DOMAIN_OWNERS).toEqual([
			"document-writers",
			"lane-gutter",
			"lane-actions",
			"lane-reorder",
			"marquee-selection",
			"beat-grid",
			"typed-lanes",
			"selection-rules",
			"snapping-policy",
			"media-drops",
			"persistence",
		]);
	});

	test("maps Maleo scroller geometry through VUI time/pixel conversion", () => {
		expect(contentTimeAtClientX(260, 100, 40, 10)).toBe(4);
		expect(contentTimeAtClientX(20, 100, 40, 10)).toBe(0);
		expect(contentTimeAtClientX(900, 100, 40, 10)).toBe(10);
		expect(contentTimeToPixels(2.5, 40)).toBe(100);
		expect(
			contentViewportFromScroller({
				scrollLeft: 180,
				clientWidth: 500,
				gutterWidth: 100,
				pxPerSec: 40,
			}),
		).toEqual({ startSec: 2, endSec: 12, pxPerSec: 40 });
	});

	test("maps VUI focal zoom back to existing scroller/chrome owners", () => {
		const next = contentZoomCommand({
			scrollLeft: 180,
			clientWidth: 500,
			gutterWidth: 100,
			pxPerSec: 40,
			factor: 2,
			focalClientPx: 200,
			minPxPerSec: 4,
			maxPxPerSec: 240,
		});
		expect(next.pxPerSec).toBe(80);
		expect(next.scrollLeft).toBe(460);
		expect(next.viewport.focalTimeSec).toBe(7);
	});

	test("maps VUI scrub lifecycle to content range policy and restores cancellation", () => {
		const base = {
			initialPlayheadSec: 3,
			anchorTimeSec: 4,
			currentTimeSec: 6,
			previousRange: { start: 1, end: 2 },
		};
		expect(
			contentScrubDecision({ ...base, phase: "update", distancePx: 30, coarse: true }),
		).toEqual({ seekSec: 6, range: { start: 4, end: 6 } });
		expect(contentScrubDecision({ ...base, phase: "commit", distancePx: 4, coarse: true })).toEqual(
			{ seekSec: 6, range: null },
		);
		expect(
			contentScrubDecision({ ...base, phase: "commit", distancePx: 30, coarse: false }),
		).toEqual({ seekSec: 6, range: undefined });
		expect(
			contentScrubDecision({ ...base, phase: "cancel", distancePx: 30, coarse: true }),
		).toEqual({ seekSec: 3, range: { start: 1, end: 2 } });
	});
});
