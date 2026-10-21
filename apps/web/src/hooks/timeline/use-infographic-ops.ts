/* Maleo — infographic (data-callout) overlay ops for the timeline editor: add a
 * default callout of a type, add a fully-formed mined payload, patch a payload,
 * or remove one. Placement defaults to the playhead. Clip-native: mutates the
 * canonical document's `clips[]` through `mutateDoc` (undo-precise). */
import type { Dispatch, SetStateAction } from "react";
import type { InfographicOverlay, InfographicPayload, InfographicStyle } from "@maleo/shared";
import { defaultInfographicPayload } from "@models/presets/generation-defaults.ts";
import { clipId } from "@models/timeline/timeline-clips.ts";
import type { EditorDoc } from "@stores/timeline-document-store.ts";
import type { PlayheadHandle } from "@models/timeline/playhead-handle.ts";
import {
	infographicClipOf,
	withClipInserted,
	withClipPatched,
	withClipRemoved,
} from "@maleo/shared";

export interface InfographicOps {
	addInfographic: (
		type?: InfographicPayload["type"],
		at?: number,
		track?: number,
		style?: Partial<InfographicStyle>,
	) => void;
	addInfographicPayload: (
		payload: InfographicPayload,
		at?: number,
		track?: number,
		dur?: number,
		style?: Partial<InfographicStyle>,
	) => void;
	updateInfographicPayload: (id: number, payload: InfographicPayload) => void;
	removeInfographic: (id: number) => void;
}

export function useInfographicOps(input: {
	mutateDoc: (edit: (doc: EditorDoc) => EditorDoc) => void;
	playhead: PlayheadHandle;
	total: number;
	infographicStyle: InfographicStyle;
	selectedInfographicId: number | null;
	setSelectedInfographicId: Dispatch<SetStateAction<number | null>>;
	infographicEditId: number | null;
	setInfographicEditId: Dispatch<SetStateAction<number | null>>;
	seekPreview: (t: number) => void;
}): InfographicOps {
	const {
		mutateDoc,
		playhead,
		total,
		infographicStyle,
		selectedInfographicId,
		setSelectedInfographicId,
		infographicEditId,
		setInfographicEditId,
		seekPreview,
	} = input;

	// Insert a fully-built infographic overlay as a clip, select it, and seek to it.
	const place = (g: InfographicOverlay): void => {
		mutateDoc((doc) => withClipInserted(doc, infographicClipOf(g)));
		setSelectedInfographicId(g.id);
		seekPreview(g.start);
	};
	const addInfographic = (
		type: InfographicPayload["type"] = "bar_chart",
		at?: number,
		track?: number,
		style: Partial<InfographicStyle> = infographicStyle,
	): void => {
		const start = at ?? Math.max(0, Math.min(playhead.get(), Math.max(0, total - 4)));
		place({
			id: Date.now(),
			start,
			dur: 4,
			track: track ?? 0,
			layout: { xPct: 8, yPct: 16, widthPct: 84, fit: "contain" },
			animation: {
				in: "slide_up",
				main: type === "stat_reveal" || type === "price_tag" ? "count" : "build",
				out: "fade",
			},
			payload: defaultInfographicPayload(type),
			style: { ...style },
		});
	};
	// Add a fully-formed payload (auto-mined stat suggestion) at the playhead.
	const addInfographicPayload = (
		payload: InfographicPayload,
		at?: number,
		track?: number,
		dur = 3.5,
		style: Partial<InfographicStyle> = infographicStyle,
	): void => {
		const start = at ?? Math.max(0, Math.min(playhead.get(), Math.max(0, total - 4)));
		place({
			id: Date.now(),
			start,
			dur,
			track: track ?? 0,
			layout: { xPct: 8, yPct: 16, widthPct: 84, fit: "contain" },
			animation: {
				in: "slide_up",
				main: payload.type === "stat_reveal" || payload.type === "price_tag" ? "count" : "build",
				out: "fade",
			},
			payload,
			style: { ...style },
		});
	};
	const updateInfographicPayload = (id: number, payload: InfographicPayload): void =>
		mutateDoc((doc) =>
			withClipPatched(doc, clipId("infographic", id), (c) => ({
				...c,
				infographic: { ...c.infographic!, payload },
			})),
		);
	const removeInfographic = (id: number): void => {
		mutateDoc((doc) => withClipRemoved(doc, clipId("infographic", id)));
		if (selectedInfographicId === id) setSelectedInfographicId(null);
		if (infographicEditId === id) setInfographicEditId(null);
	};
	return { addInfographic, addInfographicPayload, updateInfographicPayload, removeInfographic };
}
