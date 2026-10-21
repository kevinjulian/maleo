import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { mediaWorkerCacheDir } from "../../paths.ts";

export interface SandboxImageInput {
	prompt: string;
	aspect?: string;
	width?: number;
	height?: number;
}

export interface SandboxImageResult {
	path: string;
	id: string;
	width: number;
	height: number;
}

/* A Map rather than an annotated object literal: the lookup key is an arbitrary
 * caller string, and `Map.get` returns `| undefined` for an unknown one without
 * widening the table's own type to `Record<string, ...>` — which would discard
 * the evidence that these five keys are the ones that exist. Matches the shape
 * the huggingface provider's `dims.ts` already uses. */
const ASPECT_DIMENSIONS = new Map<string, readonly [number, number]>([
	["1:1", [1080, 1080]],
	["16:9", [1920, 1080]],
	["9:16", [1080, 1920]],
	["4:5", [1080, 1350]],
	["3:4", [1080, 1440]],
]);

const DEFAULT_DIMENSIONS: readonly [number, number] = [1080, 1080];

const MIN_DIMENSION = 64;
const MAX_DIMENSION = 4096;

function validDimension(value: number | undefined): value is number {
	return Number.isInteger(value) && value! >= MIN_DIMENSION && value! <= MAX_DIMENSION;
}

/** The pixel size a sandbox image renders at, resolved from an explicit
 *  width/height pair or from the aspect ratio. */
export interface SandboxDimensions {
	width: number;
	height: number;
}

export function resolveSandboxDimensions(
	input: Pick<SandboxImageInput, "aspect" | "width" | "height">,
): SandboxDimensions {
	if (input.width !== undefined || input.height !== undefined) {
		if (!validDimension(input.width) || !validDimension(input.height)) {
			throw new Error(
				`sandbox image width and height must both be integers between ${MIN_DIMENSION} and ${MAX_DIMENSION}`,
			);
		}
		return { width: input.width, height: input.height };
	}
	const [width, height] = ASPECT_DIMENSIONS.get(input.aspect ?? "1:1") ?? DEFAULT_DIMENSIONS;
	return { width, height };
}

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

function promptExcerpt(prompt: string): string {
	const compact = prompt.replace(/\s+/g, " ").trim();
	return compact.length > 72 ? `${compact.slice(0, 69)}...` : compact;
}

export function createSandboxSvg(input: {
	id: string;
	prompt: string;
	width: number;
	height: number;
}): string {
	const { id, width, height } = input;
	const shortest = Math.min(width, height);
	const titleSize = Math.max(38, Math.round(shortest * 0.11));
	const detailSize = Math.max(22, Math.round(shortest * 0.034));
	const radius = Math.max(24, Math.round(shortest * 0.045));
	const safePrompt = escapeXml(promptExcerpt(input.prompt) || "Mock image");
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
	<defs>
		<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
			<stop offset="0" stop-color="#101827"/><stop offset="1" stop-color="#4c1d95"/>
		</linearGradient>
		<pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
			<path d="M 48 0 L 0 0 0 48" fill="none" stroke="#ffffff" stroke-opacity="0.07" stroke-width="2"/>
		</pattern>
	</defs>
	<rect width="${width}" height="${height}" fill="url(#bg)"/>
	<rect width="${width}" height="${height}" fill="url(#grid)"/>
	<rect x="6%" y="29%" width="88%" height="42%" rx="${radius}" fill="#111827" fill-opacity="0.72" stroke="#c4b5fd" stroke-width="4"/>
	<text x="50%" y="43%" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="${titleSize}" font-weight="800" letter-spacing="8" fill="#f5f3ff">SANDBOX</text>
	<text x="50%" y="52%" text-anchor="middle" dominant-baseline="middle" font-family="monospace" font-size="${detailSize}" fill="#ddd6fe">${width} × ${height}</text>
	<text x="50%" y="59%" text-anchor="middle" dominant-baseline="middle" font-family="monospace" font-size="${detailSize}" fill="#a7f3d0">${escapeXml(id)}</text>
	<text x="50%" y="65%" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="${Math.max(18, Math.round(detailSize * 0.78))}" fill="#d1d5db">${safePrompt}</text>
</svg>`;
}

export async function generateSandboxImage(input: SandboxImageInput): Promise<SandboxImageResult> {
	const { width, height } = resolveSandboxDimensions(input);
	const id = randomUUID();
	const cacheDir = mediaWorkerCacheDir();
	const path = join(cacheDir, `sandbox-${id}.png`);
	await mkdir(cacheDir, { recursive: true });
	await sharp(Buffer.from(createSandboxSvg({ id, prompt: input.prompt, width, height })))
		.png({ compressionLevel: 9 })
		.toFile(path);
	return { path, id, width, height };
}
