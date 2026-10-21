/* Unlike the Cloudflare provider, there is no capability table here.
 *
 * The point of routing through Hugging Face is breadth — one adapter reaching
 * whatever the router serves — so enumerating models would defeat it. Every
 * model on the text-to-image task takes the same documented parameters
 * (width/height/steps/seed), and the one thing that genuinely varies, whether a
 * model is currently served, cannot be known from a table anyway. So an
 * unrecognised model is not a configuration error here; it is a generation
 * error that names the model, which is what the operator needs to act. */
import { resolveConfig } from "../config.ts";

export const HUGGINGFACE_PROVIDER_ID = "huggingface";

export const TOKEN_ENV = "HF_TOKEN";
export const BILL_TO_ENV = "HF_BILL_TO";
export const IMAGE_MODEL_ENV = "MALEO_HF_IMAGE_MODEL";
export const INFERENCE_PROVIDER_ENV = "MALEO_HF_INFERENCE_PROVIDER";

/** Fast, Apache-2.0, and the cheapest per image of the widely-served models. */
export const DEFAULT_IMAGE_MODEL = "black-forest-labs/FLUX.1-schnell";

export function configuredImageModel(): string {
	return resolveConfig(IMAGE_MODEL_ENV) ?? DEFAULT_IMAGE_MODEL;
}

export function readToken(): string | null {
	return resolveConfig(TOKEN_ENV) ?? null;
}

export function requireToken(): string {
	const token = readToken();
	if (!token) {
		throw new Error(`Hugging Face image generation is unconfigured; set ${TOKEN_ENV}`);
	}
	return token;
}

/** Organisation to attribute the request to, when one is configured. */
export function billingOrganization(): string | undefined {
	return resolveConfig(BILL_TO_ENV);
}

/**
 * Which serving provider to route to, or `undefined` for the router's `auto`.
 *
 * Exists because serving providers disagree about whether they implement the
 * task's `width`/`height` parameters at all: `nscale` and `fal-ai` both ignore
 * them. Since this provider keeps whatever size comes back (design.md D12),
 * pinning is the operator's only lever over output shape.
 */
export function inferenceProvider(): string | undefined {
	return resolveConfig(INFERENCE_PROVIDER_ENV);
}
