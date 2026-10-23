/* The mock timeline a template previews itself with.
 *
 * A timeline template is a set of numbers — a title duration, a lead-in, a gap,
 * a maximum beat — and none of them is a clip. So the timeline the editor draws
 * is a two-section MOCK built from those numbers, which is what lets an author
 * see what a setting means before any video exists.
 *
 * Pure, and here rather than in the panel: the panel draws lanes, and what the
 * lanes SAY is a fact about the template. `resizeTimelineTemplateRange` is the
 * inverse — the one number a dragged edge stands for — and it lives beside the
 * lanes so that adding a lane and forgetting its edge is one file's mistake
 * rather than two.
 */
import { EMOTIONS, type Emotion, type TimelineTemplateInput } from "@maleo/shared";
import type { TemplateLane, TemplateRange } from "./template-document-adapter.ts";

/**
 * How long a resolved preview clip runs.
 *
 * Structural rather than the API's own type: what a lane needs from a resolved
 * SFX is its length, and importing the API's response shape here would make the
 * model layer depend on the transport that happens to deliver it today.
 */
export interface PreviewClipDuration {
	durationSec?: number;
}

export function timelineTemplatePreviewDuration(template: TimelineTemplateInput): number {
	const sectionSpan = Math.max(4, template.introTitleDurationSec + 1);
	return sectionSpan * 2 + template.introLeadInSec + template.sectionGapSec;
}

/** Milliseconds, which is as fine as a preview edge is ever placed. */
export const roundSec = (value: number): number => Math.round(value * 1000) / 1000;
const clamp = (value: number, min: number, max: number): number =>
	Math.max(min, Math.min(max, value));

export function resizeTimelineTemplateRange(
	value: TimelineTemplateInput,
	rangeId: string,
	edge: "start" | "end",
	sec: number,
): TimelineTemplateInput {
	const currentSectionSpan = Math.max(4, value.introTitleDurationSec + 1);
	if (rangeId === "intro-title" || rangeId === "section-title")
		return {
			...value,
			introTitleDurationSec: clamp(
				sec -
					(rangeId === "section-title"
						? currentSectionSpan + value.introLeadInSec + value.sectionGapSec
						: 0),
				0.1,
				12,
			),
		};
	if (rangeId === "lead-in")
		return { ...value, introLeadInSec: clamp(sec - currentSectionSpan, 0, 8) };
	if (rangeId === "section-gap")
		return {
			...value,
			sectionGapSec: clamp(sec - (currentSectionSpan + value.introLeadInSec), 0, 12),
		};
	if (rangeId === "visual-beat") return { ...value, maxVisualBeatSec: clamp(sec, 2, 15) };
	if (rangeId === "vo-segment") return { ...value, maxVoiceoverSegmentSec: clamp(sec, 3, 20) };
	if (rangeId === "sentence-breath" && edge === "start")
		return { ...value, sentenceVoiceoverPauseSec: clamp(currentSectionSpan - sec, 0, 2) };
	if (rangeId === "subsection-breath")
		return { ...value, sceneVoiceoverPauseSec: clamp(sec - currentSectionSpan / 2, 0, 3) };
	return value;
}

/* The beds the current settings would place. The preview timeline is a two-section
 * mock, so per-emotion scoring is shown as the first distinct emotions the project
 * actually uses (falling back to the palette order when there is no plan yet) —
 * enough to see that the score changes and what it changes to. */
function musicPreviewRanges(
	template: TimelineTemplateInput,
	previewDurationSec: number,
	secondStartSec: number,
	emotions: Emotion[],
): TemplateRange[] {
	const label = (emotion: Emotion): string => {
		const entry = template.musicEmotionCues[emotion];
		return `${emotion}: ${entry?.cue?.trim() || template.musicCue}`;
	};
	if (template.musicPolicy !== "per_emotion") {
		return [
			{
				id: "music-bed",
				laneId: "music",
				label: template.musicCue || "Background music",
				startSec: 0,
				durationSec: previewDurationSec,
				tone: "audio",
			},
		];
	}
	const [first, second] = emotions.length ? emotions : EMOTIONS;
	// A second bed only when the arc actually changes emotion; one emotion throughout
	// is one continuous bed, exactly as the resolver would merge it.
	if (!second || second === first) {
		return [
			{
				id: "music-bed-1",
				laneId: "music",
				label: label(first!),
				startSec: 0,
				durationSec: previewDurationSec,
				tone: "audio",
			},
		];
	}
	return [
		{
			id: "music-bed-1",
			laneId: "music",
			label: label(first!),
			startSec: 0,
			durationSec: secondStartSec,
			tone: "audio",
		},
		{
			id: "music-bed-2",
			laneId: "music",
			label: label(second),
			startSec: secondStartSec,
			durationSec: Math.max(0.1, previewDurationSec - secondStartSec),
			tone: "audio",
		},
	];
}

export function buildTimelineTemplateTimelineLanes(
	template: TimelineTemplateInput,
	sectionPreviewAudio?: PreviewClipDuration | null,
	scenePreviewAudio?: PreviewClipDuration | null,
	previewEmotions: Emotion[] = [],
): TemplateLane[] {
	const sectionSpan = Math.max(4, template.introTitleDurationSec + 1);
	const secondStartSec = roundSec(sectionSpan + template.introLeadInSec + template.sectionGapSec);
	const firstInternalSceneStartSec = roundSec(sectionSpan / 2);
	const secondInternalSceneStartSec = roundSec(secondStartSec + sectionSpan / 2);
	const previewDurationSec = timelineTemplatePreviewDuration(template);
	const sectionAudioDurationSec = Math.max(0.1, sectionPreviewAudio?.durationSec ?? 0.65);
	const sceneAudioDurationSec = Math.max(0.1, scenePreviewAudio?.durationSec ?? 0.45);
	const lanes: TemplateLane[] = [
		{
			id: "sections",
			label: "Sections",
			ranges: [
				{
					id: "section-1",
					laneId: "sections",
					label: "Section 1",
					startSec: 0,
					durationSec: sectionSpan,
					tone: "section",
				},
				{
					id: "lead-in",
					laneId: "sections",
					label: "Lead-in",
					startSec: sectionSpan,
					durationSec: template.introLeadInSec,
					tone: "hold",
					resizeEnd: true,
				},
				{
					id: "section-gap",
					laneId: "sections",
					label: "Gap",
					startSec: roundSec(sectionSpan + template.introLeadInSec),
					durationSec: template.sectionGapSec,
					tone: "hold",
					resizeEnd: true,
				},
				{
					id: "section-2",
					laneId: "sections",
					label: "Section 2+",
					startSec: secondStartSec,
					durationSec: Math.max(0.1, previewDurationSec - secondStartSec),
					tone: "section",
				},
			],
		},
		{
			id: "titles",
			label: "Titles",
			ranges: [
				...(template.sectionTitlePolicy !== "none" && template.introTextPreset
					? [
							{
								id: "intro-title",
								laneId: "titles",
								label: "Opening title",
								startSec: 0,
								durationSec: template.introTitleDurationSec,
								tone: "section" as const,
								resizeEnd: true,
							},
						]
					: []),
				...(template.sectionTitlePolicy === "every_section" && template.sectionTextPreset
					? [
							{
								id: "section-title",
								laneId: "titles",
								label: "Section title",
								startSec: secondStartSec,
								durationSec: template.introTitleDurationSec,
								tone: "section" as const,
								resizeEnd: true,
							},
						]
					: []),
			],
		},
		{
			id: "scenes",
			label: "Scene policy",
			ranges: [
				{
					id: "scene-a",
					laneId: "scenes",
					label: "Scene 1",
					startSec: 0,
					durationSec: firstInternalSceneStartSec,
					tone: "scene",
				},
				{
					id: "scene-b",
					laneId: "scenes",
					label: "Scene 2",
					startSec: firstInternalSceneStartSec,
					durationSec: sectionSpan - firstInternalSceneStartSec,
					tone: "scene",
				},
			],
		},
		{
			id: "visual-beat",
			label: "Max visual beat",
			ranges: [
				{
					id: "visual-beat",
					laneId: "visual-beat",
					label: "Max visual beat",
					startSec: 0,
					durationSec: template.maxVisualBeatSec ?? 6,
					tone: "scene",
					resizeEnd: true,
				},
			],
		},
		{
			id: "voice",
			label: "Voiceover",
			ranges: [
				{
					id: "sentence-breath",
					laneId: "voice",
					label: "Sentence breath",
					startSec: Math.max(0, sectionSpan - (template.sentenceVoiceoverPauseSec ?? 0.15)),
					durationSec: template.sentenceVoiceoverPauseSec ?? 0.15,
					tone: "hold",
					resizeStart: true,
				},
			],
		},
		{
			id: "vo-segment",
			label: "Max VO segment",
			ranges: [
				{
					id: "vo-segment",
					laneId: "vo-segment",
					label: "Max VO segment",
					startSec: 0,
					durationSec: template.maxVoiceoverSegmentSec ?? 8,
					tone: "voice",
					resizeEnd: true,
				},
			],
		},
		{
			id: "subsection-breath",
			label: "Sub-section breath",
			ranges: [
				{
					id: "subsection-breath",
					laneId: "subsection-breath",
					label: "Sub-section breath",
					startSec: firstInternalSceneStartSec,
					durationSec: template.sceneVoiceoverPauseSec ?? 0.35,
					tone: "hold",
					resizeEnd: true,
				},
			],
		},
		{
			id: "music",
			label: "Music",
			ranges: musicPreviewRanges(template, previewDurationSec, secondStartSec, previewEmotions),
		},
		{
			id: "sfx",
			label: "SFX",
			ranges: [
				...(template.introEntrySfx
					? [
							{
								id: "section-sfx-1",
								laneId: "sfx",
								label: "Section SFX",
								startSec: template.introEntrySfxOffsetSec,
								durationSec: sectionAudioDurationSec,
								tone: "audio" as const,
							},
							{
								id: "section-sfx-2",
								laneId: "sfx",
								label: "Section SFX",
								startSec: secondStartSec + template.introEntrySfxOffsetSec,
								durationSec: sectionAudioDurationSec,
								tone: "audio" as const,
							},
						]
					: []),
				...(template.sceneEntrySfx
					? [
							{
								id: "scene-sfx-1",
								laneId: "sfx",
								label: "Scene SFX",
								startSec: firstInternalSceneStartSec,
								durationSec: sceneAudioDurationSec,
								tone: "audio" as const,
							},
							{
								id: "scene-sfx-2",
								laneId: "sfx",
								label: "Scene SFX",
								startSec: secondInternalSceneStartSec,
								durationSec: sceneAudioDurationSec,
								tone: "audio" as const,
							},
						]
					: []),
			],
		},
	];
	return lanes.filter((lane) => lane.ranges.length > 0);
}
