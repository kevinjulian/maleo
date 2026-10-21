/* Reference inputs, constrained to worker-reachable managed files and then
 * downscaled to the model's input ceiling.
 *
 * The ceiling is the model's, not ours — klein rejects any input image that is
 * not smaller than 512x512 — so downscaling is the only way to honour a
 * reference at all rather than the polite thing to do with a big one.
 *
 * Everything that cannot be honoured is refused loudly, matching
 * `../codex/references.ts`. A dropped reference produces a
 * plausible image that answers a different question, and the caller sees
 * success. */
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import type { CloudflareImageModel } from "./models.ts";
import { referenceToLocalPath } from "../shared/paths.ts";

export interface ReferenceImage {
	/** Where it came from, for error messages and attribution. */
	source: string;
	bytes: Uint8Array<ArrayBuffer>;
	contentType: string;
}

/**
 * Resolve, validate and downscale the requested references for `model`.
 *
 * Throws when the model accepts none, when more are supplied than it accepts,
 * or when one cannot be resolved or read.
 */
export async function resolveCloudflareReferences(
	referenceUrls: string[] | undefined,
	model: CloudflareImageModel,
): Promise<ReferenceImage[]> {
	const requested = referenceUrls?.filter((url) => url.trim()) ?? [];
	if (requested.length === 0) return [];

	if (model.maxReferences === 0 || model.maxReferenceEdge === null) {
		throw new Error(
			`Cloudflare model ${model.id} accepts no reference images; ` +
				`use the codex provider, or a Cloudflare model that accepts references, ` +
				`for reference-guided generation`,
		);
	}
	if (requested.length > model.maxReferences) {
		throw new Error(
			`Cloudflare model ${model.id} accepts at most ${model.maxReferences} reference images, received ${requested.length}`,
		);
	}

	const unresolved = requested.filter((url) => referenceToLocalPath(url) === null);
	if (unresolved.length > 0) {
		throw new Error(
			`unsupported Cloudflare image references (not worker-reachable managed files): ${unresolved.join(", ")}`,
		);
	}

	const paths = [...new Set(requested.map((url) => referenceToLocalPath(url)!))];
	return Promise.all(paths.map((path) => downscaleReference(path, model.maxReferenceEdge!)));
}

function mimeForFormat(format: string | undefined): string {
	switch (format) {
		case "jpeg":
			return "image/jpeg";
		case "webp":
			return "image/webp";
		case "png":
			return "image/png";
		case undefined:
		default:
			// Unknown to sharp's sniffer; re-encoding is safer than guessing a type
			// the upstream model may reject.
			return "application/octet-stream";
	}
}

/**
 * Fit a reference inside `maxEdge` on both sides, preserving its aspect.
 *
 * `withoutEnlargement` keeps an already-small reference untouched, so a
 * reference is re-encoded only when it has to be.
 */
export async function downscaleReference(path: string, maxEdge: number): Promise<ReferenceImage> {
	let source: Buffer;
	try {
		source = await readFile(path);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Cloudflare image reference could not be read: ${path} (${message})`);
	}

	try {
		const image = sharp(source);
		const { width, height, format } = await image.metadata();
		const known = mimeForFormat(format);
		if (
			known !== "application/octet-stream" &&
			width !== undefined &&
			height !== undefined &&
			width <= maxEdge &&
			height <= maxEdge
		) {
			// Passed through untouched, so the declared type must be what the file
			// actually is — not what the re-encode branch below would have produced.
			return { source: path, bytes: Uint8Array.from(source), contentType: known };
		}
		const resized = await image
			.resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
			.png()
			.toBuffer();
		return { source: path, bytes: Uint8Array.from(resized), contentType: "image/png" };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Cloudflare image reference could not be decoded: ${path} (${message})`);
	}
}
