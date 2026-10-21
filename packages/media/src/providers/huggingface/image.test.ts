import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { HuggingFaceRequestError } from "./errors.ts";
import {
	extensionForBytes,
	generateHuggingFaceImage,
	type HuggingFaceImageClient,
} from "./image.ts";
import { DEFAULT_IMAGE_MODEL } from "./models.ts";

const dir = await mkdtemp(join(tmpdir(), "hf-image-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

/** Real PNGs: the provider now MEASURES what came back, so shape matters. */
async function png(width: number, height: number): Promise<Uint8Array<ArrayBuffer>> {
	return Uint8Array.from(
		await sharp({ create: { width, height, channels: 3, background: "#123456" } })
			.png()
			.toBuffer(),
	);
}

const PNG = await png(1080, 1080);
const VERTICAL = await png(1080, 1920);

interface Recorded {
	model?: string;
	provider?: string;
	inputs: string;
	parameters?: { width?: number; height?: number };
}

function stub(result: Blob | Error) {
	const calls: Recorded[] = [];
	const client: HuggingFaceImageClient = {
		async textToImage(args) {
			calls.push(args);
			if (result instanceof Error) throw result;
			return result;
		},
	};
	return { client, calls };
}

/** Shaped like `InferenceClientProviderApiError`, which carries httpResponse. */
function apiError(status: number, message: string): Error {
	const error = new Error(message) as Error & { httpResponse: { status: number } };
	error.httpResponse = { status };
	return error;
}

beforeEach(() => {
	process.env.HF_TOKEN = "hf_test";
	process.env.HF_BILL_TO = "";
	process.env.MALEO_HF_IMAGE_MODEL = "";
	process.env.MALEO_HF_INFERENCE_PROVIDER = "";
	process.env.CACHE_DIR = dir;
});

describe("request shape", () => {
	it("sends the default model and the aspect's dimensions", async () => {
		const { client, calls } = stub(new Blob([VERTICAL]));
		await generateHuggingFaceImage({ prompt: "a fox", aspect: "9:16", client });

		expect(calls).toHaveLength(1);
		expect(calls[0]!.model).toBe(DEFAULT_IMAGE_MODEL);
		expect(calls[0]!.inputs).toBe("a fox");
		expect(calls[0]!.parameters).toEqual({ width: 1080, height: 1920 });
	});

	it("honours a configured model", async () => {
		process.env.MALEO_HF_IMAGE_MODEL = "Qwen/Qwen-Image";
		const { client, calls } = stub(new Blob([PNG]));
		const result = await generateHuggingFaceImage({ prompt: "a fox", client });

		expect(calls[0]!.model).toBe("Qwen/Qwen-Image");
		expect(result.model).toBe("Qwen/Qwen-Image");
	});

	it("defaults to a square when no aspect is given", async () => {
		const { client, calls } = stub(new Blob([PNG]));
		await generateHuggingFaceImage({ prompt: "a fox", client });
		expect(calls[0]!.parameters).toEqual({ width: 1080, height: 1080 });
	});
});

describe("reference inputs are ignored, by decision (design.md D12)", () => {
	it("generates anyway when references are supplied", async () => {
		const { client, calls } = stub(new Blob([PNG]));
		const result = await generateHuggingFaceImage({
			prompt: "a fox",
			referenceUrls: ["/uploads/a.png", "/uploads/b.png"],
			client,
		});

		expect(result.path).toContain("huggingface-");
		expect(calls).toHaveLength(1);
	});

	it("sends nothing derived from the references, because the task has no such parameter", async () => {
		const { client, calls } = stub(new Blob([PNG]));
		await generateHuggingFaceImage({ prompt: "a fox", referenceUrls: ["/uploads/a.png"], client });

		// The consequence the caller lives with: the request is byte-identical to
		// one made with no references at all.
		expect(Object.keys(calls[0]!).sort()).toEqual(["inputs", "model", "parameters", "provider"]);
		expect(calls[0]!.inputs).toBe("a fox");
	});

	it("treats an empty or blank reference list the same way", async () => {
		const { client, calls } = stub(new Blob([PNG]));
		await generateHuggingFaceImage({ prompt: "a fox", referenceUrls: [], client });
		await generateHuggingFaceImage({ prompt: "a fox", referenceUrls: ["  "], client });
		expect(calls).toHaveLength(2);
	});
});

describe("output handling", () => {
	it("writes the bytes into CACHE_DIR and returns that path", async () => {
		const { client } = stub(new Blob([PNG]));
		const result = await generateHuggingFaceImage({ prompt: "a fox", client });

		expect(result.path.startsWith(dir)).toBe(true);
		expect(result.provider).toBe("huggingface");
		expect(new Uint8Array(await readFile(result.path))).toEqual(PNG);
	});

	it("fails on empty output rather than writing a zero-byte file", async () => {
		const { client } = stub(new Blob([]));
		await expect(generateHuggingFaceImage({ prompt: "a fox", client })).rejects.toThrow(
			/empty image payload/,
		);
	});

	it("names the extension from the bytes", () => {
		expect(extensionForBytes(PNG)).toBe("png");
		expect(extensionForBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
	});
});

describe("failures surface without waiting", () => {
	it("fails when no token is configured", async () => {
		process.env.HF_TOKEN = "";
		await expect(generateHuggingFaceImage({ prompt: "a fox" })).rejects.toThrow(/unconfigured/);
	});

	it("raises a rate limit promptly, preserving the status", async () => {
		const { client } = stub(apiError(429, "Too Many Requests"));
		const started = performance.now();
		const error = await generateHuggingFaceImage({ prompt: "a fox", client }).catch((e) => e);

		expect(error).toBeInstanceOf(HuggingFaceRequestError);
		expect((error as HuggingFaceRequestError).status).toBe(429);
		expect((error as HuggingFaceRequestError).retryable).toBe(true);
		// The reference implementation slept 30s here; durable retry owns that now.
		expect(performance.now() - started).toBeLessThan(1000);
	});

	it("marks exhausted credits as not retryable, since retrying cannot succeed", async () => {
		const { client } = stub(apiError(402, "Payment Required"));
		const error = (await generateHuggingFaceImage({ prompt: "a fox", client }).catch(
			(e) => e,
		)) as HuggingFaceRequestError;

		expect(error.exhaustedCredits).toBe(true);
		expect(error.retryable).toBe(false);
		expect(error.message).toMatch(/monthly credits are exhausted/);
	});

	it("recognises credit exhaustion from the message when the status does not say so", async () => {
		const { client } = stub(apiError(400, "You have exceeded your monthly included credits"));
		const error = (await generateHuggingFaceImage({ prompt: "a fox", client }).catch(
			(e) => e,
		)) as HuggingFaceRequestError;

		expect(error.exhaustedCredits).toBe(true);
		expect(error.retryable).toBe(false);
	});

	it("names an unserved model rather than reporting the provider as down", async () => {
		process.env.MALEO_HF_IMAGE_MODEL = "some-org/cold-model";
		const { client } = stub(apiError(404, "Model some-org/cold-model is not supported"));
		await expect(generateHuggingFaceImage({ prompt: "a fox", client })).rejects.toThrow(
			/some-org\/cold-model/,
		);
	});

	it("treats a 5xx as retryable and a 4xx as not", async () => {
		const server = (await generateHuggingFaceImage({
			prompt: "a fox",
			client: stub(apiError(503, "unavailable")).client,
		}).catch((e) => e)) as HuggingFaceRequestError;
		expect(server.retryable).toBe(true);

		const client400 = (await generateHuggingFaceImage({
			prompt: "a fox",
			client: stub(apiError(400, "bad request")).client,
		}).catch((e) => e)) as HuggingFaceRequestError;
		expect(client400.retryable).toBe(false);
	});
});

describe("returned size is kept as-is, by decision (design.md D12)", () => {
	// Task 1.4: nscale returns 1024x1024 and fal-ai returns 1024x768 for the same
	// 1080x1920 request, both reporting success. An earlier revision measured the
	// output and refused a mismatch; this one keeps whatever arrives.
	it("keeps a square returned for a vertical request", async () => {
		const { client } = stub(new Blob([await png(1024, 1024)]));
		const result = await generateHuggingFaceImage({ prompt: "a fox", aspect: "9:16", client });
		expect(result.path).toContain("huggingface-");
	});

	it("keeps a landscape image returned for a wide request", async () => {
		const { client } = stub(new Blob([await png(1024, 768)]));
		const result = await generateHuggingFaceImage({ prompt: "a fox", aspect: "16:9", client });
		expect(result.path).toContain("huggingface-");
	});

	it("still ASKS for the aspect, so a provider that honours it will", async () => {
		const { client, calls } = stub(new Blob([await png(1024, 1024)]));
		await generateHuggingFaceImage({ prompt: "a fox", aspect: "9:16", client });
		expect(calls[0]!.parameters).toEqual({ width: 1080, height: 1920 });
	});

	it("pins the serving provider when one is configured", async () => {
		process.env.MALEO_HF_INFERENCE_PROVIDER = "fal-ai";
		const { client, calls } = stub(new Blob([PNG]));
		await generateHuggingFaceImage({ prompt: "a fox", aspect: "9:16", client });
		expect(calls[0]!.provider).toBe("fal-ai");
	});
});

describe("credit exhaustion, as actually observed", () => {
	// Task 1.5 caught the real string. The first draft of the classifier missed
	// it: it matched "exceeded", and the message says "depleted".
	const OBSERVED =
		"Failed to perform inference: You have depleted your monthly included credits. " +
		"Purchase pre-paid credits to continue using Inference Providers.";

	it("classifies the observed message", async () => {
		const { client } = stub(apiError(400, OBSERVED));
		const error = (await generateHuggingFaceImage({ prompt: "a fox", client }).catch(
			(e) => e,
		)) as HuggingFaceRequestError;
		expect(error.exhaustedCredits).toBe(true);
		expect(error.retryable).toBe(false);
	});
});
