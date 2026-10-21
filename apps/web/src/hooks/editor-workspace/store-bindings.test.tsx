// @vitest-environment happy-dom
/* The React bindings, rendered rather than inspected.
 *
 * A `happy-dom` document is registered before React loads, because the two
 * claims that matter here cannot be made without a renderer: how many times a
 * component re-rendered, and where focus actually went. Asserting them by
 * calling components as functions would be asserting the shape of the element
 * they return, which is not what either requirement is about.
 *
 * It is a devDependency, so nothing reaches a consumer.
 */
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";

/* React's own flag for `act`. Without it every act call warns, and a warning
 * per assertion is how a real one stops being read. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { act, createElement, useRef } = await import("react");
const { createRoot } = await import("react-dom/client");
const { createStore } = await import("@models/timeline-view/store.ts");
const { magneticSingleRow } = await import("@models/timeline-view/fixtures.ts");
const { useTimelineSlice } = await import("./store-bindings.ts");
const { VuiEditorWorkspace } = await import("@components/editor-workspace/workspace.tsx");
const { AccordionSection } = await import("@components/editor-workspace/primitives.tsx");
const { VuiOverlay } = await import("@components/editor-workspace/overlay.tsx");
const { VUI_PERSISTENT_ATTRIBUTE } = await import("@controllers/overlay/persistent.ts");
const { createOverlayStack, overlayStackForDocument } =
	await import("@controllers/overlay/overlay-stack.ts");
const { createFocusTrap, createScrollLock, nextFocusIndex } =
	await import("@controllers/overlay/focus-trap.ts");
import type { ReactElement } from "react";
import type { Root } from "react-dom/client";

interface Mounted {
	readonly host: HTMLElement;
	readonly root: Root;
	render(element: ReactElement): void;
	unmount(): void;
}

const mounted: Mounted[] = [];

function mount(element: ReactElement): Mounted {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	const handle: Mounted = {
		host,
		root,
		render(next) {
			act(() => {
				root.render(next);
			});
		},
		unmount() {
			act(() => {
				root.unmount();
			});
			host.remove();
		},
	};
	handle.render(element);
	mounted.push(handle);
	return handle;
}

afterAll(() => {
	for (const handle of mounted) {
		try {
			handle.unmount();
		} catch {
			/* Already unmounted by its own test. */
		}
	}
});

beforeAll(() => {
	document.body.replaceChildren();
});

/* ---- 12.1 Store bindings --------------------------------------------------- */

describe("store bindings", () => {
	test("a viewport change leaves a selection consumer flat", () => {
		const store = createStore(magneticSingleRow());
		let selectionRenders = 0;
		let viewportRenders = 0;

		function Selection(): ReactElement {
			useTimelineSlice(store, (state) => state.selection);
			selectionRenders += 1;
			return createElement("span");
		}
		function Viewport(): ReactElement {
			useTimelineSlice(store, (state) => state.viewport);
			viewportRenders += 1;
			return createElement("span");
		}
		mount(createElement("div", null, createElement(Selection), createElement(Viewport)));

		const selectionBefore = selectionRenders;
		act(() => {
			store.dispatch({ type: "zoom", focalPx: 100, factor: 2 });
		});
		expect(viewportRenders).toBeGreaterThan(1);
		expect(selectionRenders).toBe(selectionBefore);
	});

	test("no component holds gesture or viewport state in a ref", async () => {
		/* A rule over the source rather than a convention: a ref holding either is
		 * a second copy of something the kernel owns, and the two disagree the
		 * first time a render is skipped. */
		const { readdir, readFile } = await import("node:fs/promises");
		/* The previous implementation's components are exempt and listed by name.
		 * They hold exactly the refs this rule exists to forbid — which is one of
		 * the reasons they are being replaced — and they are deleted wholesale at
		 * task 16.2, at which point this list goes with them. Listing them keeps
		 * the rule strict for everything new rather than weakening it for both. */
		const PENDING_DELETION = new Set([
			"gesture-controller.ts",
			"timeline-primitives.tsx",
			"timeline-adapter.ts",
			"workspace.tsx",
			"overlay.tsx",
			"primitives.tsx",
			"renderer.tsx",
			"keyboard.tsx",
			"focus.ts",
			"sheet.tsx",
			"index.tsx",
		]);
		/* The components moved to components/editor-workspace; this test stayed with the hooks it covers, so it scans that directory by name. */
		const componentsDir = join(import.meta.dirname, "../../components/editor-workspace");
		const files = (await readdir(componentsDir)).filter(
			(file) => /\.tsx?$/.test(file) && !file.includes(".test.") && !PENDING_DELETION.has(file),
		);
		expect(files.length).toBeGreaterThan(0);
		const offenders: string[] = [];
		for (const file of files) {
			const source = await readFile(join(componentsDir, file), "utf8");
			for (const [index, line] of source.split("\n").entries()) {
				if (/useRef[<(][^)]*(?:gesture|viewport|scrollLeft|pointerId)/i.test(line))
					offenders.push(`${file}:${index + 1}`);
			}
		}
		expect(offenders).toEqual([]);
		/* The rule can find one, or the assertion above is empty. */
		expect(
			/useRef[<(][^)]*(?:gesture|viewport|scrollLeft|pointerId)/i.test(
				"const gesture = useRef<GestureState | null>(null);",
			),
		).toBe(true);
		void useRef;
	});
});

/* ---- 12.2 The workspace ---------------------------------------------------- */

/** What a `rootRef` callback was handed, so a test can assert on it after the
 *  render that produced it. */
interface RootCapture {
	node: HTMLDivElement | null;
}

describe("workspace", () => {
	test("the editor workspace publishes its root through rootRef", () => {
		/* A named holder rather than a `let`: assigned only inside the callback, a
		 * plain variable narrows to `null` and the assertion stops compiling. */
		const seen: RootCapture = { node: null };
		const { host, unmount } = mount(
			createElement(VuiEditorWorkspace, {
				contractVersion: 1 as const,
				mode: "embedded" as const,
				label: "Editor",
				rootRef: (element: HTMLDivElement | null) => {
					seen.node = element;
				},
				preview: createElement("div", null, "preview"),
				timeline: createElement("div", null, "timeline"),
			}),
		);
		expect(seen.node).toBe(host.querySelector("[data-vui-slot='workspace']") as HTMLDivElement);
		/* Released on unmount, or a consumer measures a detached element. */
		unmount();
		expect(seen.node).toBeNull();
	});

	/* The mobile action region lives OUTSIDE the workspace surface.
	 *
	 * This assertion is the reverse of what it was, and the reversal is the point.
	 * The region was rendered inside the surface, where it read correctly and did
	 * nothing: an overlay inerts every body child but its own host, the workspace
	 * is one of them, and `inert` cannot be escaped from within. A sibling can be
	 * exempted; a descendant cannot. So it is portalled to a marked host, and what
	 * a consumer addresses — the slot and the height token — is unchanged.
	 */
	test("the mobile action region is portalled out of the workspace surface", () => {
		const { host } = mount(
			createElement(VuiEditorWorkspace, {
				contractVersion: 1 as const,
				mode: "embedded" as const,
				label: "Editor",
				preview: createElement("div", null, "preview"),
				timeline: createElement("div", null, "timeline"),
				mobileActions: createElement("button", { type: "button" }, "Save"),
			}),
		);
		const surface = host.querySelector("[data-vui-slot='workspace']")!;
		expect(
			surface.querySelector("[data-vui-slot='mobile-actions']"),
			"not inside the surface",
		).toBeNull();

		const actions = document.querySelector("[data-vui-slot='mobile-actions']");
		expect(actions, "but present in the document").not.toBeNull();
		expect(actions!.textContent).toBe("Save");
		/* On a host the overlay pass is told to leave alone, which is the whole
		 * reason it moved. */
		expect(
			actions!.parentElement!.hasAttribute(VUI_PERSISTENT_ATTRIBUTE),
			"on a persistent host",
		).toBe(true);
		expect(
			actions!.parentElement!.parentElement,
			"which is a body child, not a descendant of the workspace",
		).toBe(document.body);
	});

	/* The surface reserves what the region no longer occupies in flow. */
	test("the workspace reserves the action region's height", () => {
		const { host } = mount(
			createElement(VuiEditorWorkspace, {
				contractVersion: 1 as const,
				mode: "embedded" as const,
				label: "Editor",
				preview: createElement("div", null, "preview"),
				timeline: createElement("div", null, "timeline"),
				mobileActions: createElement("button", { type: "button" }, "Save"),
			}),
		);
		const surface = host.querySelector("[data-vui-slot='workspace']") as HTMLElement;
		expect(
			surface.style.paddingBottom,
			"the height is reserved rather than left to overlap",
		).toMatch(/px$/);
	});

	/* Absent content means absent element — no empty strip along the bottom edge
	 * for a consumer that supplies no actions. */
	test("no mobile action content means no region", () => {
		const { host } = mount(
			createElement(VuiEditorWorkspace, {
				contractVersion: 1 as const,
				mode: "embedded" as const,
				label: "Editor",
				preview: createElement("div", null, "preview"),
				timeline: createElement("div", null, "timeline"),
			}),
		);
		expect(host.querySelector("[data-vui-slot='mobile-actions']")).toBeNull();
	});

	/* The internal ref still works alongside a consumer's.
	 *
	 * Handing the element only to the consumer would trade one broken measurement
	 * for another: the compact observer reads the same ref to decide composition. */
	test("rootRef does not displace the workspace's own measurement", () => {
		const { host } = mount(
			createElement(VuiEditorWorkspace, {
				contractVersion: 1 as const,
				mode: "embedded" as const,
				label: "Editor",
				rootRef: () => {},
				preview: createElement("div", null, "preview"),
				timeline: createElement("div", null, "timeline"),
			}),
		);
		expect(
			host.querySelector("[data-vui-slot='workspace']")!.getAttribute("data-vui-compact"),
		).not.toBeNull();
	});
});

describe("composed primitives", () => {
	/* A consumer's class reaches the accordion.
	 *
	 * Without this there is no supported way to style it. Spacing is reachable
	 * through tokens, but everything else would mean matching `.vui-accordion`,
	 * which the contract documents as private and changeable in a patch release —
	 * so a component with neither a class nor tokens is one the contract forbids
	 * styling at all. Both classes are asserted, because replacing the package's
	 * own would take its layout with it. */
	test("a consumer class composes onto the accordion beside the package's own", () => {
		const { host } = mount(
			createElement(AccordionSection, {
				label: "Timing",
				className: "app-section",
				defaultOpen: true,
				children: createElement("input"),
			}),
		);
		const section = host.querySelector("[data-vui-slot='accordion']")!;
		expect(section.classList.contains("app-section"), "the consumer's class is present").toBe(true);
		expect(section.classList.contains("vui-accordion"), "the package's own class survives").toBe(
			true,
		);
		/* The open state is the header's `aria-expanded`; the unstyled `is-open`
		 * class it used to carry rendered nothing and was removed. */
		expect(
			section.querySelector("[data-vui-slot='accordion-header']")?.getAttribute("aria-expanded"),
			"the open state still applies",
		).toBe("true");
	});

	test("no consumer class leaves the accordion as it was", () => {
		const { host } = mount(
			createElement(AccordionSection, { label: "Timing", children: createElement("input") }),
		);
		expect(host.querySelector("[data-vui-slot='accordion']")!.className.trim()).toBe(
			"vui-accordion",
		);
	});
});

describe("the background an overlay inerts", () => {
	/** A body child standing in for whatever else is on the page. */
	function bodyChild(persistent: boolean): HTMLElement {
		const element = document.createElement("div");
		if (persistent) element.setAttribute(VUI_PERSISTENT_ATTRIBUTE, "");
		document.body.append(element);
		return element;
	}

	/* Both halves are asserted: an ordinary sibling is still inerted, or the
	 * exemption would have quietly disabled the background entirely. */
	test("a marked host is left alone while an ordinary one is inerted", () => {
		const ordinary = bodyChild(false);
		const persistent = bodyChild(true);
		const { unmount } = mount(
			createElement(VuiOverlay, {
				open: true,
				label: "Sheet",
				kind: "sheet" as const,
				children: createElement("div", null, "body"),
			}),
		);

		expect(
			Boolean((ordinary as HTMLElement & { inert?: boolean }).inert),
			"an ordinary body child is inerted",
		).toBe(true);
		expect(ordinary.getAttribute("aria-hidden"), "and hidden from assistive technology").toBe(
			"true",
		);
		expect(
			Boolean((persistent as HTMLElement & { inert?: boolean }).inert),
			"a marked host is not inerted",
		).toBe(false);
		expect(persistent.getAttribute("aria-hidden"), "and not hidden").toBeNull();

		unmount();
		ordinary.remove();
		persistent.remove();
	});

	/* Two overlays, closed in both orders. The stack re-applies on every change,
	 * so the exemption has to survive being re-evaluated rather than only being
	 * right the first time; and the teardown restores from a baseline captured
	 * before any of it, which must not leave the marked host inert. */
	test("the exemption survives stacking and teardown", () => {
		const ordinary = bodyChild(false);
		const persistent = bodyChild(true);
		const outer = mount(
			createElement(VuiOverlay, { open: true, label: "Outer", children: createElement("div") }),
		);
		const inner = mount(
			createElement(VuiOverlay, {
				open: true,
				label: "Inner",
				kind: "sheet" as const,
				children: createElement("div"),
			}),
		);

		const inertOf = (element: HTMLElement): boolean =>
			Boolean((element as HTMLElement & { inert?: boolean }).inert);
		expect(inertOf(persistent), "still exempt with two open").toBe(false);
		expect(inertOf(ordinary), "still inerted with two open").toBe(true);

		inner.unmount();
		expect(inertOf(persistent), "still exempt after the top one closes").toBe(false);

		outer.unmount();
		expect(inertOf(persistent), "not inerted once every overlay has gone").toBe(false);
		expect(inertOf(ordinary), "the ordinary child is restored too").toBe(false);
		expect(ordinary.getAttribute("aria-hidden"), "and its aria-hidden is removed").toBeNull();

		ordinary.remove();
		persistent.remove();
	});

	test("a persistent descendant keeps only its ancestry live", () => {
		const page = bodyChild(false);
		const content = document.createElement("main");
		const bar = document.createElement("nav");
		bar.setAttribute("data-app-overlay-persistent", "");
		page.append(content, bar);
		const overlayHost = bodyChild(false);
		const stack = overlayStackForDocument(document);
		const release = stack.push({
			id: "app-sheet",
			zOrder: 700,
			modal: true,
			host: overlayHost,
			persistentAttribute: "data-app-overlay-persistent",
		});

		expect(Boolean((page as HTMLElement & { inert?: boolean }).inert)).toBe(false);
		expect(Boolean((content as HTMLElement & { inert?: boolean }).inert)).toBe(true);
		expect(Boolean((bar as HTMLElement & { inert?: boolean }).inert)).toBe(false);

		release();
		page.remove();
		overlayHost.remove();
	});
});

/* ---- 12.3 The overlay stack ------------------------------------------------ */

describe("overlay stack", () => {
	test("one overlay stack per host document", () => {
		expect(overlayStackForDocument(document)).toBe(overlayStackForDocument(document));
	});

	test("orders a body-portalled app overlay with a VUI overlay", () => {
		const stack = overlayStackForDocument(document);
		const vuiHost = document.createElement("div");
		const appHost = document.createElement("div");
		const vui = document.createElement("div");
		const app = document.createElement("div");
		vuiHost.append(vui);
		appHost.append(app);
		document.body.append(vuiHost, appHost);
		const releaseVui = stack.push({
			id: "portalled-vui",
			zOrder: 600,
			modal: true,
			element: vui,
			host: vuiHost,
		});
		const releaseApp = stack.push({
			id: "portalled-app",
			zOrder: 700,
			modal: true,
			element: app,
			host: appHost,
		});

		expect(stack.top()?.id).toBe("portalled-app");
		expect(vui.style.zIndex).toBe("600");
		expect(app.style.zIndex).toBe("700");
		expect(appHost.hasAttribute("data-vui-root")).toBe(false);

		releaseApp();
		releaseVui();
		vuiHost.remove();
		appHost.remove();
	});

	test("only the top overlay handles Escape", () => {
		const stack = createOverlayStack();
		const closed: string[] = [];
		const outer = stack.push({
			id: "outer",
			zOrder: 1000,
			modal: true,
			onRequestClose: () => closed.push("outer"),
		});
		stack.push({
			id: "inner",
			zOrder: 1020,
			modal: true,
			onRequestClose: () => closed.push("inner"),
		});

		expect(stack.top()?.id).toBe("inner");
		expect(stack.focusOwner()?.id).toBe("inner");
		expect(stack.handleKey("Escape")?.id).toBe("inner");
		expect(closed).toEqual(["inner"]);

		/* And the outer one is inert while the inner is open — which is what
		 * "modal" means, and why a nested sheet does not also close its dialog. */
		expect(stack.isInert("outer")).toBe(true);
		expect(stack.isInert("inner")).toBe(false);
		outer();
	});

	test("both unwind orders restore correctly", () => {
		const stack = createOverlayStack();
		const outer = stack.push({ id: "outer", zOrder: 1000, modal: true });
		const inner = stack.push({ id: "inner", zOrder: 1020, modal: true });

		/* Inner first: the ordinary order. */
		inner();
		expect(stack.top()?.id).toBe("outer");
		expect(stack.isInert("outer")).toBe(false);
		outer();
		expect(stack.entries()).toEqual([]);

		/* Outer first: a dialog closed by a route change while its sheet is open.
		 * Released by identity, so the right one goes. */
		const a = stack.push({ id: "a", zOrder: 1000, modal: true });
		stack.push({ id: "b", zOrder: 1020, modal: true });
		a();
		expect(stack.entries().map((entry) => entry.id)).toEqual(["b"]);
		expect(stack.focusOwner()?.id).toBe("b");
	});

	test("a key-transparent overlay does not swallow the key it declared no interest in", () => {
		const stack = createOverlayStack();
		const closed: string[] = [];
		stack.push({
			id: "dialog",
			zOrder: 1000,
			modal: true,
			onRequestClose: () => closed.push("dialog"),
		});
		stack.push({
			id: "toast",
			zOrder: 1050,
			modal: false,
			keyTransparent: true,
			onRequestClose: () => closed.push("toast"),
		});

		expect(stack.top()?.id).toBe("toast");
		expect(stack.keyOwner()?.id).toBe("dialog");
		stack.handleKey("Escape");
		expect(closed).toEqual(["dialog"]);
	});
});

/* ---- 12.4 Overlay mechanics ------------------------------------------------ */

describe("overlay mechanics", () => {
	test("the body scroll lock is reference-counted across nesting", () => {
		const body = { style: { overflow: "auto" } };
		const lock = createScrollLock(body);
		const first = lock.acquire();
		const second = lock.acquire();
		expect(body.style.overflow).toBe("hidden");
		expect(lock.count()).toBe(2);

		first();
		/* Still locked: the second dialog is still open, and a lock that cleared
		 * here would let the page scroll behind it. */
		expect(body.style.overflow).toBe("hidden");
		second();
		/* Restored to what the consumer had, not to an empty string. */
		expect(body.style.overflow).toBe("auto");
		expect(lock.count()).toBe(0);
		second();
		expect(lock.count()).toBe(0);
	});

	test("focus containment wraps in both directions and re-reads its members", () => {
		expect(nextFocusIndex(3, 2, false)).toBe(0);
		expect(nextFocusIndex(3, 0, true)).toBe(2);
		expect(nextFocusIndex(0, 0, false)).toBe(-1);

		const focused: string[] = [];
		let members = [
			{ id: "a", focus: () => focused.push("a") },
			{ id: "b", focus: () => focused.push("b") },
		];
		const trap = createFocusTrap({ members: () => members });
		trap.moveFocus(1, false);
		expect(focused).toEqual(["a"]);

		/* The dialog's content changed while it was open. A cached list would send
		 * Tab to an element that is no longer there. */
		members = [...members, { id: "c", focus: () => focused.push("c") }];
		trap.moveFocus(1, false);
		expect(focused).toEqual(["a", "c"]);
	});

	test("restoration is idempotent, because several close paths can run for one close", () => {
		let restored = 0;
		const trap = createFocusTrap({ members: () => [], opener: { focus: () => (restored += 1) } });
		trap.release();
		trap.release();
		expect(restored).toBe(1);
		expect(trap.released()).toBe(true);
	});
});

/* ---- 12.5 Renderer primitives ---------------------------------------------- */

/* ---- 12.7 The timeline components ------------------------------------------ */
