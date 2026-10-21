/* Which Cloudflare image model is in use decides what the provider can honour.
 *
 * `flux-1-schnell` takes only `prompt` and `steps` — no width, no height, no
 * reference input. `flux-2-klein-4b` takes both. A model id passed straight
 * through to Cloudflare would therefore make `aspect` support depend on an
 * unvalidated string, and the failure is silent: a request for 9:16 comes back
 * square and flows into a vertical timeline as a mis-framed clip. So the model
 * is resolved from this table, its abilities are declared, and an unknown id is
 * a configuration error rather than a passthrough. */
import { resolveConfig } from "../config.ts";

export const CLOUDFLARE_PROVIDER_ID = "cloudflare-ai";

export const ACCOUNT_ID_ENV = "MALEO_CF_ACCOUNT_ID";
export const API_TOKEN_ENV = "MALEO_CF_API_TOKEN";
export const IMAGE_MODEL_ENV = "MALEO_CF_IMAGE_MODEL";

/** Output size the model will accept, or `null` when it accepts none. */
export interface DimensionRange {
	min: number;
	max: number;
	/**
	 * Both sides are floored to a multiple of this upstream (task 1.2: 1000 came
	 * back 992, 1016 came back 1008). Requesting off-grid silently changes the
	 * aspect, so `dims.ts` only ever asks for sizes that sit on it.
	 */
	grid: number;
}

export interface CloudflareImageModel {
	id: string;
	/** `null` means the model exposes no width/height and emits a fixed square. */
	dimensions: DimensionRange | null;
	/** How many reference images the model accepts. `0` means none. */
	maxReferences: number;
	/** Longest edge a reference may have, or `null` when references are unsupported. */
	maxReferenceEdge: number | null;
	/** How the request body is encoded; the two models differ. */
	encoding: "multipart" | "json";
}

export const CLOUDFLARE_IMAGE_MODELS: readonly CloudflareImageModel[] = [
	{
		// Steps are fixed at 4 on this distilled model and are deliberately not
		// sent. The model page's sample curl still passes `steps=25`, which task
		// 1.1 exists to resolve; until then the safe request is the one that
		// omits a parameter the model does not vary.
		id: "@cf/black-forest-labs/flux-2-klein-4b",
		dimensions: { min: 256, max: 1920, grid: 16 },
		maxReferences: 4,
		// Documented as "smaller than 512x512", so 512 itself is not admissible.
		maxReferenceEdge: 511,
		encoding: "multipart",
	},
	{
		id: "@cf/black-forest-labs/flux-1-schnell",
		dimensions: null,
		maxReferences: 0,
		maxReferenceEdge: null,
		encoding: "json",
	},
];

/** The default accepts both dimensions and references; see design.md D3. */
export const DEFAULT_IMAGE_MODEL_ID = "@cf/black-forest-labs/flux-2-klein-4b";

const BY_ID: ReadonlyMap<string, CloudflareImageModel> = new Map(
	CLOUDFLARE_IMAGE_MODELS.map((model) => [model.id, model]),
);

/**
 * Resolve the configured model.
 *
 * Throws on an id this package cannot describe, because the alternative is
 * forwarding it and discovering at render time that `aspect` was never honoured.
 */
export function resolveImageModel(configured?: string): CloudflareImageModel {
	const wanted = configured?.trim() || DEFAULT_IMAGE_MODEL_ID;
	const model = BY_ID.get(wanted);
	if (!model) {
		const known = CLOUDFLARE_IMAGE_MODELS.map((m) => m.id).join(", ");
		throw new Error(
			`unknown Cloudflare image model "${wanted}" (set ${IMAGE_MODEL_ENV} to one of: ${known})`,
		);
	}
	return model;
}

export function configuredImageModel(): CloudflareImageModel {
	return resolveImageModel(resolveConfig(IMAGE_MODEL_ENV));
}
