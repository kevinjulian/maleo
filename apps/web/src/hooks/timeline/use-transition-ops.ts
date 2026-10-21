/* Maleo — transition CRUD for the timeline editor. A transition is keyed by the
 * (fromClipId, toClipId) pair; these helpers find/upsert/patch/remove it. Reads come
 * off the current transition view; writes mutate the canonical document's `clips[]`
 * (transition clips, id `trans:<id>`) through `mutateDoc` (undo-precise). */
import type { TransitionClip } from "@maleo/shared";
import { clipId } from "@models/timeline/timeline-clips.ts";
import type { EditorDoc } from "@stores/timeline-document-store.ts";
import {
	transitionClipOf,
	withClipInserted,
	withClipPatched,
	withoutTransitions,
} from "@maleo/shared";

export interface TransitionOps {
	transAt: (fromClipId: string, toClipId: string) => TransitionClip | undefined;
	transAtScene: (fromSceneId: number, toSceneId: number) => TransitionClip | undefined;
	upsertTransition: (
		fromClipId: string,
		toClipId: string,
		patch: Partial<TransitionClip>,
	) => number;
	updateTransition: (id: number, patch: Partial<TransitionClip>) => void;
	removeTransition: (id: number) => void;
}

export function useTransitionOps(
	transitions: TransitionClip[],
	mutateDoc: (edit: (doc: EditorDoc) => EditorDoc) => void,
): TransitionOps {
	const transAt = (fromClipId: string, toClipId: string): TransitionClip | undefined =>
		transitions.find((t) => t.fromClipId === fromClipId && t.toClipId === toClipId);
	// Convenience for scene↔scene transitions (the common case): wrap scene ids as clip ids.
	const transAtScene = (fromSceneId: number, toSceneId: number): TransitionClip | undefined =>
		transAt(clipId("scene", fromSceneId), clipId("scene", toSceneId));
	// Patch a transition clip's payload + mirror its dur onto the clip's durationSec.
	const patchTransition = (id: number, patch: Partial<TransitionClip>): void =>
		mutateDoc((doc) =>
			withClipPatched(doc, `trans:${id}`, (c) => {
				const next = { ...c.transition!, ...patch };
				return { ...c, transition: next, durationSec: next.dur };
			}),
		);
	const upsertTransition = (
		fromClipId: string,
		toClipId: string,
		patch: Partial<TransitionClip>,
	): number => {
		const ex = transAt(fromClipId, toClipId);
		if (ex) {
			patchTransition(ex.id, patch);
			return ex.id;
		}
		const id = Date.now();
		mutateDoc((doc) =>
			withClipInserted(
				doc,
				transitionClipOf({ id, fromClipId, toClipId, type: "fade", dur: 0.8, ...patch }),
			),
		);
		return id;
	};
	const updateTransition = (id: number, patch: Partial<TransitionClip>): void =>
		patchTransition(id, patch);
	const removeTransition = (id: number): void =>
		mutateDoc((doc) => withoutTransitions(doc, new Set([id])));
	return { transAt, transAtScene, upsertTransition, updateTransition, removeTransition };
}
