/* Split from services/paint/paint.test.ts when the DOM layer moved into the web
 * app: the geometry query is a controller, and a services test may not import one. */
import { describe, expect, test } from "vite-plus/test";
import { createStore } from "@models/timeline-view/store.ts";
import { itemGeometry } from "@models/timeline-view/geometry.ts";
import { multiRowFree } from "@models/timeline-view/fixtures.ts";
import { createGeometryQuery } from "./query.ts";
import {
	ROW_HEIGHT_PX,
	RULER_HEIGHT_PX,
	sceneOptions,
	largeTimeline,
} from "@services/paint/paint-fixtures.ts";
import { uniformRows, visibleScenery } from "@services/paint/scene.ts";

/* ---- 7.5 The geometry query ----------------------------------------------- */

describe("geometry query", () => {
	test("an item's position is answered by identity, in the kernel's units", () => {
		const store = createStore(multiRowFree());
		const query = createGeometryQuery({
			state: () => store.getState(),
			rows: uniformRows(
				store.getState().rows.map((row) => row.id),
				ROW_HEIGHT_PX,
			),
			rulerHeightPx: RULER_HEIGHT_PX,
		});

		const result = query.itemAt("v1")!;
		const expected = itemGeometry(store.getState().items.get("v1")!, store.getState().viewport);
		expect(result.timeBox).toEqual(expected.timeBox);
		expect(result.paintBox).toEqual(expected.paintBox);
		expect(result.hitBox.rightPx - result.hitBox.leftPx).toBeGreaterThanOrEqual(
			expected.timeBox.rightPx - expected.timeBox.leftPx,
		);
		expect(result.topPx).toBe(RULER_HEIGHT_PX);
		expect(result.heightPx).toBe(ROW_HEIGHT_PX);
	});

	test("interaction state travels with the geometry", () => {
		const store = createStore(multiRowFree());
		store.dispatch({ type: "select", items: ["v1"] });
		store.dispatch({ type: "focus", target: { kind: "item", id: "v1" } });
		const query = createGeometryQuery({ state: () => store.getState() });

		expect(query.itemAt("v1")).toMatchObject({ selected: true, focused: true, visible: true });
		expect(query.itemAt("v2")).toMatchObject({ selected: false, focused: false });
		/* A locked item reports it here rather than by having no handles drawn,
		 * because a test asserting an absence needs the reason for it. */
		expect(query.itemAt("locked")!.capabilities.readOnly).toBe(true);
		expect(query.itemAt("locked")!.handles).toEqual({});
		expect(query.itemAt("nothing")).toBeUndefined();
	});

	test("visibility is the same answer the painter and the overlay use", () => {
		const state = largeTimeline(2000, 800);
		const query = createGeometryQuery({ state: () => state });
		const scenery = visibleScenery(state, sceneOptions(state));
		expect(query.visibleItems()).toEqual(scenery.map((entry) => entry.item.id));
		expect(query.visibleCount()).toBe(scenery.length);
		expect(query.itemAt("item-1999")!.visible).toBe(false);
	});
});
