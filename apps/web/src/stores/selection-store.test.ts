import { describe, expect, test } from "vite-plus/test";
import { createSelectionStore } from "./selection-store.ts";
import {
	clearSelection,
	selectClip,
	selectScene,
	toggleClip,
} from "@models/timeline/selection-model.ts";

describe("selection store", () => {
	test("reads back what was set", () => {
		const store = createSelectionStore();
		store.set(selectClip("video", 3));
		expect(store.get().videoOverlayId).toBe(3);
	});

	test("notifies subscribers on a change", () => {
		const store = createSelectionStore();
		let notified = 0;
		store.subscribe(() => {
			notified += 1;
		});
		store.set(selectClip("video", 1));
		store.set(selectClip("video", 2));
		expect(notified).toBe(2);
	});

	test("selecting what is already selected notifies nobody", () => {
		const store = createSelectionStore(selectClip("audio", 7));
		let notified = 0;
		store.subscribe(() => {
			notified += 1;
		});
		store.set(selectClip("audio", 7));
		expect(notified).toBe(0);
		// And the stored reference is kept, so a memo keyed on it still holds.
		expect(store.get().audioId).toBe(7);
	});

	test("an updater sees the current selection", () => {
		const store = createSelectionStore(selectClip("video", 1));
		store.set((prev) => toggleClip(prev, "text", 2));
		expect(store.get().freeIds.has("video:1")).toBe(true);
		expect(store.get().freeIds.has("text:2")).toBe(true);
	});

	test("unsubscribing stops the notifications", () => {
		const store = createSelectionStore();
		let notified = 0;
		const off = store.subscribe(() => {
			notified += 1;
		});
		store.set(selectScene(1));
		off();
		store.set(clearSelection());
		expect(notified).toBe(1);
		expect(store.get().sceneId).toBeUndefined();
	});
});
