/* Shared geometry assertions for VUI-backed surfaces.
 *
 * These started inside `mobile-editor.spec.ts` and are shared because the same
 * four questions apply to every editor surface on every viewport: is it in the
 * layout, does it have a box, is that box inside the visual viewport, and is it
 * the thing under the finger at its own centre.
 *
 * Each half is load-bearing and neither is sufficient. A non-zero box says
 * nothing about whether anything painted — `.tl2-stage-top` once had a perfect
 * box around a hidden child. Being topmost says nothing about being sized — a
 * zero-height element can still be the hit target over nothing. And a surface
 * can satisfy both while hanging below the fold, which is a POSITION problem
 * that reads nothing like occlusion.
 */
import { expect, type Page } from "@playwright/test";

export interface SurfaceGeometry {
	box: { x: number; y: number; w: number; h: number } | null;
	hit: string;
	where: string;
	viewport: { w: number; h: number };
}

/** One round trip, deliberately: measuring and hit-testing separately leaves a
 *  gap in which layout can move, and the hit test then runs against a point the
 *  element no longer occupies. */
export async function surfaceGeometry(page: Page, selector: string): Promise<SurfaceGeometry> {
	return page.evaluate((sel) => {
		const el = document.querySelector(sel as string);
		if (!el)
			return { box: null, hit: "absent", where: "", viewport: { w: innerWidth, h: innerHeight } };
		const r = el.getBoundingClientRect();
		const x = Math.round(r.x + r.width / 2);
		const y = Math.round(r.y + r.height / 2);
		const at = document.elementFromPoint(x, y);
		return {
			box: { x: r.x, y: r.y, w: r.width, h: r.height },
			/* A descendant counts as a hit: asserting the exact node would encode
			 * today's markup, and a surface legitimately delegates its centre to a
			 * child. */
			hit: !at
				? "nothing"
				: at.closest(sel as string)
					? "self"
					: `${at.tagName.toLowerCase()}.${(at.className || "").toString().split(" ")[0] || "?"}`,
			where: `centre ${x},${y} of ${Math.round(r.width)}x${Math.round(r.height)} at ${Math.round(r.x)},${Math.round(r.y)} in ${innerWidth}x${innerHeight}`,
			viewport: { w: innerWidth, h: innerHeight },
		};
	}, selector);
}

/**
 * The surface is in the layout, has a real box, and is topmost at its centre.
 *
 * Retried, because a single sample catches the layout mid-settle. Under
 * parallel load this suite intermittently measured the bottom bar hanging below
 * the fold with its centre off screen, so `elementFromPoint` returned null and
 * the failure read "covered by nothing". Retrying waits the settle out; an
 * element that is genuinely covered or genuinely off screen still fails, it
 * just takes three seconds to say so.
 */
export async function expectRenders(page: Page, selector: string, label = selector): Promise<void> {
	await expect(async () => {
		const result = await surfaceGeometry(page, selector);
		expect(result.box, `${label}: not in the layout at all`).not.toBeNull();
		expect(result.box!.w, `${label}: zero width`).toBeGreaterThan(1);
		expect(result.box!.h, `${label}: zero height`).toBeGreaterThan(1);
		expect(result.hit, `${label}: covered by ${result.hit} — ${result.where}`).toBe("self");
	}).toPass({ timeout: 3000 });
}

/** The surface is inside the visual viewport on both axes, within one device
 *  pixel of rounding. A surface that overflows is reachable only by scrolling
 *  something that a fullscreen workspace is not supposed to scroll. */
export async function expectWithinViewport(
	page: Page,
	selector: string,
	label = selector,
): Promise<void> {
	await expect(async () => {
		const result = await surfaceGeometry(page, selector);
		expect(result.box, `${label}: not in the layout at all`).not.toBeNull();
		const box = result.box!;
		expect(
			Math.round(box.x),
			`${label}: starts left of the viewport — ${result.where}`,
		).toBeGreaterThanOrEqual(-1);
		expect(
			Math.round(box.y),
			`${label}: starts above the viewport — ${result.where}`,
		).toBeGreaterThanOrEqual(-1);
		expect(
			Math.round(box.x + box.w),
			`${label}: runs past the right edge — ${result.where}`,
		).toBeLessThanOrEqual(result.viewport.w + 1);
		expect(
			Math.round(box.y + box.h),
			`${label}: runs past the bottom — ${result.where}`,
		).toBeLessThanOrEqual(result.viewport.h + 1);
	}).toPass({ timeout: 3000 });
}

/** The surface covers the visual viewport exactly — every edge, within device
 *  pixel rounding. This is the fullscreen assertion: a workspace that leaves a
 *  desktop-modal gap or keeps a radius at phone width fails here. */
export async function expectFillsViewport(
	page: Page,
	selector: string,
	label = selector,
): Promise<void> {
	const result = await surfaceGeometry(page, selector);
	expect(result.box, `${label}: not in the layout at all`).not.toBeNull();
	const box = result.box!;
	expect(
		{
			x: Math.round(box.x),
			y: Math.round(box.y),
			right: Math.round(box.x + box.w),
			bottom: Math.round(box.y + box.h),
		},
		`${label}: does not fill the viewport — ${result.where}`,
	).toEqual({
		x: 0,
		y: 0,
		right: result.viewport.w,
		bottom: result.viewport.h,
	});
}

/**
 * A fullscreen VUI workspace covers the visual viewport and keeps none of the
 * desktop modal's decoration.
 *
 * The bounds check alone would pass a surface that fills the viewport while
 * still painting a rounded corner or a border, which is what a modal looks like
 * stretched — the phone requirement is that the modal chrome is gone, not just
 * that the box is big.
 */
export async function expectFullscreenWorkspace(
	page: Page,
	label = "fullscreen workspace",
): Promise<void> {
	const overlay =
		"[data-vui-overlay-kind='workspace'].vui-workspace-fullscreen .vui-overlay-dialog";
	await expectFillsViewport(page, overlay, label);
	const decoration = await page.evaluate((sel) => {
		const el = document.querySelector(sel as string);
		if (!el) return null;
		const style = getComputedStyle(el);
		return {
			radius: [
				style.borderTopLeftRadius,
				style.borderTopRightRadius,
				style.borderBottomLeftRadius,
				style.borderBottomRightRadius,
			],
			borderWidth: [
				style.borderTopWidth,
				style.borderRightWidth,
				style.borderBottomWidth,
				style.borderLeftWidth,
			],
			margin: [style.marginTop, style.marginRight, style.marginBottom, style.marginLeft],
		};
	}, overlay);
	expect(decoration, `${label}: no fullscreen dialog found`).not.toBeNull();
	const zero = (values: string[]): boolean =>
		values.every((value) => Number.parseFloat(value) === 0);
	expect(
		zero(decoration!.radius),
		`${label}: keeps a desktop corner radius (${decoration!.radius.join(", ")})`,
	).toBe(true);
	expect(
		zero(decoration!.borderWidth),
		`${label}: keeps a desktop border (${decoration!.borderWidth.join(", ")})`,
	).toBe(true);
	expect(
		zero(decoration!.margin),
		`${label}: keeps an outer gap (${decoration!.margin.join(", ")})`,
	).toBe(true);
}

export interface SafeAreaInsets {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

/** Drive the safe-area custom properties the package reads.
 *
 * `env(safe-area-inset-*)` cannot be emulated from Playwright, so the package
 * indirects through `--vui-safe-area-*` and the test sets those. That is the
 * same substitution the stylesheet already makes for a device with no cutout,
 * so it exercises the real rule rather than a parallel one. */
export async function applySafeAreaInsets(
	page: Page,
	selector: string,
	insets: SafeAreaInsets,
): Promise<void> {
	await page.locator(selector).evaluate(
		(element, values) => {
			for (const [name, value] of Object.entries(values))
				element.style.setProperty(`--vui-safe-area-${name}`, `${value}px`);
		},
		insets as unknown as Record<string, number>,
	);
}
