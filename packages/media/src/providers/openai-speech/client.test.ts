/* OpenAI-compatible speech request, format gate, and health probe. */
import { afterEach, describe, expect, it } from "vite-plus/test";
import { OpenAiSpeechClient } from "./client.ts";
import { kokoroSpeechClient } from "../kokoro/service.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

interface CapturedCall {
	url: string;
	body: unknown;
}

interface FetchCapture {
	calls: CapturedCall[];
}

/** Record every request the client makes and answer with fixed audio bytes. */
function captureFetch(): FetchCapture {
	const calls: CapturedCall[] = [];
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		calls.push({
			url: String(input),
			body: init?.body ? JSON.parse(String(init.body)) : undefined,
		});
		return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
	}) as typeof fetch;
	return { calls };
}

describe("construction", () => {
	it("refuses a blank base url rather than dialing a relative path", () => {
		expect(
			() =>
				new OpenAiSpeechClient({
					baseUrl: "  ",
					model: "m",
					healthPath: "/health",
					formats: ["wav"],
				}),
		).toThrow();
	});

	it("refuses an empty format list — a client that can encode nothing is misconfigured", () => {
		expect(
			() =>
				new OpenAiSpeechClient({
					baseUrl: "http://x",
					model: "m",
					healthPath: "/health",
					formats: [],
				}),
		).toThrow();
	});

	it("normalizes a trailing slash so the path is not doubled", async () => {
		const { calls } = captureFetch();
		await new OpenAiSpeechClient({
			baseUrl: "http://x/",
			model: "m",
			healthPath: "/health",
			formats: ["wav"],
		}).synthesize({ text: "hi" });
		expect(calls[0]?.url).toBe("http://x/v1/audio/speech");
	});
});

describe("request shape", () => {
	it("rejects a request with no text", async () => {
		const client = kokoroSpeechClient("http://x");
		await expect(client.synthesize({ text: "" })).rejects.toThrow();
	});

	it("sends the client's model, not a caller-supplied one", async () => {
		const { calls } = captureFetch();
		await kokoroSpeechClient("http://x").synthesize({ text: "hi" });
		expect(calls[0]?.body).toMatchObject({ model: "kokoro", input: "hi", response_format: "wav" });
	});
});

describe("response format is checked against the server that will encode it", () => {
	it("does not reach service when format is refused", async () => {
		const { calls } = captureFetch();
		await kokoroSpeechClient("http://x")
			.synthesize({ text: "hi", format: "ogg" })
			.catch(() => {});
		expect(calls).toHaveLength(0);
	});

	it("accepts mp3 for Kokoro, which can encode it", async () => {
		const { calls } = captureFetch();
		await kokoroSpeechClient("http://x").synthesize({ text: "hi", format: "mp3" });
		expect(calls[0]?.body).toMatchObject({ model: "kokoro", response_format: "mp3" });
	});
});

describe("liveness probes the path its own server answers", () => {
	it("Kokoro probes /health", async () => {
		const { calls } = captureFetch();
		expect(await kokoroSpeechClient("http://x").healthy()).toBe(true);
		expect(calls[0]?.url).toBe("http://x/health");
	});

	it("an unreachable server is down, not an exception", async () => {
		globalThis.fetch = (async () => {
			throw new Error("ECONNREFUSED");
		}) as unknown as typeof fetch;
		expect(await kokoroSpeechClient("http://x").healthy()).toBe(false);
	});
});
