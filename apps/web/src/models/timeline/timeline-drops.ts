/* Maleo — timeline drag-and-drop payload parsers. Pure readers over a
 * DragEvent's dataTransfer: media assets, data callouts, and clip-template
 * payloads, plus a cheap type-probe. No component state, so they live apart
 * from the editor. */
import type { DragEvent } from "react";
import {
	CLIP_TEMPLATE_DND_MIME,
	DATA_CALLOUT_DND_MIME,
	MEDIA_DND_AUDIO_KIND,
	MEDIA_DND_DUR,
	MEDIA_DND_ID,
	MEDIA_DND_KIND,
	MEDIA_DND_LABEL,
	MEDIA_DND_MIME,
	MEDIA_DND_REF_ENTITY,
	MEDIA_DND_SOURCE,
	MEDIA_DND_THUMB,
	type MediaAsset,
} from "./editor-media.ts";
import { defaultInfographicPayload } from "@models/presets/generation-defaults.ts";
import type { InfographicPayload, TextPreset, TemplateParams } from "@maleo/shared";
import type { CompositionConfig } from "@models/clip-templates/composition-config.ts";
import { isAudioOverlayKind, normalizeAudioOrigin } from "@maleo/shared/audio-overlays";
import type { AudioOrigin, AudioOverlayKind } from "@maleo/shared/audio-overlays";
import { oneOf } from "@maleo/shared";

export interface MediaDropInfo {
	url: string;
	kind: "image" | "video" | "audio";
	dur?: number;
	label?: string;
	thumb?: string;
	/** Set when the drag came from a surface whose asset is already admitted.
	 *  Absent for a stock or reference result, which admission names. */
	mediaAssetId?: string;
	/** Where the asset came from, which is what the project records about it —
	 *  distinct from `origin`, which is the audio pipeline's notion. */
	source?: MediaAsset["source"];
	origin?: AudioOrigin;
	/** Which audio track the asset belongs on. Only meaningful when `kind` is
	 *  `"audio"`; absent means the caller's own default. */
	audioKind?: AudioOverlayKind;
	/** The workspace entity a reference image came from, recorded on the asset
	 *  the drop admits. Placing does not attach the entity — see the reference
	 *  library spec; this is provenance, not a selection. */
	referenceEntityId?: string;
}

const MEDIA_SOURCES: MediaAsset["source"][] = ["generated", "stock", "upload", "reference"];

function readSource(raw: string): MediaAsset["source"] | undefined {
	return oneOf(raw, MEDIA_SOURCES);
}

export function readMediaDrop(e: DragEvent): MediaDropInfo | null {
	const url = e.dataTransfer.getData(MEDIA_DND_MIME);
	if (!url) return null;
	const kindRaw = e.dataTransfer.getData(MEDIA_DND_KIND);
	const kind = kindRaw === "video" ? "video" : kindRaw === "audio" ? "audio" : "image";
	const durRaw = Number(e.dataTransfer.getData(MEDIA_DND_DUR));
	const source = e.dataTransfer.getData(MEDIA_DND_SOURCE);
	const audioKind = e.dataTransfer.getData(MEDIA_DND_AUDIO_KIND);
	return {
		url,
		kind,
		dur: Number.isFinite(durRaw) && durRaw > 0 ? Math.round(durRaw * 100) / 100 : undefined,
		label: e.dataTransfer.getData(MEDIA_DND_LABEL) || undefined,
		thumb: e.dataTransfer.getData(MEDIA_DND_THUMB) || undefined,
		mediaAssetId: e.dataTransfer.getData(MEDIA_DND_ID) || undefined,
		source: readSource(source),
		origin: normalizeAudioOrigin(source),
		audioKind: isAudioOverlayKind(audioKind) ? audioKind : undefined,
		referenceEntityId: e.dataTransfer.getData(MEDIA_DND_REF_ENTITY) || undefined,
	};
}

const dataCalloutTypes: InfographicPayload["type"][] = [
	"stat_reveal",
	"bar_chart",
	"line_chart",
	"area_chart",
	"pie_chart",
	"donut_chart",
	"progress_bars",
	"circular_progress",
	"table_build",
	"price_tag",
	"social_proof",
	"urgency",
];
export function readDataCalloutDrop(e: DragEvent): InfographicPayload | null {
	const raw = e.dataTransfer.getData(DATA_CALLOUT_DND_MIME);
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as Partial<InfographicPayload>;
		const type = oneOf(parsed.type, dataCalloutTypes);
		return type ? defaultInfographicPayload(type) : null;
	} catch {
		return null;
	}
}

// Clip Templates panel drag payload: a text preset (optionally with custom
// params), a fully-formed infographic payload, or a saved layered composition —
// tagged by `kind` so the drop handler routes it to the right overlay system
// without re-deriving the template.
export type TemplateDropInfo =
	| { kind: "text"; preset: TextPreset; params?: TemplateParams }
	| { kind: "data"; payload: InfographicPayload }
	| { kind: "composition"; config: CompositionConfig; label?: string };
export function readTemplateDrop(e: DragEvent): TemplateDropInfo | null {
	const raw = e.dataTransfer.getData(CLIP_TEMPLATE_DND_MIME);
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		if (parsed.kind === "text" && typeof parsed.preset === "string") {
			// SAFETY: this app wrote the payload one drag ago — `customDragPayload`
			// and the built-in tiles both serialize `{ kind, preset, params }` into
			// the same private MIME type, which nothing outside the page can set.
			// `kind` and `preset` are checked above; `params` is the preset's own
			// JSON, unread here and handed to the overlay that understands it.
			return {
				kind: "text",
				preset: parsed.preset as TextPreset,
				params: parsed.params as TemplateParams | undefined,
			};
		}
		if (parsed.kind === "data" && parsed.payload)
			return { kind: "data", payload: parsed.payload as InfographicPayload };
		if (parsed.kind === "composition" && parsed.config)
			return {
				kind: "composition",
				config: parsed.config as CompositionConfig,
				label: typeof parsed.label === "string" ? parsed.label : undefined,
			};
		return null;
	} catch {
		return null;
	}
}

export function hasTimelineExternalDrag(e: DragEvent): boolean {
	return (
		e.dataTransfer.types.includes("Files") ||
		e.dataTransfer.types.includes(MEDIA_DND_MIME) ||
		e.dataTransfer.types.includes(DATA_CALLOUT_DND_MIME) ||
		e.dataTransfer.types.includes(CLIP_TEMPLATE_DND_MIME)
	);
}
