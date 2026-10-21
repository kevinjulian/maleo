/* Reusable timeline shapes: timeline templates, motion presets and clip templates.
 *
 * Workspace-scoped library rows, not project content — a project reads them to seed
 * a timeline and never writes them back. */
import { del, get, post, put } from "./client.ts";
import type {
	ClipTemplate,
	ClipTemplateInput,
	MotionPreset,
	MotionPresetInput,
	TimelineTemplate,
	TimelineTemplateInput,
	CompositionLayer,
} from "@maleo/shared";
import { BASE } from "./base.ts";
import { compositionFromOverlays } from "@models/clip-templates/composition-overlays.ts";

export async function listTimelineTemplates(): Promise<TimelineTemplate[]> {
	return (await get<{ items: TimelineTemplate[] }>(`${BASE}/timeline-templates`)).items;
}

export async function createTimelineTemplate(
	input: TimelineTemplateInput,
): Promise<TimelineTemplate> {
	return (await post<{ item: TimelineTemplate }>(`${BASE}/timeline-templates`, input)).item;
}

export async function updateTimelineTemplate(
	id: string,
	input: TimelineTemplateInput,
): Promise<TimelineTemplate> {
	return (
		await put<{ item: TimelineTemplate }>(
			`${BASE}/timeline-templates/${encodeURIComponent(id)}`,
			input,
		)
	).item;
}

export async function listMotionPresets(): Promise<MotionPreset[]> {
	return (await get<{ items: MotionPreset[] }>(`${BASE}/motion-presets`)).items;
}

export async function createMotionPreset(input: MotionPresetInput): Promise<MotionPreset> {
	return (await post<{ item: MotionPreset }>(`${BASE}/motion-presets`, input)).item;
}

export async function updateMotionPreset(
	id: string,
	input: MotionPresetInput,
): Promise<MotionPreset> {
	return (
		await put<{ item: MotionPreset }>(`${BASE}/motion-presets/${encodeURIComponent(id)}`, input)
	).item;
}

export async function deleteMotionPreset(id: string): Promise<void> {
	await del(`${BASE}/motion-presets/${encodeURIComponent(id)}`);
}

export async function listClipTemplates(): Promise<ClipTemplate[]> {
	return (await get<{ items: ClipTemplate[] }>(`${BASE}/clip-templates`)).items;
}

export async function createClipTemplate(input: ClipTemplateInput): Promise<ClipTemplate> {
	return (await post<{ item: ClipTemplate }>(`${BASE}/clip-templates`, input)).item;
}

export async function updateClipTemplate(
	id: string,
	input: ClipTemplateInput,
): Promise<ClipTemplate> {
	return (
		await put<{ item: ClipTemplate }>(`${BASE}/clip-templates/${encodeURIComponent(id)}`, input)
	).item;
}

export async function deleteClipTemplate(id: string): Promise<void> {
	await del(`${BASE}/clip-templates/${encodeURIComponent(id)}`);
}

export interface TimelineTemplatePreviewAudio {
	url: string;
	title?: string;
	author?: string;
	durationSec?: number;
}

export async function resolveTimelineTemplatePreviewSfx(
	cue: string,
): Promise<TimelineTemplatePreviewAudio | null> {
	return (
		await get<{ audio: TimelineTemplatePreviewAudio | null }>(
			`${BASE}/timeline-templates/preview-sfx?cue=${encodeURIComponent(cue)}`,
		)
	).audio;
}

export async function resolveTimelineTemplatePreviewMusic(
	cue: string,
): Promise<TimelineTemplatePreviewAudio | null> {
	return (
		await get<{ audio: TimelineTemplatePreviewAudio | null }>(
			`${BASE}/timeline-templates/preview-music?cue=${encodeURIComponent(cue)}`,
		)
	).audio;
}

/* Saving a composition is a clip-template write, so it lives beside
 * createClipTemplate / updateClipTemplate rather than in a one-function module
 * that would import its sibling. The serialization it calls is pure and sits in
 * models/clip-templates/composition-overlays.ts.
 *
 * Targets `id` when given (Studio edit), else overwrites by name, else creates.
 * Saving under an existing composition's name overwrites it — that IS the
 * update flow (place, tweak, re-save). */
export async function saveCompositionTemplate(
	name: string,
	overlays: CompositionLayer[],
	id?: string,
): Promise<ClipTemplate> {
	const config = compositionFromOverlays(overlays);
	const input = {
		kind: "composition" as const,
		label: name,
		intent: `${overlays.length} layer${overlays.length === 1 ? "" : "s"} motion`,
		category: "text" as const,
		base: "composition",
		config,
	};
	if (id) return updateClipTemplate(id, input);
	const existing = (await listClipTemplates()).find(
		(t) => t.kind === "composition" && t.label.toLowerCase() === name.toLowerCase(),
	);
	return existing ? updateClipTemplate(existing.id, input) : createClipTemplate(input);
}
