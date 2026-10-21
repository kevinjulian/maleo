/* Maleo — effect-clip ops for the timeline editor: add a single effect at the
 * playhead (or a given time), remove one, or auto-inject pattern interrupts
 * across the reel. Clip-native: mutates the canonical document's `clips[]` through
 * `mutateDoc` (undo-precise) instead of a legacy effect array. */
import type { EffectKind } from "@maleo/shared";
import { EFFECT_DEFS } from "@models/timeline/editor-media.ts";
import { autoPatternInterrupts } from "@models/timeline/effects.ts";
import { clipId } from "@models/timeline/timeline-clips.ts";
import type { EditorDoc } from "@stores/timeline-document-store.ts";
import type { PlayheadHandle } from "@models/timeline/playhead-handle.ts";
import { docEffects, effectClipOf, withClipInserted, withClipRemoved } from "@maleo/shared";

export interface EffectOps {
	addEffect: (kind: EffectKind, at?: number, track?: number) => void;
	removeEffect: (id: number) => void;
	addAutoInterrupts: (intervalSec: number) => void;
}

export function useEffectOps(input: {
	mutateDoc: (edit: (doc: EditorDoc) => EditorDoc) => void;
	playhead: PlayheadHandle;
	total: number;
}): EffectOps {
	const { mutateDoc, playhead, total } = input;
	const addEffect = (kind: EffectKind, at?: number, track?: number): void => {
		const def = EFFECT_DEFS.find((d) => d.kind === kind);
		const dur = def?.dur ?? 1;
		const start = at ?? Math.max(0, Math.min(playhead.get(), Math.max(0, total - dur)));
		mutateDoc((doc) =>
			withClipInserted(
				doc,
				effectClipOf({ id: Date.now(), effect: kind, start, dur, track: track ?? 0 }),
			),
		);
	};
	const removeEffect = (id: number): void =>
		mutateDoc((doc) => withClipRemoved(doc, clipId("effect", id)));
	// Pattern interrupts: inject alternating zoom_punch/flash/whip_pan every N sec,
	// skipping spots that already have one nearby.
	const addAutoInterrupts = (intervalSec: number): void =>
		mutateDoc((doc) =>
			autoPatternInterrupts(total, intervalSec, docEffects(doc), Date.now()).reduce(
				(d, e) => withClipInserted(d, effectClipOf(e)),
				doc,
			),
		);
	return { addEffect, removeEffect, addAutoInterrupts };
}
