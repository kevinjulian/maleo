/* The selection rules, written from the click handlers they used to live in.
 *
 * These are pinned first and deliberately: the cross-clearing rules were implicit
 * in four call sites, a wrong one is invisible to a typecheck and to a render
 * test, and the point of the extraction is that they stop being implicit. */
import { describe, expect, test } from "vite-plus/test";
import {
	selectionsEqual,
	clearSelection,
	clipKey,
	EMPTY_SELECTION,
	isClipSelected,
	isEmptySelection,
	openSceneEditor,
	primaryClipKey,
	selectClip,
	selectScene,
	selectTransition,
	toggleClip,
} from "./selection-model.ts";

describe("selecting one kind clears the others", () => {
	test("a scene replaces any clip selection and closes the drawer", () => {
		const withClip = openSceneEditor(1);
		const next = selectScene(2);

		expect(withClip.editorSceneId).toBe(1);
		expect(next.sceneId).toBe(2);
		expect(next.editorSceneId).toBeUndefined();
		expect(primaryClipKey(next)).toBeNull();
	});

	test("a clip replaces a scene selection", () => {
		const next = selectClip("video", 7);

		expect(next.sceneId).toBeUndefined();
		expect(next.videoOverlayId).toBe(7);
		expect(primaryClipKey(next)).toBe("video:7");
	});

	test("each clip family clears the other three", () => {
		const text = selectClip("text", 1);
		expect([text.videoOverlayId, text.audioId, text.infographicId]).toEqual([null, null, null]);

		const audio = selectClip("audio", 2);
		expect([audio.videoOverlayId, audio.overlayId, audio.infographicId]).toEqual([
			null,
			null,
			null,
		]);

		const info = selectClip("infographic", 3);
		expect([info.videoOverlayId, info.overlayId, info.audioId]).toEqual([null, null, null]);
	});

	test("an effect selects like any other clip family", () => {
		const next = selectClip("effect", 6);

		expect(next.effectId).toBe(6);
		expect(primaryClipKey(next)).toBe("effect:6");
		expect([next.videoOverlayId, next.overlayId, next.audioId, next.infographicId]).toEqual([
			null,
			null,
			null,
			null,
		]);
	});

	test("selecting a clip replaces the multi-select set rather than adding to it", () => {
		const many = toggleClip(toggleClip(EMPTY_SELECTION, "video", 1), "audio", 2);
		expect(many.freeIds.size).toBe(2);

		const single = selectClip("text", 9);
		expect([...single.freeIds]).toEqual(["text:9"]);
	});

	test("a transition selection stands alone", () => {
		const next = selectTransition(4);

		expect(next.transitionId).toBe(4);
		expect(primaryClipKey(next)).toBeNull();
		expect(next.sceneId).toBeUndefined();
	});
});

describe("shift-click toggling", () => {
	test("adds a clip and makes it primary", () => {
		const next = toggleClip(EMPTY_SELECTION, "video", 1);

		expect([...next.freeIds]).toEqual(["video:1"]);
		expect(next.videoOverlayId).toBe(1);
	});

	test("removes a clip that was already in the set", () => {
		const added = toggleClip(EMPTY_SELECTION, "video", 1);
		const removed = toggleClip(added, "video", 1);

		expect(removed.freeIds.size).toBe(0);
	});

	test("accumulates across families", () => {
		const next = toggleClip(toggleClip(EMPTY_SELECTION, "video", 1), "text", 2);

		expect([...next.freeIds].sort()).toEqual(["text:2", "video:1"]);
	});

	test("clears the scene selection and the drawer", () => {
		const next = toggleClip(openSceneEditor(3), "video", 1);

		expect(next.sceneId).toBeUndefined();
		expect(next.editorSceneId).toBeUndefined();
	});

	/* Recorded, not corrected: `selectClip` clears all four families, but the
	 * toggle path clears only three — an infographic stays primary through a
	 * shift-click on another family. It reads as an oversight rather than a
	 * decision, and changing it changes what the inspector shows, so it is pinned
	 * here and left for a deliberate call. */
	test("does NOT clear a primary infographic, unlike single-click", () => {
		const withInfographic = selectClip("infographic", 5);
		const next = toggleClip(withInfographic, "video", 1);

		expect(next.infographicId).toBe(5);
		expect(next.videoOverlayId).toBe(1);
	});
});

describe("what counts as selected", () => {
	test("a clip is selected when primary or in the set", () => {
		const primary = selectClip("audio", 4);
		expect(isClipSelected(primary, "audio:4")).toBe(true);
		expect(isClipSelected(primary, "audio:5")).toBe(false);

		const multi = toggleClip(toggleClip(EMPTY_SELECTION, "video", 1), "text", 2);
		expect(isClipSelected(multi, "video:1")).toBe(true);
		expect(isClipSelected(multi, "text:2")).toBe(true);
	});

	test("the primary key follows a fixed family order", () => {
		expect(primaryClipKey(selectClip("video", 1))).toBe("video:1");
		expect(primaryClipKey(selectClip("text", 1))).toBe("text:1");
		expect(primaryClipKey(selectClip("audio", 1))).toBe("audio:1");
		expect(primaryClipKey(selectClip("infographic", 1))).toBe("infographic:1");
	});

	test("clip keys are the ids the timeline already uses", () => {
		expect(clipKey("video", 3)).toBe("video:3");
	});
});

describe("clearing", () => {
	test("empty space clears everything", () => {
		const next = clearSelection();

		expect(isEmptySelection(next)).toBe(true);
		expect(next.freeIds.size).toBe(0);
		expect(next.editorSceneId).toBeUndefined();
	});

	test("a scene, a clip, a transition and a multi-select all count as non-empty", () => {
		expect(isEmptySelection(selectScene(1))).toBe(false);
		expect(isEmptySelection(selectClip("video", 1))).toBe(false);
		expect(isEmptySelection(selectTransition(1))).toBe(false);
		expect(isEmptySelection(toggleClip(EMPTY_SELECTION, "scene", 1))).toBe(false);
	});
});

describe("immutability", () => {
	test("a transition returns a new selection rather than mutating", () => {
		const before = selectClip("video", 1);
		const after = toggleClip(before, "text", 2);

		expect(before.overlayId).toBeNull();
		expect(after.overlayId).toBe(2);
		expect(before.freeIds.has("text:2")).toBe(false);
	});
});

describe("equality", () => {
	test("selecting the same clip twice says the same thing", () => {
		expect(selectionsEqual(selectClip("video", 1), selectClip("video", 1))).toBe(true);
	});

	test("a different clip, kind or scene is a different selection", () => {
		expect(selectionsEqual(selectClip("video", 1), selectClip("video", 2))).toBe(false);
		expect(selectionsEqual(selectClip("video", 1), selectClip("text", 1))).toBe(false);
		expect(selectionsEqual(selectScene(1), selectScene(2))).toBe(false);
	});

	test("the multi-select set is compared by membership, not by identity", () => {
		const a = toggleClip(selectClip("video", 1), "text", 2);
		const b = toggleClip(selectClip("video", 1), "text", 2);
		expect(a.freeIds).not.toBe(b.freeIds);
		expect(selectionsEqual(a, b)).toBe(true);
		expect(selectionsEqual(a, toggleClip(a, "audio", 3))).toBe(false);
	});

	test("an emptied selection equals a cleared one", () => {
		expect(selectionsEqual(clearSelection(), EMPTY_SELECTION)).toBe(true);
	});
});
