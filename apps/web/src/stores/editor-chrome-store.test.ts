import { describe, expect, test } from "vite-plus/test";
import { createEditorChromeStore, DEFAULT_CHROME } from "./editor-chrome-store.ts";

describe("editor chrome store", () => {
	test("starts from the defaults, overridden by what the caller seeds", () => {
		expect(createEditorChromeStore().get()).toEqual(DEFAULT_CHROME);
		expect(createEditorChromeStore({ rail: "media" }).get().rail).toBe("media");
	});

	test("a patch notifies subscribers once", () => {
		const store = createEditorChromeStore();
		let notified = 0;
		store.subscribe(() => {
			notified += 1;
		});
		store.patch("rail", "style");
		expect(store.get().rail).toBe("style");
		expect(notified).toBe(1);
	});

	// The editor writes chrome from pointer handlers. A patch that lands the value
	// already there must not notify, or the timeline re-renders on every move.
	test("a patch to the same value does not notify", () => {
		const store = createEditorChromeStore();
		let notified = 0;
		store.subscribe(() => {
			notified += 1;
		});
		store.patch("rail", "chat");
		store.patch("panelOpen", true);
		expect(notified).toBe(0);
	});

	test("set with an unchanged object does not notify", () => {
		const store = createEditorChromeStore();
		let notified = 0;
		store.subscribe(() => {
			notified += 1;
		});
		store.set((c) => c);
		store.set({ ...store.get() });
		expect(notified).toBe(0);
	});

	test("a patch takes an updater, like a setState", () => {
		const store = createEditorChromeStore();
		store.patch("panelOpen", (open) => !open);
		expect(store.get().panelOpen).toBe(false);
	});

	test("the chrome object is replaced, never mutated", () => {
		const store = createEditorChromeStore();
		const before = store.get();
		store.patch("clipTab", "timing");
		expect(store.get()).not.toBe(before);
		expect(before.clipTab).toBe("content");
	});

	// The popover fields hold an object or null. A patch back to null must land,
	// and re-setting the same object reference must not notify — a popover that
	// re-notified on every render would re-run the timeline's subscribers.
	test("an object-valued field patches to null and back", () => {
		const store = createEditorChromeStore();
		let notified = 0;
		store.subscribe(() => {
			notified += 1;
		});
		const target = { id: 3 };
		store.patch("effectEdit", target);
		store.patch("effectEdit", target);
		expect(store.get().effectEdit).toBe(target);
		expect(notified).toBe(1);
		store.patch("effectEdit", null);
		expect(store.get().effectEdit).toBeNull();
		expect(notified).toBe(2);
	});

	// previewSceneId starts undefined rather than at the first scene: the store
	// does not know the document, and the editor's own effect settles it.
	test("the preview scene starts unset", () => {
		expect(createEditorChromeStore().get().previewSceneId).toBeUndefined();
		expect(createEditorChromeStore().get().playbackRate).toBe(1);
	});

	test("unsubscribing stops notifications", () => {
		const store = createEditorChromeStore();
		let notified = 0;
		const off = store.subscribe(() => {
			notified += 1;
		});
		store.patch("rail", "media");
		off();
		store.patch("rail", "elements");
		expect(notified).toBe(1);
	});
});
