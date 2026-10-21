/* Cloudflare Workers AI image generation.
 *
 * The two supported models disagree about how a request is even encoded —
 * klein takes multipart with binary reference parts, flux-1-schnell takes JSON
 * — so the encoding is a property of the model table rather than a branch
 * someone has to remember. Both answer with a base64 payload inside
 * Cloudflare's standard envelope.
 *
 * Only a file inside the media-worker cache is a valid media result; a remote
 * URL or an undecoded payload never leaves this module. */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { requireCredentials } from "./credentials.ts";
import { assertAspectSupported, resolveDimensions } from "./dims.ts";
import { describeFailure } from "./errors.ts";
import {
	CLOUDFLARE_PROVIDER_ID,
	configuredImageModel,
	type CloudflareImageModel,
} from "./models.ts";
import { mediaWorkerCacheDir } from "../../paths.ts";
import { resolveCloudflareReferences, type ReferenceImage } from "./references.ts";

const API_BASE = "https://api.cloudflare.com/client/v4";

export interface CloudflareImageInput {
	prompt: string;
	aspect?: string;
	referenceUrls?: string[];
	signal?: AbortSignal;
	/** Injected by tests; production uses global fetch. */
	fetchImpl?: typeof fetch;
}

export interface CloudflareImageResult {
	path: string;
	model: string;
	provider: string;
	from_cache: boolean;
}

interface CloudflareEnvelope {
	result?: { image?: string };
}

export function buildEndpoint(accountId: string, modelId: string): string {
	return `${API_BASE}/accounts/${accountId}/ai/run/${modelId}`;
}

/**
 * The request body for `model`.
 *
 * `steps` is deliberately absent for both models: klein fixes it at 4 and does
 * not vary it, and flux-1-schnell's default of 4 is what the free-tier
 * arithmetic in the proposal assumes. Sending it would change cost without
 * changing the contract.
 */
export function buildBody(
	model: CloudflareImageModel,
	prompt: string,
	dimensions: { width: number; height: number } | null,
	references: ReferenceImage[],
): FormData | string {
	if (model.encoding === "json") {
		return JSON.stringify({ prompt });
	}
	const form = new FormData();
	form.set("prompt", prompt);
	if (dimensions) {
		form.set("width", String(dimensions.width));
		form.set("height", String(dimensions.height));
	}
	references.forEach((reference, index) => {
		form.set(
			`input_image_${index}`,
			new Blob([reference.bytes], { type: reference.contentType }),
			`reference-${index}`,
		);
	});
	return form;
}

/** Pick an extension from the decoded bytes rather than assuming one. */
export function extensionForBytes(bytes: Uint8Array): "png" | "jpg" | "webp" {
	if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
	if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50)
		return "webp";
	return "png";
}

export async function generateCloudflareImage(
	input: CloudflareImageInput,
): Promise<CloudflareImageResult> {
	const model = configuredImageModel();
	const { accountId, apiToken } = requireCredentials();

	// Refusals come before any billed request: an aspect the model cannot serve
	// and a reference it cannot accept are both configuration errors, and
	// spending a generation to discover them wastes the daily allowance.
	assertAspectSupported(input.aspect, model);
	const references = await resolveCloudflareReferences(input.referenceUrls, model);
	const dimensions = resolveDimensions(input.aspect, model);

	const body = buildBody(model, input.prompt, dimensions, references);
	// FormData sets its own multipart Content-Type with the boundary; setting one
	// here would strip the boundary and make the request unparseable.
	const headers = new Headers({ Authorization: `Bearer ${apiToken}` });
	if (typeof body === "string") headers.set("Content-Type", "application/json");

	const doFetch = input.fetchImpl ?? fetch;
	const response = await doFetch(buildEndpoint(accountId, model.id), {
		method: "POST",
		headers,
		body,
		signal: input.signal,
	});

	if (!response.ok) {
		throw describeFailure(response.status, await response.json().catch(() => null));
	}

	// SAFETY: the shape is not trusted — `CloudflareEnvelope` declares every field
	// optional, and the only one read is immediately checked for a non-empty
	// string below. A response that does not match fails as "no image payload".
	const envelope = (await response.json()) as CloudflareEnvelope;
	const encoded = envelope.result?.image;
	if (!encoded) {
		throw new Error(`Cloudflare model ${model.id} returned no image payload`);
	}

	const bytes = new Uint8Array(Buffer.from(encoded, "base64"));
	if (bytes.byteLength === 0) {
		throw new Error(`Cloudflare model ${model.id} returned an empty image payload`);
	}

	const cacheDir = mediaWorkerCacheDir();
	await mkdir(cacheDir, { recursive: true });
	const path = join(cacheDir, `cloudflare-${randomUUID()}.${extensionForBytes(bytes)}`);
	await writeFile(path, bytes);

	return { path, model: model.id, provider: CLOUDFLARE_PROVIDER_ID, from_cache: false };
}
