/* Canvas 2D: the first backend, and deliberately the dumb one.
 *
 * It draws what the frame says and decides nothing. No store, no geometry, no
 * scheduling — which is what makes swapping it for WebGL a change to one file
 * rather than a change the kernel can feel.
 *
 * The context is a structural interface rather than `CanvasRenderingContext2D`
 * so a test can be one and assert the geometry actually drawn. A backend whose
 * only assertion is a screenshot is a backend whose arithmetic is checked by
 * eye.
 */
import type { PaintRegion } from "@models/timeline-view/effects.ts";
import type { PaintBackend, PaintFrame, PaintScene } from "./paint.ts";

/** The subset of a 2D context this backend uses. */
export interface Canvas2DContext {
	save(): void;
	restore(): void;
	beginPath(): void;
	rect(x: number, y: number, width: number, height: number): void;
	clip(): void;
	clearRect(x: number, y: number, width: number, height: number): void;
	fillRect(x: number, y: number, width: number, height: number): void;
	fillText(text: string, x: number, y: number): void;
	fillStyle: string;
	font: string;
	textBaseline: string;
}

export interface CanvasBackendOptions {
	/** How thick the playhead and each snap guide are drawn. */
	readonly guideWidthPx?: number;
	/** Inset for an item's label from its left edge. */
	readonly labelInsetPx?: number;
	readonly font?: string;
}

const DEFAULTS = { guideWidthPx: 2, labelInsetPx: 6, font: "11px system-ui, sans-serif" } as const;

/** Whether a horizontal span touches a region at all. */
function spanTouches(
	region: PaintRegion,
	leftPx: number,
	rightPx: number,
	topPx: number,
	bottomPx: number,
): boolean {
	return (
		rightPx >= region.xPx &&
		leftPx <= region.xPx + region.widthPx &&
		bottomPx >= region.yPx &&
		topPx <= region.yPx + region.heightPx
	);
}

function paintRegion(
	context: Canvas2DContext,
	scene: PaintScene,
	region: PaintRegion,
	options: Required<CanvasBackendOptions>,
): void {
	context.save();
	/* Clipped to the region, so a drawing routine that does not check bounds
	 * cannot silently repaint the whole surface and pass the region test. */
	context.beginPath();
	context.rect(region.xPx, region.yPx, region.widthPx, region.heightPx);
	context.clip();
	context.clearRect(region.xPx, region.yPx, region.widthPx, region.heightPx);
	context.fillStyle = scene.palette.background;
	context.fillRect(region.xPx, region.yPx, region.widthPx, region.heightPx);

	if (region.yPx < scene.rulerHeightPx) {
		context.fillStyle = scene.palette.ruler;
		context.fillRect(region.xPx, 0, region.widthPx, scene.rulerHeightPx);
		context.fillStyle = scene.palette.rulerText;
		context.font = options.font;
		context.textBaseline = "top";
		for (const tick of scene.ticks) {
			if (tick.xPx < region.xPx - 1 || tick.xPx > region.xPx + region.widthPx) continue;
			context.fillRect(tick.xPx, 0, 1, scene.rulerHeightPx);
			if (tick.label !== undefined)
				context.fillText(tick.label, tick.xPx + options.labelInsetPx / 2, 2);
		}
	}

	for (const item of scene.items) {
		if (!spanTouches(region, item.leftPx, item.rightPx, item.topPx, item.topPx + item.heightPx))
			continue;
		context.fillStyle = item.locked
			? scene.palette.itemLocked
			: item.selected
				? scene.palette.itemSelected
				: scene.palette.item;
		context.fillRect(item.leftPx, item.topPx, item.rightPx - item.leftPx, item.heightPx);
		/* The excess of a padded item is marked rather than left to look like
		 * duration. A timeline that quietly stops representing durations is one
		 * whose discrepancy is discoverable only by measuring. */
		if (item.padded) {
			context.fillStyle = scene.palette.paddedMark;
			context.fillRect(
				item.leftPx,
				item.topPx + item.heightPx - options.guideWidthPx,
				item.rightPx - item.leftPx,
				options.guideWidthPx,
			);
		}
		if (item.label !== undefined) {
			context.fillStyle = scene.palette.itemLabel;
			context.font = options.font;
			context.textBaseline = "top";
			context.fillText(
				item.label,
				item.leftPx + options.labelInsetPx,
				item.topPx + options.labelInsetPx / 2,
			);
		}
	}

	for (const overlay of scene.overlays) {
		if (
			!spanTouches(
				region,
				overlay.region.xPx,
				overlay.region.xPx + overlay.region.widthPx,
				overlay.region.yPx,
				overlay.region.yPx + overlay.region.heightPx,
			)
		)
			continue;
		context.fillStyle = overlay.colour;
		context.fillRect(
			overlay.region.xPx,
			overlay.region.yPx,
			overlay.region.widthPx,
			overlay.region.heightPx,
		);
	}

	for (const guidePx of scene.guides) {
		if (guidePx < region.xPx - options.guideWidthPx || guidePx > region.xPx + region.widthPx)
			continue;
		context.fillStyle = scene.palette.snapGuide;
		context.fillRect(guidePx, 0, options.guideWidthPx, scene.heightPx);
	}

	if (
		scene.playheadPx !== undefined &&
		scene.playheadPx >= region.xPx - options.guideWidthPx &&
		scene.playheadPx <= region.xPx + region.widthPx
	) {
		context.fillStyle = scene.palette.playhead;
		context.fillRect(scene.playheadPx, 0, options.guideWidthPx, scene.heightPx);
	}

	context.restore();
}

export function createCanvasBackend(
	context: Canvas2DContext,
	options: CanvasBackendOptions = {},
): PaintBackend {
	const resolved: Required<CanvasBackendOptions> = { ...DEFAULTS, ...options };
	return {
		paint(frame: PaintFrame) {
			for (const region of frame.regions) paintRegion(context, frame.scene, region, resolved);
		},
	};
}
