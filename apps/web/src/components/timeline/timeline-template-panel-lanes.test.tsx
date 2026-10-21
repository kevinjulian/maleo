import { describe, expect, test } from "vite-plus/test";
import { DEFAULT_TIMELINE_TEMPLATE, type Emotion, type TimelineTemplateInput } from "@maleo/shared";
import { buildTimelineTemplatePreview } from "./timeline-template-panel.tsx";
import { buildTimelineTemplateTimelineLanes } from "@models/timeline/template-preview-lanes.ts";

const template = (over: Partial<TimelineTemplateInput> = {}): TimelineTemplateInput => ({
	...DEFAULT_TIMELINE_TEMPLATE,
	...over,
});
const musicLane = (t: TimelineTemplateInput, emotions: Emotion[] = []) =>
	buildTimelineTemplateTimelineLanes(t, null, null, emotions).find((lane) => lane.id === "music");

describe("template preview shows the music being configured", () => {
	test("the editor timeline carries a music lane", () => {
		// The modal claims to preview through the final renderer; the one setting the
		// operator is editing must not be the one thing missing from it.
		expect(musicLane(template())).toBeDefined();
	});

	test("a single-bed template previews one bed across the whole timeline", () => {
		const lane = musicLane(template())!;
		expect(lane.ranges).toHaveLength(1);
		expect(lane.ranges[0]!.startSec).toBe(0);
	});

	test("per-emotion scoring previews a bed change", () => {
		const lane = musicLane(template({ musicPolicy: "per_emotion" }), ["calm", "tension"])!;
		expect(lane.ranges).toHaveLength(2);
		expect(lane.ranges[0]!.label).toContain("calm");
		expect(lane.ranges[1]!.label).toContain("tension");
	});

	test("beds are contiguous and never overlap", () => {
		const lane = musicLane(template({ musicPolicy: "per_emotion" }), ["calm", "tension"])!;
		const [first, second] = lane.ranges;
		expect(second!.startSec).toBe(first!.startSec + first!.durationSec);
	});

	test("one emotion throughout previews as one continuous bed", () => {
		// Matches how the resolver merges adjacent sections sharing a cue.
		const lane = musicLane(template({ musicPolicy: "per_emotion" }), ["calm"])!;
		expect(lane.ranges).toHaveLength(1);
	});

	test("labels name the cue that emotion will actually resolve", () => {
		const t = template({
			musicPolicy: "per_emotion",
			musicEmotionCues: {
				...DEFAULT_TIMELINE_TEMPLATE.musicEmotionCues,
				tension: { cue: "my own track", url: "" },
			},
		});
		expect(musicLane(t, ["tension", "calm"])!.ranges[0]!.label).toContain("my own track");
	});

	test("an emotion with no entry is labelled with the default cue", () => {
		const t = template({ musicPolicy: "per_emotion", musicEmotionCues: {} });
		expect(musicLane(t, ["tension", "calm"])!.ranges[0]!.label).toContain(
			DEFAULT_TIMELINE_TEMPLATE.musicCue,
		);
	});

	test("falls back to the palette order when the project has no plan yet", () => {
		expect(musicLane(template({ musicPolicy: "per_emotion" }), [])!.ranges.length).toBeGreaterThan(
			0,
		);
	});
});

describe("template preview plays the bed", () => {
	test("the resolved music reaches the preview storyboard at the configured gain", () => {
		const storyboard = buildTimelineTemplatePreview(template({ musicVolume: 0.4 }), null, null, {
			url: "/bed.mp3",
		});
		const music = storyboard.audioOverlays?.filter((clip) => clip.kind === "music") ?? [];
		expect(music).toHaveLength(1);
		expect(music[0]!.url).toBe("/bed.mp3");
		expect(music[0]!.volume).toBe(0.4);
	});

	test("no music clip is emitted when nothing resolved", () => {
		const storyboard = buildTimelineTemplatePreview(template(), null, null, null);
		expect(storyboard.audioOverlays?.some((clip) => clip.kind === "music")).toBeFalsy();
	});
});
