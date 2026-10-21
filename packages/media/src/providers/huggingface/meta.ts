import { huggingFaceImageHealth } from "./health.ts";
import {
	BILL_TO_ENV,
	configuredImageModel,
	IMAGE_MODEL_ENV,
	INFERENCE_PROVIDER_ENV,
	TOKEN_ENV,
} from "./models.ts";
import type { Capability } from "../capabilities.ts";
import type { ProviderMeta } from "../types.ts";

/* Read at attribution time, not snapshotted at module load: the model is an env
 * knob, and `generation/impl.ts` records `meta.models?.image` into the ledger.
 * A snapshot would credit every generation to whichever model was configured
 * when the process started. */
export const huggingfaceMeta: ProviderMeta = {
	id: "huggingface",
	label: "Hugging Face Inference Providers",
	capabilities: ["image"],
	config: [
		{
			key: TOKEN_ENV,
			label: "Access token",
			kind: "secret",
			required: true,
			help: "A Hugging Face token with inference access.",
		},
		{
			key: IMAGE_MODEL_ENV,
			label: "Image model",
			kind: "text",
			required: false,
		},
		{
			key: INFERENCE_PROVIDER_ENV,
			label: "Serving provider",
			kind: "text",
			required: false,
			help: "Serving providers disagree about whether they honour width and height at all — nscale and fal-ai ignore them. Pinning one is the only lever over output shape.",
		},
		{
			key: BILL_TO_ENV,
			label: "Bill to organisation",
			kind: "text",
			required: false,
		},
	],
	get models() {
		return { image: configuredImageModel() };
	},
	image: { references: { mode: "text-only" } },
	// Capability-aware: image only, and a provider-wide "ready" would let a
	// picker offer this for tts.
	async health(capability?: Capability) {
		if (capability && capability !== "image") return "unconfigured";
		return huggingFaceImageHealth();
	},
};
