import { expect, test } from "vite-plus/test";
import {
	captionClock,
	captionClockTenths,
	captionRangeLabel,
	captionSourceLabels,
} from "./caption-labels.ts";

test("clock formats minutes and seconds, and hours past an hour", () => {
	expect(captionClock(0)).toBe("0:00");
	expect(captionClock(12.01)).toBe("0:12");
	expect(captionClock(65.9)).toBe("1:05");
	expect(captionClock(3725)).toBe("1:02:05");
	expect(captionClock(-1)).toBe("0:00");
	expect(captionClock(Number.NaN)).toBe("0:00");
});

test("tenths clock keeps one decimal without rounding into the next second", () => {
	expect(captionClockTenths(0)).toBe("0:00.0");
	expect(captionClockTenths(3.46)).toBe("0:03.4");
	expect(captionClockTenths(59.99)).toBe("0:59.9");
	expect(captionClockTenths(3725.25)).toBe("1:02:05.2");
});

test("range reads start to end in clock form", () => {
	expect(captionRangeLabel([{ startSec: 0, durationSec: 12.01 }])).toBe("0:00 – 0:12");
	expect(
		captionRangeLabel([
			{ startSec: 5, durationSec: 10 },
			{ startSec: 2, durationSec: 1 },
		]),
	).toBe("0:02 – 0:15");
	expect(captionRangeLabel([])).toBeNull();
});

test("source labels use media names and never internal clip ids", () => {
	const labels = captionSourceLabels(
		[
			{ clipId: "video:1792255103569", visualId: "v1", url: "/api/media/a", startSec: 0 },
			{ clipId: "audio:17922551", url: "/api/media/b", mediaAssetId: "asset-b", startSec: 65 },
			{ clipId: "video:2", visualId: "v2", url: "/api/media/c", startSec: 3 },
			{ clipId: "audio:3", url: "/api/media/d", startSec: 4 },
		],
		[
			{ id: "asset-a", url: "/api/media/a", label: "interview.mp4" },
			{ id: "asset-b", url: "/api/media/other", label: "music.mp3" },
			{ id: "asset-c", url: "/api/media/c", label: "  " },
		],
	);
	expect(labels).toEqual([
		"interview.mp4 · 0:00",
		"music.mp3 · 1:05",
		"Video 2 · 0:03",
		"Audio 2 · 0:04",
	]);
	for (const label of labels) expect(label).not.toMatch(/(video|audio):\d+/);
});
