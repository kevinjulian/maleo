/* Selecting a clip seeks the preview ONLY when the playhead is outside the
 * clip, which means the decision runs on the clip's duration — looked up by
 * family. `selectFreeClip`'s signature used to omit `"effect"` entirely, and the
 * timeline's click handler asserted the narrowing away, so an effect clip fell
 * through the family ternary to another family's arm and took the duration of
 * whichever clip happened to share its refId.
 *
 * The first test below puts a text overlay and an effect on the same refId with
 * different durations and a playhead inside the effect, so a fall-through seeks
 * and the correct lookup does not.
 *
 * `useSelectionActions` is a plain factory over injected setters, so it runs
 * outside React — the same shape `use-visual-clip-ops.test.ts` relies on. */
import { describe, expect, test } from "vite-plus/test";
import { useSelectionActions, type SelectionActionsInput } from "./use-selection-actions.ts";
import { EMPTY_SELECTION } from "@models/timeline/selection-model.ts";

function harness(over: Partial<SelectionActionsInput> = {}) {
	const seeks: number[] = [];
	let playheadAt = 0;
	const noop = (): void => {};
	const input = {
		scenes: [],
		overlays: [],
		audioOverlays: [],
		videoOverlays: [],
		effects: [],
		setScenes: noop,
		setSelection: noop,
		setPreviewSceneId: noop,
		setInspectorOpen: noop,
		setRail: noop,
		setPanelOpen: noop,
		sceneStart: () => 0,
		seekPreview: (sec: number) => {
			seeks.push(sec);
		},
		playhead: { get: () => playheadAt },
		selectedFreeIds: new Set<string>(),
		selectedFreeId: null,
		chat: [],
		removeVideoOverlay: noop,
		removeOverlay: noop,
		removeAudio: noop,
		removeEffect: noop,
		...over,
	} as unknown as SelectionActionsInput;
	return {
		actions: useSelectionActions(input),
		seeks,
		setPlayhead: (sec: number) => {
			playheadAt = sec;
		},
	};
}

describe("selectFreeClip — the duration it decides the seek from", () => {
	test("an effect clip uses its own duration, not a text overlay sharing its refId", () => {
		const h = harness({
			// Same refId, different durations. Families are numbered independently,
			// so a collision here is ordinary rather than contrived.
			effects: [{ id: 7, effect: "shake", start: 10, dur: 6 }],
			overlays: [{ id: 7, content: "", preset: "plain", start: 0, dur: 1 }],
		} as unknown as Partial<SelectionActionsInput>);

		h.setPlayhead(12); // inside the effect (10..16), outside the text overlay (0..1)
		h.actions.selectFreeClip("effect", 7, 10);

		// Reading the text overlay's dur of 1 would place the playhead outside the
		// clip and seek back to its start, yanking the preview off the effect.
		expect(h.seeks).toEqual([]);
	});

	test("still seeks when the playhead really is outside the effect", () => {
		const h = harness({
			effects: [{ id: 7, effect: "shake", start: 10, dur: 6 }],
		} as unknown as Partial<SelectionActionsInput>);

		h.setPlayhead(40);
		h.actions.selectFreeClip("effect", 7, 10);

		expect(h.seeks).toEqual([10]);
	});

	test("an unknown refId seeks, because no duration is known", () => {
		const h = harness();

		h.setPlayhead(3);
		h.actions.selectFreeClip("effect", 999, 10);

		expect(h.seeks).toEqual([10]);
	});
});

describe("selection model wiring", () => {
	test("EMPTY_SELECTION is the shape the actions clear to", () => {
		expect(EMPTY_SELECTION.sceneId).toBeUndefined();
	});
});
