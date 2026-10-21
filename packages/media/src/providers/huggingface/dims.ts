/* Aspect to pixels for the HF router.
 *
 * Local to the package for the reason given in design.md D2, and with no upper
 * clamp: unlike Cloudflare's models, the router's text-to-image parameters
 * carry no documented ceiling, and inventing one here would silently shrink
 * output that the selected model would have served at full size. */

/* A Map rather than an object literal: the lookup key is an arbitrary caller
 * string, and `Map.get` returns `| undefined` for an unknown one without either
 * widening the table's type or asserting the key into it. */
const ASPECT_DIMENSIONS = new Map<string, readonly [number, number]>([
	["1:1", [1080, 1080]],
	["16:9", [1920, 1080]],
	["9:16", [1080, 1920]],
	["4:5", [1080, 1350]],
	["3:4", [1080, 1440]],
]);

const DEFAULT_DIMENSIONS: readonly [number, number] = [1080, 1080];

export interface ImageDimensions {
	width: number;
	height: number;
}

export function resolveDimensions(aspect: string | undefined): ImageDimensions {
	const [width, height] =
		(aspect === undefined ? undefined : ASPECT_DIMENSIONS.get(aspect)) ?? DEFAULT_DIMENSIONS;
	return { width, height };
}
