/* Hugging Face image generation through the Inference Providers router.
 *
 * Routing through Hugging Face rather than calling fal/Replicate/Nebius
 * directly is the point (design.md D7): which provider serves a given model is
 * logic this package should not reimplement, and going direct forfeits the
 * account's included monthly credits.
 *
 * THIS PROVIDER IS PERMISSIVE, BY DECISION — not by oversight (design.md D12).
 * It takes what the router gives it:
 *
 *   - reference inputs are IGNORED, because the text-to-image task has no
 *     parameter for them;
 *   - the returned image is kept AT WHATEVER SIZE IT ARRIVES, even when the
 *     serving provider dropped the width/height it was asked for (task 1.4:
 *     `nscale` answers a 1080x1920 request with 1024x1024).
 *
 * Both were refusals in an earlier revision. They are deliberately not refusals
 * now, so an image always comes back. The cost is real and known: a `9:16`
 * request can return a square, and a caller's chosen references have no effect
 * on the result — with `fromCache: false` and no error either way. Do not
 * reinstate the throws without changing D12 first. */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { InferenceClient } from "@huggingface/inference";
import { resolveDimensions } from "./dims.ts";
import { describeFailure } from "./errors.ts";
import {
	HUGGINGFACE_PROVIDER_ID,
	billingOrganization,
	configuredImageModel,
	inferenceProvider,
	requireToken,
} from "./models.ts";
import { mediaWorkerCacheDir } from "../../paths.ts";

/** The one call this package makes, narrowed so tests can stand in for it. */
export interface HuggingFaceImageClient {
	textToImage(
		args: {
			model?: string;
			provider?: string;
			inputs: string;
			parameters?: { width?: number; height?: number };
		},
		options?: { signal?: AbortSignal },
	): Promise<Blob>;
}

export interface HuggingFaceImageInput {
	prompt: string;
	aspect?: string;
	/**
	 * Accepted and ignored. The field stays on the input so the adapter can keep
	 * passing the caller's value through unchanged rather than deciding, at the
	 * seam, which providers deserve to see it.
	 */
	referenceUrls?: string[];
	signal?: AbortSignal;
	/** Injected by tests; production builds a router-backed client. */
	client?: HuggingFaceImageClient;
}

export interface HuggingFaceImageResult {
	path: string;
	model: string;
	provider: string;
	from_cache: boolean;
}

export function createRouterClient(): HuggingFaceImageClient {
	return new InferenceClient(requireToken(), { billTo: billingOrganization() });
}

/**
 * Pick an extension from the returned bytes rather than assuming one.
 *
 * The response's own Content-Type is not evidence — task 1.4 saw `image/jpeg`
 * announced over bytes that were actually PNG — so the magic number decides.
 */
export function extensionForBytes(bytes: Uint8Array): "png" | "jpg" | "webp" {
	if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
	if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50)
		return "webp";
	return "png";
}

export async function generateHuggingFaceImage(
	input: HuggingFaceImageInput,
): Promise<HuggingFaceImageResult> {
	const model = configuredImageModel();
	const client = input.client ?? createRouterClient();

	// Sent as a request, not enforced as a guarantee: a serving provider that
	// implements width/height will honour the aspect, and one that does not will
	// return its own default size, which is kept as-is.
	const { width, height } = resolveDimensions(input.aspect);

	let blob: Blob;
	try {
		blob = await client.textToImage(
			{ model, provider: inferenceProvider(), inputs: input.prompt, parameters: { width, height } },
			{ signal: input.signal },
		);
	} catch (error) {
		throw describeFailure(error);
	}

	const bytes = new Uint8Array(await blob.arrayBuffer());
	// The one thing still refused: empty output is not an image at any size.
	if (bytes.byteLength === 0) {
		throw new Error(`Hugging Face model ${model} returned an empty image payload`);
	}

	const cacheDir = mediaWorkerCacheDir();
	await mkdir(cacheDir, { recursive: true });
	const path = join(cacheDir, `huggingface-${randomUUID()}.${extensionForBytes(bytes)}`);
	await writeFile(path, bytes);

	return { path, model, provider: HUGGINGFACE_PROVIDER_ID, from_cache: false };
}
