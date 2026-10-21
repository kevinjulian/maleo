/* Hugging Face Inference Providers — one adapter reaching whatever the router
 * serves.
 *
 * Permissive by decision: it ignores reference inputs and keeps whatever image
 * size comes back, because the text-to-image task has no reference parameter and
 * the serving providers behind the router disagree about honouring width/height.
 * A 9:16 request can therefore succeed as a square with no error, which is why
 * this is never the default — see `../registry.ts`. */
import type { ContentProvider, ImageProvider } from "../types.ts";
import { generateHuggingFaceImage } from "./image.ts";
import { huggingfaceMeta } from "./meta.ts";

const huggingfaceImage: ImageProvider = {
	async generate(input, ctx) {
		const result = await generateHuggingFaceImage({
			prompt: input.prompt,
			aspect: input.aspect,
			signal: ctx.signal,
		});
		return { url: result.path, fromCache: result.from_cache };
	},
};

export const huggingfaceProvider: ContentProvider = {
	meta: huggingfaceMeta,
	image: huggingfaceImage,
};

export {
	createRouterClient,
	extensionForBytes,
	generateHuggingFaceImage,
	type HuggingFaceImageClient,
	type HuggingFaceImageInput,
	type HuggingFaceImageResult,
} from "./image.ts";
export { huggingFaceImageHealth, type HuggingFaceHealth } from "./health.ts";
export {
	BILL_TO_ENV,
	DEFAULT_IMAGE_MODEL,
	HUGGINGFACE_PROVIDER_ID,
	IMAGE_MODEL_ENV,
	INFERENCE_PROVIDER_ENV,
	TOKEN_ENV,
	billingOrganization,
	configuredImageModel,
	inferenceProvider,
	readToken,
} from "./models.ts";
export { resolveDimensions, type ImageDimensions } from "./dims.ts";
export { HuggingFaceRequestError, isCreditExhaustion, statusOf } from "./errors.ts";
