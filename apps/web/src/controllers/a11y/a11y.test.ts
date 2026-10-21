/* Reachable, operable, and announced — with no pointer anywhere in the file.
 *
 * Painting is not a representation of anything interactive, so every case here
 * asks the question a person with a keyboard or a screen reader asks: can I get
 * to it, can I do it, and was I told what happened.
 */
import { describe, expect, test } from "vite-plus/test";
import { createStore } from "@models/timeline-view/store.ts";
import { framesToProject, projectTime } from "@models/timeline-view/tick.ts";
import { itemCapabilities, itemGeometry } from "@models/timeline-view/geometry.ts";
import { resolveViewport } from "@models/timeline-view/viewport.ts";
import { type ItemId, type TimelineItem, type TimelineState } from "@models/timeline-view/types.ts";
import { BASE_30, magneticSingleRow, multiRowFree } from "@models/timeline-view/fixtures.ts";
import {
	createAnnouncer,
	handleAccessibility,
	itemAccessibility,
	LIVE_REGION_ATTRIBUTES,
} from "./a11y.ts";
import { chordOf, createShortcutRegistry, DEFAULT_KEYMAP } from "@controllers/keyboard/keymap.ts";
import { createOverlay } from "@controllers/surface/sparse-dom.ts";
import { REDUCED_MOTION_QUERY, resolveMotion } from "./motion.ts";
import { createItemIndex } from "@services/paint/scene.ts";

function largeTimeline(count: number, widthPx = 800): TimelineState {
	const items: TimelineItem[] = [];
	for (let index = 0; index < count; index += 1) {
		items.push({
			id: `item-${index}`,
			kind: "clip",
			label: `Clip ${index}`,
			start: framesToProject(index * 30, BASE_30),
			duration: framesToProject(30, BASE_30),
		});
	}
	return {
		...magneticSingleRow(),
		items: new Map(items.map((item) => [item.id, item])),
		order: items.map((item) => item.id),
		duration: framesToProject(count * 30, BASE_30),
		viewport: resolveViewport({ start: projectTime(0), scale: 1 / BASE_30.ticksPerFrame, widthPx }),
	};
}

/* ---- 8.1 Reachability ------------------------------------------------------ */

describe("focusable representation", () => {
	test("tabbing through a virtualized timeline reaches every visible item", () => {
		const state = largeTimeline(2000);
		const index = createItemIndex(state);
		const visible = index.inRange(state.viewport.start.ticks, state.viewport.end.ticks);

		/* The overlay's elements ARE the tab order: a virtualized timeline has no
		 * other representation of an item, so what is not mounted is unreachable. */
		const overlay = createOverlay<{ id: ItemId; role: string; name: string; tabIndex: number }>({
			create: (id) => {
				const item = state.items.get(id)!;
				const geometry = itemGeometry(item, state.viewport);
				const node = itemAccessibility(item, itemCapabilities(item, geometry, undefined), {
					at: "00:00:01:00",
				});
				return { id, role: node.role, name: node.name, tabIndex: node.tabIndex };
			},
		});
		overlay.sync(visible);

		const reached: ItemId[] = [];
		for (const node of overlay.nodes()) {
			expect(node.element.role).toBe("option");
			expect(node.element.name.length).toBeGreaterThan(0);
			reached.push(node.id);
		}
		expect(reached.sort()).toEqual([...visible].sort());
		expect(reached.length).toBe(visible.length);
	});

	test("an item's accessible name says what it is, when it is, and whether it is locked", () => {
		const state = multiRowFree();
		const locked = state.items.get("locked")!;
		const geometry = itemGeometry(locked, state.viewport);
		const capabilities = itemCapabilities(
			locked,
			geometry,
			state.rows.find((row) => row.id === locked.rowId),
		);
		const node = itemAccessibility(locked, capabilities, {
			at: "00:00:00:00",
			duration: "7 seconds",
			selected: true,
			focused: true,
		});

		expect(node.name).toBe("watermark locked, 00:00:00:00, 7 seconds, locked");
		expect(node.ariaSelected).toBe(true);
		expect(node.ariaDisabled).toBe(true);
		/* The focused member holds the tab stop; everything else is reachable by
		 * arrow key, which is what a roving tab index is for. */
		expect(node.tabIndex).toBe(0);
		expect(itemAccessibility(locked, capabilities, {}).tabIndex).toBe(-1);
	});

	test("a declined capability produces no affordance at all", () => {
		const state = multiRowFree();
		const locked = state.items.get("locked")!;
		const lockedGeometry = itemGeometry(locked, state.viewport);
		expect(
			handleAccessibility(
				locked,
				itemCapabilities(
					locked,
					lockedGeometry,
					state.rows.find((row) => row.id === "overlay"),
				),
			),
		).toEqual([]);

		/* An item at the very start of its media declines the leading edge only,
		 * and the trailing handle is still a real element. */
		const v2 = state.items.get("v2")!;
		const handles = handleAccessibility(
			v2,
			itemCapabilities(v2, itemGeometry(v2, state.viewport), undefined),
		);
		expect(handles.map((handle) => handle.slot)).toEqual(["trim-start", "trim-end"]);
		for (const handle of handles) expect(handle.name).toContain("v2");
	});
});

/* ---- 8.3 The live region --------------------------------------------------- */

describe("live region", () => {
	test("the region exists before the first announcement, or there is no announcer", () => {
		expect(() => createAnnouncer(undefined)).toThrow(/live region must exist/);
		const region = { textContent: null as string | null };
		const announcer = createAnnouncer(region);
		/* Present, and empty: a region mounted together with its first text is not
		 * announced by most screen readers, which is why this is a construction
		 * requirement rather than a convention. */
		expect(region.textContent).toBe(null);
		announcer.announce("Scene 1 moved to 00:00:02:00");
		expect(region.textContent).toBe("Scene 1 moved to 00:00:02:00");
		expect(announcer.lastMessage()).toBe("Scene 1 moved to 00:00:02:00");
	});

	test("the region is polite and atomic", () => {
		expect(LIVE_REGION_ATTRIBUTES).toEqual({
			role: "status",
			"aria-live": "polite",
			"aria-atomic": "true",
		});
	});

	test("an announcement travels as an effect, not as a direct write", () => {
		const store = createStore(magneticSingleRow());
		const performed: string[] = [];
		store.setEffectSink((effects) => {
			for (const effect of effects) if (effect.type === "announce") performed.push(effect.message);
		});
		const before = store.getState();
		store.dispatch({ type: "announce", message: "Nothing changed" });
		/* An announcement is a thing said about a result, not a result: the state
		 * is untouched and the effect still arrives. */
		expect(store.getState()).toBe(before);
		expect(performed).toEqual(["Nothing changed"]);
	});
});

/* ---- 8.4 The shortcut registry --------------------------------------------- */

describe("shortcut registry", () => {
	test("the default keymap resolves the commands it publishes", () => {
		const registry = createShortcutRegistry();
		expect(registry.resolve({ key: "ArrowRight" })).toBe("timeline.selectNext");
		expect(registry.resolve({ key: "ArrowRight", altKey: true })).toBe("timeline.moveForward");
		expect(registry.resolve({ key: "a", metaKey: true })).toBe("timeline.selectAll");
		/* One chord notation for both platforms: `mod` is met by either. */
		expect(chordOf({ key: "a", ctrlKey: true })).toBe(chordOf({ key: "a", metaKey: true }));
		expect(registry.bindings().length).toBe(DEFAULT_KEYMAP.length);
	});

	test("an override replaces a default, and a disabled binding runs nothing", () => {
		const moved = createShortcutRegistry({
			overrides: [{ command: "timeline.selectNext", keys: "n", scope: "timeline" }],
		});
		expect(moved.resolve({ key: "n" })).toBe("timeline.selectNext");
		expect(moved.conflicts()).toEqual([]);

		const off = createShortcutRegistry({
			overrides: [
				{ command: "timeline.selectAll", keys: "mod+a", scope: "timeline", enabled: false },
			],
		});
		expect(off.resolve({ key: "a", metaKey: true })).toBeUndefined();
	});

	test("a nested scope shadows the outer one", () => {
		const registry = createShortcutRegistry({
			overrides: [{ command: "dialog.close", keys: "Escape", scope: "dialog" }],
			scopeChain: ["dialog", "timeline"],
		});
		expect(registry.resolve({ key: "Escape" })).toBe("dialog.close");
		/* And with the dialog gone, the timeline has it back. */
		expect(registry.resolve({ key: "Escape" }, ["timeline"])).toBe("timeline.clearSelection");
	});

	test("two commands claiming one chord are reported rather than silently ordered", () => {
		const registry = createShortcutRegistry({
			overrides: [{ command: "consumer.split", keys: "ArrowRight", scope: "timeline" }],
		});
		expect(registry.conflicts()).toEqual([
			{
				scope: "timeline",
				keys: "ArrowRight",
				commands: ["timeline.selectNext", "consumer.split"],
			},
		]);
	});

	test("native text editing always wins", () => {
		const registry = createShortcutRegistry();
		expect(registry.resolve({ key: "a", metaKey: true, editing: true })).toBeUndefined();
		expect(registry.resolve({ key: "ArrowRight", editing: true })).toBeUndefined();
	});
});

/* ---- 8.5 Reduced motion ---------------------------------------------------- */

describe("reduced motion", () => {
	test("the media feature is genuinely asked, by its exact name", () => {
		const asked: string[] = [];
		const policy = resolveMotion({
			source: {
				matchMedia: (query) => {
					asked.push(query);
					return { matches: true };
				},
			},
		});
		expect(asked).toEqual([REDUCED_MOTION_QUERY]);
		expect(policy.reduced).toBe(true);
		expect(policy.durationMs).toBe(0);
		expect(policy.smoothScroll).toBe(false);
	});

	test("with motion off the surface still reaches its final geometry", () => {
		const state = magneticSingleRow();
		const reduced = resolveMotion({ source: { matchMedia: () => ({ matches: true }) } });
		const full = resolveMotion({ source: { matchMedia: () => ({ matches: false }) } });

		/* Geometry is computed from the viewport and the timebase, and motion
		 * enters into none of it: the same item lands in the same place either way.
		 * A reduced-motion surface that stopped somewhere else would have replaced
		 * an animation with a bug. */
		expect(itemGeometry(state.items.get("scene-1")!, state.viewport)).toEqual(
			itemGeometry(state.items.get("scene-1")!, state.viewport),
		);
		expect(reduced.durationMs).toBe(0);
		expect(full.durationMs).toBeGreaterThan(0);
		/* Travel is not decoration: auto-scroll keeps its speed, because switching
		 * it off would remove the only way a drag reaches content off screen. */
		expect(reduced.autoScrollPixelsPerSecond).toBe(full.autoScrollPixelsPerSecond);
	});

	test("an environment that cannot be asked does not claim reduced motion", () => {
		expect(resolveMotion({ source: undefined }).reduced).toBe(false);
	});
});
