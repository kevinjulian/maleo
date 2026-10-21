/* Aspect to pixels, for the selected model's range AND its dimension grid.
 *
 * This table is local to the package on purpose (design.md D2): provider impl
 * packages take no `@maleo/*` dependency, and the bounds differ per provider
 * anyway — klein stops at 1920, sandbox goes to 4096, the HF router is
 * unbounded — so a shared table would still leave the clamp to be written here.
 *
 * THE GRID IS NOT COSMETIC. Task 1.2 asked klein for 1920x1080 and got back
 * 1920x1072; asking for 1000 returned 992, 1008 returned 1008, 1016 returned
 * 1008. The model floors both sides to a multiple of 16. So the obvious table
 * of "nice" sizes silently produces the wrong aspect: 1920x1072 is 1.791, not
 * the 1.778 that 16:9 means, and nothing in the response says so.
 *
 * The fix is to only ever ASK for a size the model can return exactly. Both
 * sides are derived from the aspect's integer ratio scaled by a factor that
 * keeps them on the grid, so what comes back is what was requested and the
 * ratio is exact rather than approximate. Asking for 1921 also silently clamps
 * to 1920 rather than erroring, which is the same failure in the other
 * direction and why the range is enforced here rather than upstream. */
import type { CloudflareImageModel } from "./models.ts";

/** The exact integer ratio each aspect means. */
const ASPECT_RATIOS = new Map<string, readonly [number, number]>([
	["1:1", [1, 1]],
	["16:9", [16, 9]],
	["9:16", [9, 16]],
	["4:5", [4, 5]],
	["3:4", [3, 4]],
]);

/** Roughly the size to aim for; the grid decides the exact one. */
const ASPECT_TARGETS = new Map<string, readonly [number, number]>([
	["1:1", [1080, 1080]],
	["16:9", [1920, 1080]],
	["9:16", [1080, 1920]],
	["4:5", [1080, 1350]],
	["3:4", [1080, 1440]],
]);

const DEFAULT_ASPECT = "1:1";

export interface ImageDimensions {
	width: number;
	height: number;
}

function gcd(a: number, b: number): number {
	return b === 0 ? a : gcd(b, a % b);
}

function lcm(a: number, b: number): number {
	return (a / gcd(a, b)) * b;
}

function ratioFor(aspect: string | undefined): readonly [number, number] {
	return (
		(aspect === undefined ? undefined : ASPECT_RATIOS.get(aspect)) ??
		ASPECT_RATIOS.get(DEFAULT_ASPECT)!
	);
}

function targetFor(aspect: string | undefined): readonly [number, number] {
	return (
		(aspect === undefined ? undefined : ASPECT_TARGETS.get(aspect)) ??
		ASPECT_TARGETS.get(DEFAULT_ASPECT)!
	);
}

export function isSquareAspect(aspect: string | undefined): boolean {
	const [width, height] = ratioFor(aspect);
	return width === height;
}

/**
 * The size to request for `aspect`: exact ratio, on the model's grid, in range.
 *
 * Both sides are `ratio * step * k`, so the ratio is exact by construction
 * rather than by rounding — the failure mode being designed out is a size that
 * looks right and comes back 8px short on one side.
 *
 * Returns `null` for a model that exposes no dimensions; the caller decides
 * whether that is acceptable, because it is only acceptable for a square.
 */
export function resolveDimensions(
	aspect: string | undefined,
	model: CloudflareImageModel,
): ImageDimensions | null {
	if (!model.dimensions) return null;

	const [ratioW, ratioH] = ratioFor(aspect);
	const [targetW, targetH] = targetFor(aspect);
	const { min, max, grid } = model.dimensions;

	// The smallest multiplier that puts BOTH sides on the grid while holding the
	// ratio: each side needs `ratio * factor` divisible by `grid`.
	const factor = lcm(grid / gcd(ratioW, grid), grid / gcd(ratioH, grid));
	const stepW = ratioW * factor;
	const stepH = ratioH * factor;

	// Nearest whole step to the intended size, then pulled inside the range. The
	// range clamp wins, because a request above `max` is silently truncated
	// upstream and one below `min` is rejected.
	const kNearest = Math.round(Math.max(targetW / stepW, targetH / stepH));
	const kMax = Math.floor(max / Math.max(stepW, stepH));
	const kMin = Math.ceil(min / Math.min(stepW, stepH));
	const k = Math.max(1, Math.min(Math.max(kNearest, kMin), Math.max(kMax, 1)));

	return { width: stepW * k, height: stepH * k };
}

/**
 * Guard for a model that emits a fixed square.
 *
 * A non-square request cannot be served, and serving it anyway would succeed at
 * the wrong thing (design.md D6): the caller receives a usable image whose
 * framing is wrong, with nothing to indicate why.
 */
export function assertAspectSupported(
	aspect: string | undefined,
	model: CloudflareImageModel,
): void {
	if (model.dimensions) return;
	if (isSquareAspect(aspect)) return;
	throw new Error(
		`Cloudflare model ${model.id} emits a fixed square and cannot honour aspect "${aspect}"; ` +
			`select a model that accepts dimensions`,
	);
}
