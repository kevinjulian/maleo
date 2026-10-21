import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { MediaClient } from "@maleo/media/api";
import { putMedia } from "@maleo/storage";
import { closeMaleoDb, openDb } from "@maleo/db/connection";
import { createVoiceClone, softDeleteVoiceClone } from "@maleo/db/voice-clone";
import { setMediaClientForTests } from "./image-gen-client.ts";
import { resolveVoiceReference, synthesizeTts } from "./tts-synth.ts";

const previousSandbox = process.env.MALEO_SANDBOX;
const dbPath = join(tmpdir(), `tts-synth-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
const priorDbPath = process.env.MALEO_DB_PATH;

const WS = "acme";
const OTHER = "globex";
const POCKET = "pocket-tts-id";

beforeEach(async () => {
	process.env.MALEO_DB_PATH = dbPath;
	await closeMaleoDb();
	await openDb().run("DELETE FROM voice_clone");
});

afterEach(() => {
	setMediaClientForTests(undefined);
	if (previousSandbox === undefined) delete process.env.MALEO_SANDBOX;
	else process.env.MALEO_SANDBOX = previousSandbox;
});

afterAll(async () => {
	await closeMaleoDb();
	if (priorDbPath === undefined) delete process.env.MALEO_DB_PATH;
	else process.env.MALEO_DB_PATH = priorDbPath;
	rmSync(dbPath, { force: true });
});

function clone(over: Partial<Parameters<typeof createVoiceClone>[0]> = {}) {
	return createVoiceClone({
		workspace: WS,
		providerId: POCKET,
		label: "Narrator",
		lang: "id",
		refUrl: "/uploads/voice-clone-abc.wav",
		...over,
	});
}

/** A media client that records what it was asked to submit. */
function recordingClient() {
	let submitted: Parameters<MediaClient["submitTts"]>[0] | undefined;
	const client: MediaClient = {
		async submitImage() {
			throw new Error("not used");
		},
		async submitVideo() {
			throw new Error("unused");
		},
		async videoReadiness() {
			return {};
		},
		async submitTts(request) {
			submitted = request;
			return "tts-1";
		},
		async poll() {
			return {
				id: "tts-1",
				kind: "tts",
				status: "done",
				imageUrl: null,
				audioUrl: "/files/voice.wav",
				fromCache: false,
				providerId: "sandbox",
				providerSource: "project",
				model: "sandbox-wav",
				cost: 0,
				latencyMs: 1,
				error: null,
			};
		},
		async download() {
			return { bytes: new Uint8Array([1, 2, 3]), ext: "wav" };
		},
		fileUrl(path) {
			return path;
		},
	};
	return { client, submitted: () => submitted };
}

describe("worker TTS transport", () => {
	test("fails clearly when worker is absent", async () => {
		setMediaClientForTests(null);
		await expect(synthesizeTts({ text: "hello", provider: "sandbox" })).rejects.toThrow(
			"media worker not configured",
		);
	});

	test("submits, polls, and downloads through media client", async () => {
		process.env.MALEO_SANDBOX = "1";
		const { client, submitted } = recordingClient();
		setMediaClientForTests(client);

		await expect(
			synthesizeTts({
				text: "hello",
				voice: "M1",
				provider: "sandbox",
				language: "id",
				workspace: WS,
			}),
		).resolves.toEqual({ bytes: new Uint8Array([1, 2, 3]), ext: "wav" });
		expect(submitted()).toMatchObject({
			text: "hello",
			voice: "M1",
			language: "id",
			workspaceId: WS,
			providerId: "sandbox",
			providerSource: "project",
		});
	});

	/* A voice that is not a clone carries no reference audio. The field exists for
	 * cloning providers and must not appear on an ordinary synthesis. */
	test("carries no reference audio for a provider-declared voice", async () => {
		process.env.MALEO_SANDBOX = "1";
		const { client, submitted } = recordingClient();
		setMediaClientForTests(client);

		await synthesizeTts({ text: "hello", voice: "M1", provider: "sandbox", workspace: WS });
		expect(submitted()?.voiceRefUrl).toBeUndefined();
	});

	/* The worker stores the clip under the workspace's media key; the API reads it
	 * back only when that key belongs to the requesting workspace. */
	describe("a clip the worker stored", () => {
		const priorData = process.env.MALEO_DATA_DIR;
		const priorBackend = process.env.MALEO_MEDIA_STORAGE_BACKEND;
		let root = "";
		beforeEach(() => {
			root = join(tmpdir(), `tts-synth-media-${Date.now()}-${Math.random().toString(16).slice(2)}`);
			process.env.MALEO_DATA_DIR = root;
			process.env.MALEO_MEDIA_STORAGE_BACKEND = "local";
		});
		afterEach(() => {
			rmSync(root, { recursive: true, force: true });
			process.env.MALEO_DATA_DIR = priorData ?? join(tmpdir(), "maleo-test-data-fallback");
			if (priorBackend === undefined) delete process.env.MALEO_MEDIA_STORAGE_BACKEND;
			else process.env.MALEO_MEDIA_STORAGE_BACKEND = priorBackend;
		});

		async function storedBy(owner: string) {
			const stored = await putMedia({
				workspace: owner,
				kind: "audio",
				body: new Blob([new Uint8Array([7, 8, 9])]),
				contentType: "audio/wav",
			});
			const { client } = recordingClient();
			setMediaClientForTests({
				...client,
				async poll() {
					return {
						...(await client.poll("tts-1")),
						audioUrl: null,
						stored: {
							key: stored.key,
							hash: stored.hash,
							size: stored.size,
							contentType: stored.contentType,
						},
					};
				},
			});
		}

		test("is read back for its own workspace", async () => {
			process.env.MALEO_SANDBOX = "1";
			await storedBy(WS);
			await expect(
				synthesizeTts({ text: "hello", provider: "sandbox", workspace: WS }),
			).resolves.toEqual({ bytes: new Uint8Array([7, 8, 9]), ext: "wav" });
		});

		test("is refused for another workspace", async () => {
			process.env.MALEO_SANDBOX = "1";
			await storedBy(OTHER);
			await expect(
				synthesizeTts({ text: "hello", provider: "sandbox", workspace: WS }),
			).rejects.toThrow("speech job storage owner mismatch");
		});
	});
});

describe("resolving a cloned voice", () => {
	test("hands the provider the reference audio behind the id", async () => {
		const created = await clone();
		expect(await resolveVoiceReference(POCKET, created.id, WS)).toBe(
			"/uploads/voice-clone-abc.wav",
		);
	});

	test("resolves nothing when no voice was named", async () => {
		expect(await resolveVoiceReference(POCKET, undefined, WS)).toBeUndefined();
	});

	/* Substituting another voice here would return audio nobody chose, and every
	 * layer downstream would read it as success. */
	test("refuses a clone the resolved provider cannot speak, naming both", async () => {
		const created = await clone({ providerId: POCKET });
		expect(() => resolveVoiceReference("kokoro", created.id, WS)).toThrow(/pocket-tts-id/);
		expect(() => resolveVoiceReference("kokoro", created.id, WS)).toThrow(/kokoro/);
	});

	test("refuses an id that names no clone under a cloning provider", () => {
		expect(() => resolveVoiceReference(POCKET, "vc_nothing", WS)).toThrow(
			/speaks only cloned voices/,
		);
	});

	test("does not resolve another workspace's clone", async () => {
		const created = await clone();
		expect(() => resolveVoiceReference(POCKET, created.id, OTHER)).toThrow(/not a cloned voice/);
	});

	test("does not resurrect a removed clone", async () => {
		const created = await clone();
		await softDeleteVoiceClone(WS, created.id);
		expect(() => resolveVoiceReference(POCKET, created.id, WS)).toThrow(/not a cloned voice/);
	});

	/* Kokoro's own speaker ids are not clones and must pass through untouched. */
	test("leaves a declaring provider's voice alone", async () => {
		expect(await resolveVoiceReference("kokoro", "af_heart", WS)).toBeUndefined();
	});
});
