/* The kernel's geometry, read from a test.
 *
 * A clip's DURATION, its DRAWN width and its TOUCH TARGET are three different
 * numbers, and an element's box is only ever one of them. An assertion that
 * measures the element therefore cannot tell a clip padded to stay tappable
 * from a clip that genuinely lasts that long — which is the exact discrepancy
 * the touch requirements are about, so measuring the element is measuring the
 * wrong thing.
 *
 * `@maleo/vui` answers all three, and the app publishes its query on each
 * timeline's scroller (`controllers/surface/geometry-probe.ts`). This is the way in.
 * It is not a private hook: the same query is what a consumer building its own
 * inspector or accessibility layer would use.
 */
import { expect, type Page } from "@playwright/test";

/** A span in the kernel's pixels, relative to the timeline's own origin. */
export interface Box {
	readonly leftPx: number;
	readonly rightPx: number;
}

/** What the query answers about one item. The fields these tests read. */
export interface ItemGeometry {
	/** The duration, in pixels. The truth. */
	readonly timeBox: Box;
	/** What is drawn. Wider than `timeBox` when a short item was padded. */
	readonly paintBox: Box;
	/** What is interactive. At least the platform minimum, grown inward. */
	readonly hitBox: Box;
	/** The drawing is wider than the duration. */
	readonly padded: boolean;
	/** The touch target is wider than the drawing. */
	readonly hitPadded: boolean;
	readonly handles: { readonly start?: Box; readonly end?: Box };
	readonly topPx: number;
	readonly heightPx: number;
}

/** How wide a box is. */
export function widthOf(box: Box): number {
	return box.rightPx - box.leftPx;
}

/**
 * Ask a timeline where one of its items is.
 *
 * `root` names WHICH timeline: three are mounted at once in this app — the
 * editor's, Motion Studio's and the template preview's — so a page-wide lookup
 * would answer for whichever mounted first.
 */
export async function itemGeometry(page: Page, root: string, id: string): Promise<ItemGeometry> {
	const result = await page
		.locator(root)
		.first()
		.evaluate((element, itemId) => {
			const host = element as HTMLElement & { vuiGeometry?: { itemAt(id: string): unknown } };
			if (!host.vuiGeometry)
				return { error: "no geometry query is published on this surface" } as const;
			const found = host.vuiGeometry.itemAt(itemId);
			return found === undefined ? ({ error: `no item ${itemId}` } as const) : ({ found } as const);
		}, id);
	expect(
		"error" in result ? result.error : undefined,
		`geometry for ${id} in ${root}`,
	).toBeUndefined();
	/* SAFETY: the branch above asserted the error case away, and `itemAt` returns
	 * the library's `ItemQueryResult` — of which `ItemGeometry` is the subset
	 * these tests read. The value crossed `evaluate`, so it is already plain JSON. */
	return (result as { found: ItemGeometry }).found;
}

/** Every item the timeline currently considers visible. */
export async function visibleItems(page: Page, root: string): Promise<readonly string[]> {
	return await page
		.locator(root)
		.first()
		.evaluate((element) => {
			const host = element as HTMLElement & { vuiGeometry?: { visibleItems(): readonly string[] } };
			return host.vuiGeometry ? [...host.vuiGeometry.visibleItems()] : [];
		});
}

/** The template preview's scroller, which is where its query is published. */
export const TEMPLATE_TIMELINE = ".tl2-template-editor-modal [data-vui-slot='timeline-scroller']";
/** The content editor's scroller. */
export const EDITOR_TIMELINE = ".tl2-timeline [data-vui-slot='timeline-scroller']";
