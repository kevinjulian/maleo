/* Cloudflare Workers AI — the free-allocation image path (10,000 neurons/day).
 *
 * The provider's own modules sit beside this file: `models.ts` owns the model
 * capability table, `dims.ts` the aspect-to-pixels grid and the square-only
 * refusal, `references.ts` reference resolution and downscaling, `image.ts` the
 * request itself, `errors.ts` upstream failure classification, and
 * `credentials.ts`/`health.ts` configuration state.
 *
 * The adapter is the object literal below rather than a separate delegate file:
 * translating `ImageGenInput` to this provider's input is three lines, and a file
 * that only forwards arguments hides where the translation actually happens. */
import type { ContentProvider, ImageProvider } from "../types.ts";
import { generateCloudflareImage } from "./image.ts";
import { cloudflareAiMeta } from "./meta.ts";

const cloudflareAiImage: ImageProvider = {
	async generate(input, ctx) {
		const result = await generateCloudflareImage({
			prompt: input.prompt,
			aspect: input.aspect,
			referenceUrls: input.referenceUrls,
			signal: ctx.signal,
		});
		return { url: result.path, fromCache: result.from_cache };
	},
};

export const cloudflareAiProvider: ContentProvider = {
	meta: cloudflareAiMeta,
	image: cloudflareAiImage,
};

/* Re-exported for the provider's own tests and for `@maleo/media` consumers
 * that need to describe what Cloudflare would do without running it. */
export { cloudflareImageHealth, type CloudflareHealth } from "./health.ts";
export {
	CLOUDFLARE_IMAGE_MODELS,
	CLOUDFLARE_PROVIDER_ID,
	DEFAULT_IMAGE_MODEL_ID,
	IMAGE_MODEL_ENV,
	configuredImageModel,
	resolveImageModel,
	type CloudflareImageModel,
} from "./models.ts";
export { assertAspectSupported, resolveDimensions, type ImageDimensions } from "./dims.ts";
export {
	downscaleReference,
	resolveCloudflareReferences,
	type ReferenceImage,
} from "./references.ts";
export { CloudflareRequestError } from "./errors.ts";
export {
	buildBody,
	buildEndpoint,
	extensionForBytes,
	generateCloudflareImage,
	type CloudflareImageInput,
	type CloudflareImageResult,
} from "./image.ts";
