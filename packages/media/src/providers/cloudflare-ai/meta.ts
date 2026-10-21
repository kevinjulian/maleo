import { cloudflareImageHealth } from "./health.ts";
import {
	ACCOUNT_ID_ENV,
	API_TOKEN_ENV,
	configuredImageModel,
	DEFAULT_IMAGE_MODEL_ID,
	IMAGE_MODEL_ENV,
} from "./models.ts";
import type { Capability } from "../capabilities.ts";
import type { ImageReferenceSupport, ProviderMeta } from "../types.ts";

/* Which Cloudflare model is configured decides whether `aspect` and reference
 * inputs are honoured at all, so the ledger has to name the one that actually
 * ran. `generation/impl.ts` records `meta.models?.image`, so this is read at
 * attribution time rather than snapshotted at module load — a snapshot would
 * quietly credit every generation to whichever model was configured when the
 * process started. */
function reportedModel(): string {
	try {
		return configuredImageModel().id;
	} catch {
		// An id this package cannot describe makes health() `unconfigured`, so no
		// generation runs; meta.models still has to answer, and the default is the
		// honest answer to "what would run".
		return DEFAULT_IMAGE_MODEL_ID;
	}
}

function referenceSupport(): ImageReferenceSupport {
	try {
		const model = configuredImageModel();
		return model.maxReferences > 0
			? { mode: "native", maxImages: model.maxReferences }
			: { mode: "none" };
	} catch {
		return { mode: "none" };
	}
}

export const cloudflareAiMeta: ProviderMeta = {
	id: "cloudflare-ai",
	label: "Cloudflare Workers AI",
	capabilities: ["image"],
	config: [
		{
			key: ACCOUNT_ID_ENV,
			label: "Account ID",
			kind: "text",
			required: true,
			help: "From the Cloudflare dashboard sidebar.",
		},
		{
			key: API_TOKEN_ENV,
			label: "API token",
			kind: "secret",
			required: true,
			help: "A token with the Workers AI permission.",
		},
		{
			key: IMAGE_MODEL_ENV,
			label: "Image model",
			kind: "text",
			required: false,
			help: "Which model is configured decides whether aspect ratio and reference images are honoured at all.",
		},
	],
	get models() {
		return { image: reportedModel() };
	},
	get image() {
		return { references: referenceSupport() };
	},
	// Capability-aware: this provider implements image only, and a provider-wide
	// "ready" would let a picker offer it for tts.
	async health(capability?: Capability) {
		if (capability && capability !== "image") return "unconfigured";
		return cloudflareImageHealth();
	},
};
