/* The catalogue is declared voices unioned with the calling workspace's clones.
 *
 * Kept in its own file because it needs a database, and
 * voice-catalogue-source.bun.test.ts deliberately touches none: its whole point is
 * that adding a provider changes nothing in it.
 */
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeMaleoDb, openDb } from "@maleo/db/connection";
import { createVoiceClone, softDeleteVoiceClone } from "@maleo/db/voice-clone";
import { getProvider } from "@maleo/media/providers";
import { voicesForProvider } from "./voice-catalogue-source.ts";

const dbPath = join(
	tmpdir(),
	`voice-union-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
);
const priorDbPath = process.env.MALEO_DB_PATH;

const WS = "acme";
const OTHER = "globex";
const POCKET = "pocket-tts-id";

function declaredIds(provider: string): string[] {
	return (getProvider(provider)?.meta.tts?.voices ?? []).map((v) => v.id);
}

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

beforeEach(async () => {
	process.env.MALEO_DB_PATH = dbPath;
	await closeMaleoDb();
	await openDb().run("DELETE FROM voice_clone");
});

afterAll(async () => {
	await closeMaleoDb();
	if (priorDbPath === undefined) delete process.env.MALEO_DB_PATH;
	else process.env.MALEO_DB_PATH = priorDbPath;
	rmSync(dbPath, { force: true });
});

describe("a workspace's clones join the catalogue", () => {
	it("lists a clone as an ordinary voice, with its own id", async () => {
		const created = await clone({ label: "Bu Sri", gender: "female" });
		const voices = await voicesForProvider(POCKET, WS);
		expect(voices.map((v) => v.id)).toEqual([created.id]);
		expect(voices[0]).toMatchObject({ name: "Bu Sri", lang: "ID", gender: "female", cloned: true });
	});

	it("auditions a clone through the recording it was created from", async () => {
		await clone();
		expect((await voicesForProvider(POCKET, WS))[0]?.sampleUrl).toBe(
			"/uploads/voice-clone-abc.wav",
		);
	});

	it("colours a clone by the same rule as every other voice", async () => {
		const created = await clone();
		const voice = (await voicesForProvider(POCKET, WS))[0]!;
		expect(voice.hue).toBe(
			(await voicesForProvider(POCKET, WS)).find((v) => v.id === created.id)!.hue,
		);
		expect(voice.hue).toBeGreaterThanOrEqual(0);
		expect(voice.hue).toBeLessThan(360);
	});

	it("appends clones after the provider's declared voices", async () => {
		const created = await clone({ providerId: "kokoro" });
		const ids = (await voicesForProvider("kokoro", WS)).map((v) => v.id);
		expect(ids.slice(0, declaredIds("kokoro").length)).toEqual(declaredIds("kokoro"));
		expect(ids.at(-1)).toBe(created.id);
	});
});

describe("a workspace with no clones sees no change", () => {
	it("returns exactly the declared list", async () => {
		expect((await voicesForProvider("kokoro", WS)).map((v) => v.id)).toEqual(declaredIds("kokoro"));
	});

	it("returns the declared list when no workspace is given at all", async () => {
		await clone();
		expect((await voicesForProvider(POCKET)).map((v) => v.id)).toEqual(declaredIds(POCKET));
	});

	it("leaves a cloning provider with an empty catalogue until one is created", async () => {
		expect(await voicesForProvider(POCKET, WS)).toEqual([]);
	});
});

describe("clones do not leak", () => {
	it("hides one workspace's clones from another", async () => {
		await clone();
		expect(await voicesForProvider(POCKET, OTHER)).toEqual([]);
	});

	it("does not offer a clone under a provider that cannot speak it", async () => {
		await clone({ providerId: POCKET });
		expect((await voicesForProvider("kokoro", WS)).map((v) => v.id)).toEqual(declaredIds("kokoro"));
	});

	it("drops a removed clone from the catalogue", async () => {
		const created = await clone();
		await softDeleteVoiceClone(WS, created.id);
		expect(await voicesForProvider(POCKET, WS)).toEqual([]);
	});
});
