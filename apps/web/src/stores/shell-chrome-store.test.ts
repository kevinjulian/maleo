import { describe, expect, test } from "vite-plus/test";
import { createShellChromeStore, DEFAULT_SHELL_CHROME } from "./shell-chrome-store.ts";

describe("shell chrome store", () => {
	test("starts from the defaults, overridden by what the caller seeds", () => {
		expect(createShellChromeStore().get()).toEqual(DEFAULT_SHELL_CHROME);
		expect(createShellChromeStore({ editorMode: "studio" }).get().editorMode).toBe("studio");
	});

	// The chat panel is open by default and the rail is closed; the shell used to
	// carry those as the initial arguments of two `useState` calls, and a default
	// that flips is a visible regression on every project.
	test("the panel defaults match what the shell rendered", () => {
		const chrome = createShellChromeStore().get();
		expect(chrome.chatOpen).toBe(true);
		expect(chrome.railOpen).toBe(false);
		expect(chrome.editorMode).toBe("timeline");
		expect(chrome.saveState).toBe("idle");
	});

	test("a patch notifies subscribers once", () => {
		const store = createShellChromeStore();
		let notified = 0;
		store.subscribe(() => {
			notified += 1;
		});
		store.patch("saveState", "saving");
		expect(store.get().saveState).toBe("saving");
		expect(notified).toBe(1);
	});

	// The render poll writes status on an interval. A write that lands the value
	// already there must not notify, or the whole shell re-renders on each tick.
	test("a patch to the same value does not notify", () => {
		const store = createShellChromeStore();
		let notified = 0;
		store.subscribe(() => {
			notified += 1;
		});
		store.patch("rendering", false);
		store.patch("saveState", "idle");
		store.patch("renderStatus", null);
		expect(notified).toBe(0);
	});

	test("set with an unchanged object does not notify", () => {
		const store = createShellChromeStore();
		let notified = 0;
		store.subscribe(() => {
			notified += 1;
		});
		store.set((c) => c);
		store.set({ ...store.get() });
		expect(notified).toBe(0);
	});

	test("a patch takes an updater, like a setState", () => {
		const store = createShellChromeStore();
		store.patch("exportMenuOpen", (open) => !open);
		expect(store.get().exportMenuOpen).toBe(true);
	});

	test("the chrome object is replaced, never mutated", () => {
		const store = createShellChromeStore();
		const before = store.get();
		store.patch("chatOpen", false);
		expect(store.get()).not.toBe(before);
		expect(before.chatOpen).toBe(true);
	});

	// `renderStatus` holds an object or null, and the poll re-sets it with a fresh
	// object each tick. Re-setting the same reference must not notify.
	test("an object-valued field patches to null and back", () => {
		const store = createShellChromeStore();
		let notified = 0;
		store.subscribe(() => {
			notified += 1;
		});
		const status = {
			id: "job-1",
			status: "running" as const,
			phase: "encoding",
			progress: 0.4,
			error: null,
		};
		store.patch("renderStatus", status);
		store.patch("renderStatus", status);
		expect(store.get().renderStatus).toBe(status);
		expect(notified).toBe(1);
		store.patch("renderStatus", null);
		expect(store.get().renderStatus).toBeNull();
		expect(notified).toBe(2);
	});

	// `saveError` is the one field where null and "" mean different things: null is
	// no error, and clearing it is what dismisses the banner.
	test("saveError clears back to null", () => {
		const store = createShellChromeStore();
		store.patch("saveError", "Could not create project");
		expect(store.get().saveError).toBe("Could not create project");
		store.patch("saveError", null);
		expect(store.get().saveError).toBeNull();
	});

	test("unsubscribing stops notifications", () => {
		const store = createShellChromeStore();
		let notified = 0;
		const off = store.subscribe(() => {
			notified += 1;
		});
		store.patch("creating", true);
		off();
		store.patch("creating", false);
		expect(notified).toBe(1);
	});
});
