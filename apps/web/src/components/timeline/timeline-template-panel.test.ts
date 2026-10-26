import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_TIMELINE_TEMPLATE, resolveTimelineIntroTextPreset } from "@maleo/shared";
import { StoryboardReel } from "@maleo/video/composition";
import {
	buildTimelineTemplatePreview,
	buildTimelineTemplateRendererProps,
	buildTimelineTemplateSaveInput,
	cancelTimelineTemplateEditor,
	persistTimelineTemplateEditor,
	timelineTemplateInspectorSection,
} from "./timeline-template-panel.tsx";
import {
	buildTimelineTemplateTimelineLanes,
	resizeTimelineTemplateRange,
	timelineTemplatePreviewDuration,
} from "@models/timeline/template-preview-lanes.ts";

describe("timeline template WYSIWYG preview", () => {
	it("disables retired stored titles and renders retained text with explicit style", () => {
		expect(resolveTimelineIntroTextPreset("cinematic-title-intro")).toBe("");
		expect(resolveTimelineIntroTextPreset("countdown-intro")).toBe("");
		const preview = buildTimelineTemplatePreview({
			...DEFAULT_TIMELINE_TEMPLATE,
			introTextPreset: resolveTimelineIntroTextPreset("cinematic-title-intro"),
		});
		expect(preview.textOverlays).toHaveLength(1);
		expect(preview.textOverlays?.[0]?.preset).toBe("plain");
		expect(preview.textOverlays?.[0]?.style?.fontFamily).toBe("Inter");
	});

	/* The template no longer owns a background — the project's settings do, and they
	 * are what reaches a render. The preview uses a fixed neutral so it stays
	 * legible without implying the template decides it. */
	it("renders through StoryboardReel input on a neutral background", () => {
		const preview = buildTimelineTemplatePreview(DEFAULT_TIMELINE_TEMPLATE);
		expect(preview.bgColor).toBe("#0B0B0F");
	});

	it("removes only the opening overlay when opening motion is disabled", () => {
		const preview = buildTimelineTemplatePreview({
			...DEFAULT_TIMELINE_TEMPLATE,
			introTextPreset: "",
		});
		expect(preview.textOverlays).toHaveLength(1);
		expect(preview.textOverlays?.[0]?.content).toContain("Section 2+");
	});

	it("previews editable lead-in and title duration", () => {
		const preview = buildTimelineTemplatePreview({
			...DEFAULT_TIMELINE_TEMPLATE,
			introLeadInSec: 1.2,
			introTitleDurationSec: 2.8,
		});
		expect(preview.scenes.reduce((sum, scene) => sum + scene.durationSec, 0)).toBe(
			timelineTemplatePreviewDuration({
				...DEFAULT_TIMELINE_TEMPLATE,
				introLeadInSec: 1.2,
				introTitleDurationSec: 2.8,
			}),
		);
		expect(preview.textOverlays?.[0]?.durationSec).toBe(2.8);
	});

	it("plays the selected entry SFX at every preview section boundary", () => {
		const preview = buildTimelineTemplatePreview(
			{
				...DEFAULT_TIMELINE_TEMPLATE,
				introEntrySfx: "whoosh transition",
				introEntrySfxVolume: 0.35,
				introEntrySfxOffsetSec: 0.2,
			},
			{ url: "https://audio.test/whoosh.mp3", durationSec: 1.1 },
		);
		expect(preview.audioOverlays).toHaveLength(2);
		expect(
			preview.audioOverlays?.every(
				(clip) => clip.url === "https://audio.test/whoosh.mp3" && clip.volume === 0.35,
			),
		).toBe(true);
		expect(preview.audioOverlays?.[0]?.startSec).toBe(0.2);
	});

	it("plays scene SFX only on internal scene changes", () => {
		const preview = buildTimelineTemplatePreview(
			{ ...DEFAULT_TIMELINE_TEMPLATE, sceneEntrySfx: "gentle interface tick" },
			{ url: "https://audio.test/section.mp3", durationSec: 1 },
			{ url: "https://audio.test/scene.mp3", durationSec: 0.5 },
		);
		const sectionHits = preview.audioOverlays?.filter((clip) => clip.kind === "accent_hit") ?? [];
		const sceneHits = preview.audioOverlays?.filter((clip) => clip.kind === "sfx") ?? [];
		expect(sectionHits.map((clip) => clip.startSec)).toEqual([0, 6.2]);
		expect(sceneHits.map((clip) => clip.startSec)).toEqual([2.5, 8.7]);
	});

	it("previews static movement and optional transition override", () => {
		const normal = buildTimelineTemplatePreview({ ...DEFAULT_TIMELINE_TEMPLATE });
		expect(normal.scenes.some((scene) => scene.movement !== "Static")).toBe(true);
		const overridden = buildTimelineTemplatePreview({
			...DEFAULT_TIMELINE_TEMPLATE,
			staticSceneMovement: true,
			overrideSceneTransition: true,
			sceneTransition: "pixel",
		});
		expect(overridden.scenes.every((scene) => scene.movement === "Static")).toBe(true);
		expect(overridden.scenes.every((scene) => scene.transition === "pixel")).toBe(true);
	});

	it("honors an uncapped positive title duration", () => {
		const preview = buildTimelineTemplatePreview({
			...DEFAULT_TIMELINE_TEMPLATE,
			introTitleDurationSec: 30,
		});
		expect(preview.textOverlays?.[0]?.durationSec).toBe(30);
		expect(preview.textOverlays?.[1]?.durationSec).toBe(30);
	});

	it("shows no data lane", () => {
		const lanes = buildTimelineTemplateTimelineLanes(DEFAULT_TIMELINE_TEMPLATE);
		expect(lanes.map((lane) => lane.id)).not.toContain("data");
	});

	it("maps editable timing policy to timeline ranges", () => {
		const lanes = buildTimelineTemplateTimelineLanes({
			...DEFAULT_TIMELINE_TEMPLATE,
			introLeadInSec: 1.25,
			sectionGapSec: 0.75,
			maxVisualBeatSec: 7,
			maxVoiceoverSegmentSec: 9,
		});
		const ranges = lanes.flatMap((lane) => lane.ranges);
		expect(ranges.find((range) => range.id === "lead-in")?.durationSec).toBe(1.25);
		expect(ranges.find((range) => range.id === "section-gap")?.durationSec).toBe(0.75);
		expect(ranges.find((range) => range.id === "visual-beat")?.durationSec).toBe(7);
		expect(ranges.find((range) => range.id === "vo-segment")?.durationSec).toBe(9);
		expect(ranges.find((range) => range.id === "visual-beat")?.resizeEnd).toBe(true);
		expect(
			lanes.find((lane) => lane.id === "visual-beat")?.ranges.map((range) => range.id),
		).toEqual(["visual-beat"]);
		expect(lanes.find((lane) => lane.id === "vo-segment")?.ranges.map((range) => range.id)).toEqual(
			["vo-segment"],
		);
		expect(
			lanes.find((lane) => lane.id === "subsection-breath")?.ranges.map((range) => range.id),
		).toEqual(["subsection-breath"]);
	});

	it("maps selected ranges to inspector ownership", () => {
		expect(timelineTemplateInspectorSection("intro-title")).toBe("opening");
		expect(timelineTemplateInspectorSection("section-gap")).toBe("entries");
		expect(timelineTemplateInspectorSection("visual-beat")).toBe("scene");
	});

	it("maps committed range resize into clamped template fields", () => {
		const template = { ...DEFAULT_TIMELINE_TEMPLATE, introTitleDurationSec: 3, introLeadInSec: 1 };
		expect(resizeTimelineTemplateRange(template, "lead-in", "end", 7).introLeadInSec).toBe(3);
		expect(resizeTimelineTemplateRange(template, "visual-beat", "end", 99).maxVisualBeatSec).toBe(
			15,
		);
		expect(
			resizeTimelineTemplateRange(template, "sentence-breath", "start", 3.8)
				.sentenceVoiceoverPauseSec,
		).toBeCloseTo(0.2);
		expect(resizeTimelineTemplateRange(template, "unknown", "end", 4)).toBe(template);
	});

	it("keeps final renderer component and props stable", () => {
		const template = { ...DEFAULT_TIMELINE_TEMPLATE, introLeadInSec: 1.2 };
		const props = buildTimelineTemplateRendererProps(template, 1080, 1920);
		expect(props.component).toBe(StoryboardReel);
		expect(props.inputProps).toEqual(buildTimelineTemplatePreview(template));
		expect(props.durationInFrames).toBe(Math.ceil(timelineTemplatePreviewDuration(template) * 30));
		expect({
			fps: props.fps,
			width: props.compositionWidth,
			height: props.compositionHeight,
		}).toEqual({ fps: 30, width: 1080, height: 1920 });
	});

	it("builds save payload from pinned URLs before resolved fallbacks", () => {
		const draft = {
			...DEFAULT_TIMELINE_TEMPLATE,
			introEntrySfxUrl: "/pinned.mp3",
			sceneEntrySfxUrl: "",
			musicUrl: "",
		};
		const input = buildTimelineTemplateSaveInput(
			draft,
			{ url: "/resolved-section.mp3" },
			{ url: "/scene.mp3" },
			{ url: "/music.mp3" },
		);
		expect(input.introEntrySfxUrl).toBe("/pinned.mp3");
		expect(input.sceneEntrySfxUrl).toBe("/scene.mp3");
		expect(input.musicUrl).toBe("/music.mp3");
	});

	it("maps create save and cancel to consumer callbacks", async () => {
		const calls: string[] = [];
		const input = { ...DEFAULT_TIMELINE_TEMPLATE, name: "Adapter test" };
		const created = {
			...input,
			id: "created",
			slug: null,
			source: "user" as const,
			retired: false,
			createdAt: 1,
			updatedAt: 1,
		};
		await persistTimelineTemplateEditor(
			{ mode: "create", initial: input },
			input,
			async () => {
				calls.push("create");
				return created;
			},
			async () => {
				calls.push("update");
				return created;
			},
			() => calls.push("close-after-save"),
		);
		cancelTimelineTemplateEditor(() => calls.push("cancel"));
		expect(calls).toEqual(["create", "close-after-save", "cancel"]);
	});
});
