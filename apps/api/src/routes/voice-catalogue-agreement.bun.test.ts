/* The three payloads that used to disagree, compared through the actual routes.
 *
 * `voice-sample-previews` already requires the catalogue endpoint's sample to
 * resolve "to the same clip as the status payload does for that provider and
 * voice". Two endpoints once hardcoded one provider while third read configured provider,
 * so on a deployment running anything else they named different voices AND
 * different clips — and the picker built from the wrong two offered voices that
 * could not be synthesized.
 *
 * These go through the routes rather than the module, because the module was
 * never the thing that disagreed: the call sites were.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeMaleoDb, openDb } from "@maleo/db/connection";
import { getProvider } from "@maleo/media/providers";
import { operationsRoutes } from "./operations.ts";
import { ttsRoutes } from "./tts.ts";
import { testApp } from "../middleware/auth-testing.ts";

const dbPath = join(
	tmpdir(),
	`voice-agree-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
);
const priorDbPath = process.env.MALEO_DB_PATH;
const priorKokoroUrl = process.env.MALEO_KOKORO_URL;

type VoiceRow = { id: string; sampleUrl: string | null; hue: number };

/** [id, sampleUrl] pairs, which is the pair the spec requires to agree. */
function pairs(voices: VoiceRow[]): Array<[string, string | null]> {
	return voices.map((v) => [v.id, v.sampleUrl]);
}

async function statusVoices(): Promise<VoiceRow[]> {
	const body = (await (await testApp(ttsRoutes()).request("/status")).json()) as {
		voices: VoiceRow[];
	};
	return body.voices;
}

async function operationsVoices(): Promise<VoiceRow[]> {
	const body = (await (await testApp(operationsRoutes()).request("/voices")).json()) as {
		items: VoiceRow[];
	};
	return body.items;
}

async function catalogueVoices(): Promise<VoiceRow[]> {
	const body = (await (await testApp(operationsRoutes()).request("/catalogue")).json()) as {
		voices: VoiceRow[];
	};
	return body.voices;
}

beforeEach(async () => {
	process.env.MALEO_DB_PATH = dbPath;
	await closeMaleoDb();
	openDb();
	process.env.MALEO_KOKORO_URL = "http://127.0.0.1:9998";
});

afterEach(async () => {
	await closeMaleoDb();
	for (const suffix of ["", "-shm", "-wal"]) rmSync(`${dbPath}${suffix}`, { force: true });
	if (priorDbPath === undefined) delete process.env.MALEO_DB_PATH;
	else process.env.MALEO_DB_PATH = priorDbPath;
	if (priorKokoroUrl === undefined) delete process.env.MALEO_KOKORO_URL;
	else process.env.MALEO_KOKORO_URL = priorKokoroUrl;
});

describe("every catalogue payload names the same voices and the same clips", () => {
	it("agrees across /tts/status, /operations/voices and /operations/catalogue", async () => {
		const status = await statusVoices();
		const voices = await operationsVoices();
		const catalogue = await catalogueVoices();

		expect(status.length).toBeGreaterThan(0);
		expect(pairs(voices)).toEqual(pairs(status));
		expect(pairs(catalogue)).toEqual(pairs(status));
	});

	it("agrees on the hue, which had two derivations", async () => {
		const status = await statusVoices();
		const catalogue = await catalogueVoices();

		expect(catalogue.map((v) => v.hue)).toEqual(status.map((v) => v.hue));
	});

	/* All endpoints must serve configured provider voices. */
	it("serves the configured provider's voices from every endpoint", async () => {
		process.env.MALEO_KOKORO_URL = "http://127.0.0.1:9998";
		const kokoroIds = new Set((getProvider("kokoro")?.meta.tts?.voices ?? []).map((v) => v.id));

		for (const list of [await statusVoices(), await operationsVoices(), await catalogueVoices()]) {
			expect(list.length).toBeGreaterThan(0);
			for (const voice of list) {
				expect(kokoroIds.has(voice.id)).toBe(true);
			}
		}
	});

	it("reports which provider the voices belong to", async () => {
		const status = (await (await testApp(ttsRoutes()).request("/status")).json()) as {
			effective_provider: string;
		};
		const voices = (await (await testApp(operationsRoutes()).request("/voices")).json()) as {
			provider: string;
		};
		const catalogue = (await (await testApp(operationsRoutes()).request("/catalogue")).json()) as {
			voice_provider: string;
		};

		expect(voices.provider).toBe(status.effective_provider);
		expect(catalogue.voice_provider).toBe(status.effective_provider);
	});

	/* The status payload's contract after the reshape: providers are a derived
	   list, so no field may be named after one. A per-provider boolean is exactly
	   what made adding a provider an edit in every package that rendered one. */
	it("names no provider in a field of the status payload", async () => {
		const status = (await (await testApp(ttsRoutes()).request("/status")).json()) as Record<
			string,
			unknown
		>;
		const registered = ["kokoro", "canvas", "sandbox"];

		for (const key of Object.keys(status)) {
			for (const id of registered) {
				expect(key.includes(id)).toBe(false);
			}
		}
		expect(Array.isArray(status.providers)).toBe(true);
	});
});

/* The catalogue payload carries two voice lists because two kinds of surface
 * read it. Collapsing them into one is the change this guards against: `voices`
 * feeds the web app's bound-speaker lookup, which resolves BY BARE VOICE ID. */
describe("the catalogue separates what binds from what browses", () => {
	async function catalogue(): Promise<{
		voices: VoiceRow[];
		voice_provider: string;
		voice_providers: Array<{ id: string; label: string; health: string; voices: VoiceRow[] }>;
	}> {
		const res = await testApp(operationsRoutes()).request("/catalogue");
		expect(res.status).toBe(200);
		return await res.json();
	}

	it("keeps `voices` to the effective provider alone", async () => {
		const body = await catalogue();
		const effective = body.voice_providers.find((p) => p.id === body.voice_provider);
		expect(effective).toBeDefined();

		expect(body.voices.map((v) => v.id)).toEqual(effective!.voices.map((v) => v.id));
	});

	it("offers every registered provider under `voice_providers`", async () => {
		const body = await catalogue();

		// More than the effective one, or the browsing surfaces gained nothing.
		expect(body.voice_providers.length).toBeGreaterThan(1);
		for (const provider of body.voice_providers) {
			expect(provider.label.length).toBeGreaterThan(0);
			expect(["ready", "unconfigured", "down"]).toContain(provider.health);
		}
	});

	it("carries a provider that is registered but not effective", async () => {
		process.env.MALEO_KOKORO_URL = "http://127.0.0.1:9998";
		const body = await catalogue();
		const sandbox = body.voice_providers.find((p) => p.id === "sandbox");

		expect(body.voice_provider).toBe("kokoro");
		expect(sandbox?.voices.length).toBeGreaterThan(0);
		// Listed, and honestly reported as not currently able to serve.
		expect(sandbox?.health).toBe("unconfigured");
	});

	it("sends a sample location and a hue with every browsable voice", async () => {
		const body = await catalogue();

		for (const provider of body.voice_providers) {
			for (const voice of provider.voices) {
				expect(voice).toHaveProperty("sampleUrl");
				expect(typeof voice.hue).toBe("number");
			}
		}
	});
});
