/* The timeline template editor's non-drawing half: the editable shape of a
 * template, the storyboard its preview renders, the save and cancel paths, and
 * the lookup that resolves a cue to preview audio. Re-exported from
 * timeline-template-panel.tsx, which is where the library catalogue and the
 * tests import them from. */
import { useEffect, useState } from "react";
import { StoryboardReel, type Storyboard } from "@maleo/video/composition";
import { absolutizeStoryboard } from "@models/storyboard/storyboard-mapper.ts";
import {
	DEFAULT_TIMELINE_TEMPLATE,
	resolveTimelineIntroTextPreset,
	type TimelineTemplate,
	type TimelineTemplateInput,
} from "@maleo/shared";
import type { TemplateParams, TextPreset } from "@maleo/shared";
import {
	resolveTimelineTemplatePreviewMusic,
	resolveTimelineTemplatePreviewSfx,
	type TimelineTemplatePreviewAudio,
} from "@api/templates.ts";
import {
	roundSec,
	timelineTemplatePreviewDuration,
} from "@models/timeline/template-preview-lanes.ts";
import { STUDIO_BLANK_PIXEL } from "@models/timeline/studio-base-storyboard.ts";

export type EditorState =
	| { mode: "create"; initial: TimelineTemplateInput }
	| { mode: "edit"; template: TimelineTemplate; initial: TimelineTemplateInput };
export type TemplateInspectorSection =
	| "identity"
	| "opening"
	| "entries"
	| "scene"
	| "music"
	| "visual";

export function timelineTemplateInspectorSection(rangeId: string): TemplateInspectorSection {
	if (rangeId === "intro-title") return "opening";
	if (
		rangeId === "section-title" ||
		rangeId === "lead-in" ||
		rangeId === "section-gap" ||
		rangeId === "section-entry-sfx"
	)
		return "entries";
	if (rangeId === "data") return "visual";
	return "scene";
}

/** The editable shape of a stored template — shared with the library catalogue. */
export function templateInput(template: TimelineTemplate): TimelineTemplateInput {
	return {
		name: template.name,
		description: template.description,
		introTextPreset: template.introTextPreset,
		introEntrySfx: template.introEntrySfx,
		introEntrySfxUrl: template.introEntrySfxUrl ?? "",
		introLeadInSec: template.introLeadInSec,
		introTitleDurationSec: template.introTitleDurationSec,
		introEntrySfxVolume: template.introEntrySfxVolume,
		introEntrySfxOffsetSec: template.introEntrySfxOffsetSec,
		sectionGapSec: template.sectionGapSec,
		sectionTitlePolicy: template.sectionTitlePolicy,
		sectionTextPreset: template.sectionTextPreset,
		sceneEntrySfx: template.sceneEntrySfx ?? "",
		sceneEntrySfxUrl: template.sceneEntrySfxUrl ?? "",
		musicCue: template.musicCue ?? DEFAULT_TIMELINE_TEMPLATE.musicCue,
		musicUrl: template.musicUrl ?? "",
		musicVolume: template.musicVolume ?? 1,
		musicPolicy: template.musicPolicy ?? "single",
		musicEmotionCues: template.musicEmotionCues ?? {},
		sentenceVoiceoverPauseSec: template.sentenceVoiceoverPauseSec ?? 0.15,
		sceneVoiceoverPauseSec: template.sceneVoiceoverPauseSec ?? 0.35,
		maxVisualBeatSec: template.maxVisualBeatSec ?? 6,
		maxVoiceoverSegmentSec: template.maxVoiceoverSegmentSec ?? 8,
		staticSceneMovement: template.staticSceneMovement ?? false,
		overrideSceneTransition: template.overrideSceneTransition ?? false,
		sceneTransition: template.sceneTransition ?? "fade",
		useData: template.useData,
		imageGuidancePrompt: template.imageGuidancePrompt,
	};
}

function previewPresetParams(preset: TextPreset, title: string): TemplateParams | undefined {
	if (preset === "rve-cinematic-title-intro") return { title, subtitle: "Framework preview" };
	if (preset === "rve-countdown-intro") return { seconds: 3 };
	return undefined;
}

export function buildTimelineTemplatePreview(
	template: TimelineTemplateInput,
	sectionPreviewAudio?: TimelineTemplatePreviewAudio | null,
	scenePreviewAudio?: TimelineTemplatePreviewAudio | null,
	musicPreviewAudio?: TimelineTemplatePreviewAudio | null,
): Storyboard {
	const introPreset = resolveTimelineIntroTextPreset(template.introTextPreset);
	const sectionPreset = resolveTimelineIntroTextPreset(template.sectionTextPreset);
	const sectionSpan = Math.max(4, template.introTitleDurationSec + 1);
	const secondStartSec = roundSec(sectionSpan + template.introLeadInSec + template.sectionGapSec);
	const firstInternalSceneStartSec = roundSec(sectionSpan / 2);
	const secondInternalSceneStartSec = roundSec(secondStartSec + sectionSpan / 2);
	const previewDurationSec = timelineTemplatePreviewDuration(template);
	const textOverlays: NonNullable<Storyboard["textOverlays"]> = [];
	if (template.introTextPreset && template.sectionTitlePolicy !== "none")
		textOverlays.push({
			content:
				introPreset === "rve-countdown-intro"
					? "3\nGO!"
					: introPreset === "section-card"
						? "Opening framework"
						: "A Better Opening\nSection 1",
			startSec: 0,
			durationSec: template.introTitleDurationSec,
			preset: introPreset,
			params: previewPresetParams(introPreset, "A Better Opening"),
			track: 0,
			layout: { xPct: 7, yPct: 8, widthPct: 86, fit: "contain" },
		});
	if (template.sectionTitlePolicy === "every_section" && template.sectionTextPreset)
		textOverlays.push({
			content:
				sectionPreset === "rve-countdown-intro"
					? "3\nGO!"
					: sectionPreset === "section-card"
						? "What changes next?"
						: "What Changes Next?\nSection 2+",
			startSec: secondStartSec,
			durationSec: template.introTitleDurationSec,
			preset: sectionPreset,
			params: previewPresetParams(sectionPreset, "What Changes Next?"),
			track: 0,
			layout: { xPct: 7, yPct: 8, widthPct: 86, fit: "contain" },
		});
	const sectionAudioDurationSec = Math.max(0.1, sectionPreviewAudio?.durationSec ?? 1.5);
	const sectionSfxStarts =
		template.introEntrySfx && sectionPreviewAudio?.url
			? [template.introEntrySfxOffsetSec, secondStartSec + template.introEntrySfxOffsetSec]
			: [];
	const sceneAudioDurationSec = Math.max(0.1, scenePreviewAudio?.durationSec ?? 1.5);
	const sceneSfxStarts =
		template.sceneEntrySfx && scenePreviewAudio?.url
			? [firstInternalSceneStartSec, secondInternalSceneStartSec]
			: [];
	const movement = (fallback: string): string =>
		template.staticSceneMovement ? "Static" : fallback;
	const transition = (
		fallback: TimelineTemplateInput["sceneTransition"],
	): TimelineTemplateInput["sceneTransition"] =>
		template.overrideSceneTransition ? template.sceneTransition : fallback;
	return {
		scenes: [
			{
				image: STUDIO_BLANK_PIXEL,
				durationSec: firstInternalSceneStartSec,
				label: "Section 1 · scene 1",
				movement: movement("Slow Zoom In"),
				transition: transition("fade"),
				voiceover: "",
				visual: "",
				camera: "",
				vignette: false,
				grain: false,
			},
			{
				image: STUDIO_BLANK_PIXEL,
				durationSec: secondStartSec - firstInternalSceneStartSec,
				label: "Section 1 · scene 2",
				movement: movement("Slow Pan Right"),
				transition: transition("slide"),
				voiceover: "",
				visual: "",
				camera: "",
				vignette: false,
				grain: false,
			},
			{
				image: STUDIO_BLANK_PIXEL,
				durationSec: secondInternalSceneStartSec - secondStartSec,
				label: "Section 2+ · scene 1",
				movement: movement("Slow Zoom In"),
				transition: transition("fade"),
				voiceover: "",
				visual: "",
				camera: "",
				vignette: false,
				grain: false,
			},
			{
				image: STUDIO_BLANK_PIXEL,
				durationSec: previewDurationSec - secondInternalSceneStartSec,
				label: "Section 2+ · scene 2",
				movement: movement("Slow Pan Left"),
				transition: transition("fade"),
				voiceover: "",
				visual: "",
				camera: "",
				vignette: false,
				grain: false,
			},
		],
		accentColor: "#8B7CFF",
		// The preview is of the TEMPLATE, which no longer owns a background — the
		// project's settings do. A fixed neutral keeps the preview legible without
		// implying the template decides it.
		bgColor: "#0B0B0F",
		fgColor: "#F4F1FF",
		musicMood: "minimal",
		showLabels: false,
		hideBase: true,
		muteBase: true,
		textOverlays,
		audioOverlays: [
			...(musicPreviewAudio?.url
				? [
						{
							// The bed the template is configuring, at its configured gain, so the preview
							// answers "how loud is this under narration" rather than leaving the one
							// setting being edited inaudible.
							kind: "music" as const,
							content: template.musicCue || "Background music",
							url: musicPreviewAudio.url,
							startSec: 0,
							durationSec: previewDurationSec,
							volume: template.musicVolume,
							fadeInSec: 0.4,
							fadeOutSec: 0.4,
						},
					]
				: []),
			...sectionSfxStarts.map((startSec) => ({
				kind: "accent_hit" as const,
				content: template.introEntrySfx,
				url: sectionPreviewAudio!.url,
				startSec,
				durationSec: sectionAudioDurationSec,
				volume: template.introEntrySfxVolume,
				fadeInSec: 0,
				fadeOutSec: 0,
			})),
			...sceneSfxStarts.map((startSec) => ({
				kind: "sfx" as const,
				content: `Scene entry: ${template.sceneEntrySfx}`,
				url: scenePreviewAudio!.url,
				startSec,
				durationSec: sceneAudioDurationSec,
				volume: template.introEntrySfxVolume,
				fadeInSec: 0,
				fadeOutSec: 0,
			})),
		],
		videoOverlays: [],
		effects: [],
		infographicOverlays: template.useData
			? [
					{
						startSec: 2.4,
						durationSec: 3.2,
						track: 1,
						layout: { xPct: 58, yPct: 62, widthPct: 34, fit: "contain" },
						animation: { in: "slide_up", main: "count", out: "fade" },
						payload: { type: "stat_reveal", title: "Audience retained", value: "84", suffix: "%" },
					},
					{
						startSec: secondStartSec + 2.4,
						durationSec: 3.2,
						track: 1,
						layout: { xPct: 58, yPct: 62, widthPct: 34, fit: "contain" },
						animation: { in: "slide_up", main: "count", out: "fade" },
						payload: { type: "stat_reveal", title: "Completion rate", value: "72", suffix: "%" },
					},
				]
			: [],
	};
}

export function buildTimelineTemplateRendererProps(
	template: TimelineTemplateInput,
	width: number,
	height: number,
	sectionAudio?: TimelineTemplatePreviewAudio | null,
	sceneAudio?: TimelineTemplatePreviewAudio | null,
	musicAudio?: TimelineTemplatePreviewAudio | null,
) {
	const durationSec = timelineTemplatePreviewDuration(template);
	return {
		component: StoryboardReel,
		inputProps: absolutizeStoryboard(
			buildTimelineTemplatePreview(template, sectionAudio, sceneAudio, musicAudio),
		),
		durationInFrames: Math.max(1, Math.ceil(durationSec * 30)),
		compositionWidth: width,
		compositionHeight: height,
		fps: 30,
	};
}

export function buildTimelineTemplateSaveInput(
	draft: TimelineTemplateInput,
	sectionAudio?: TimelineTemplatePreviewAudio | null,
	sceneAudio?: TimelineTemplatePreviewAudio | null,
	musicAudio?: TimelineTemplatePreviewAudio | null,
): TimelineTemplateInput {
	return {
		...draft,
		introEntrySfxUrl: draft.introEntrySfxUrl || sectionAudio?.url || "",
		sceneEntrySfxUrl: draft.sceneEntrySfxUrl || sceneAudio?.url || "",
		musicUrl: draft.musicUrl || musicAudio?.url || "",
	};
}

export function cancelTimelineTemplateEditor(onClose: () => void): void {
	onClose();
}

export async function persistTimelineTemplateEditor(
	state: EditorState,
	input: TimelineTemplateInput,
	onCreate: (value: TimelineTemplateInput) => Promise<TimelineTemplate>,
	onUpdate: (id: string, value: TimelineTemplateInput) => Promise<TimelineTemplate>,
	onClose: () => void,
): Promise<void> {
	if (state.mode === "edit") await onUpdate(state.template.id, input);
	else await onCreate(input);
	onClose();
}

/** A cue's preview audio and where the lookup got to. `null` audio with status
 *  "missing" is a resolved absence; with "idle" it is a cue nobody asked for. */
export interface PreviewSfx {
	audio: TimelineTemplatePreviewAudio | null;
	status: "idle" | "loading" | "ready" | "missing";
}

export function usePreviewSfx(
	cue: string,
	exactUrl?: string,
	kind: "sfx" | "music" = "sfx",
): PreviewSfx {
	const [audio, setAudio] = useState<TimelineTemplatePreviewAudio | null>(null);
	const [status, setStatus] = useState<"idle" | "loading" | "ready" | "missing">("idle");
	useEffect(() => {
		let active = true;
		const value = cue.trim();
		if (!value) {
			setAudio(null);
			setStatus("idle");
			return () => {
				active = false;
			};
		}
		const assetUrl = exactUrl?.trim() ?? "";
		if (assetUrl) {
			setAudio({ url: assetUrl, title: value });
			setStatus("ready");
			return () => {
				active = false;
			};
		}
		setStatus("loading");
		void (
			kind === "music"
				? resolveTimelineTemplatePreviewMusic(value)
				: resolveTimelineTemplatePreviewSfx(value)
		)
			.then((resolved) => {
				if (active) {
					setAudio(resolved);
					setStatus(resolved ? "ready" : "missing");
				}
			})
			.catch(() => {
				if (active) {
					setAudio(null);
					setStatus("missing");
				}
			});
		return () => {
			active = false;
		};
	}, [cue, exactUrl, kind]);
	return { audio, status };
}
