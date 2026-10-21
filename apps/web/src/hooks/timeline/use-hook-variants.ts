/* Maleo — A/B hook takes: snapshot the first scene, restore one over it.
 *
 * Only the first scene is ever captured or replaced, because the hook is the
 * opening beat and that is the thing worth A/B-ing. Restoring keeps the live
 * scene's id, start and track so a take swaps content without moving the clip
 * the rest of the timeline is sequenced against.
 *
 * The popover's open state lives in TimelineTracks with the toolbar that owns
 * it; only the take list and these three actions are here. */
import type { Dispatch, SetStateAction } from "react";
import type { Scene } from "@maleo/shared";
import type { HookVariant } from "@models/content/content-types.ts";

export interface HookVariantOps {
	saveHookVariant: () => void;
	applyHookVariant: (variant: HookVariant) => void;
	removeHookVariant: (id: number) => void;
}

export function useHookVariants(args: {
	scenes: Scene[];
	setScenes: Dispatch<SetStateAction<Scene[]>>;
	setHookVariants: Dispatch<SetStateAction<HookVariant[]>>;
	seekPreview: (sec: number) => void;
}): HookVariantOps {
	const { scenes, setScenes, setHookVariants, seekPreview } = args;

	const saveHookVariant = (): void => {
		const first = scenes[0];
		if (!first) return;
		// Cloning is the point: a take must not alias the live scene it snapshots.
		setHookVariants((v) => [
			...v,
			{
				id: Date.now(),
				label: `Take ${String.fromCharCode(65 + (v.length % 26))}`,
				scene: structuredClone(first),
			},
		]);
	};

	const applyHookVariant = (variant: HookVariant): void => {
		// Cloned back out so restoring twice cannot alias one object into the timeline.
		setScenes((ss) =>
			ss.map((s, i) =>
				i === 0
					? {
							...structuredClone(variant.scene),
							id: ss[0]!.id,
							start: ss[0]!.start,
							track: ss[0]!.track,
						}
					: s,
			),
		);
		seekPreview(0);
	};

	const removeHookVariant = (id: number): void =>
		setHookVariants((v) => v.filter((x) => x.id !== id));

	return { saveHookVariant, applyHookVariant, removeHookVariant };
}
