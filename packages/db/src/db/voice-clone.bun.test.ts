/* Cloned voices. Points MALEO_DB_PATH at a throwaway file so the shared
 * maleo.db is never touched. */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createVoiceClone,
	getVoiceClone,
	getVoiceCloneForAttribution,
	listVoiceClones,
	softDeleteVoiceClone,
} from "./voice-clone.ts";
import { closeMaleoDb, openDb } from "./connection.ts";

const tmpDir = mkdtempSync(join(tmpdir(), "voice-clone-"));
process.env.MALEO_DB_PATH = join(tmpDir, "test.db");

const WS = "acme";
const OTHER = "globex";
const PROVIDER = "pocket-tts-id";

function input(over: Partial<Parameters<typeof createVoiceClone>[0]> = {}) {
	return {
		workspace: WS,
		providerId: PROVIDER,
		label: "Narrator",
		lang: "id",
		refUrl: "/uploads/voice-1.wav",
		...over,
	};
}

beforeEach(async () => {
	await openDb().run("DELETE FROM voice_clone");
});

afterAll(async () => {
	await closeMaleoDb();
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("create and read", () => {
	test("round-trips every field and mints a recognisable id", async () => {
		const created = await createVoiceClone(input({ gender: "female" }));
		expect(created.id).toStartWith("vc_");
		expect(await getVoiceClone(WS, created.id)).toEqual(created);
		expect(created.lang).toBe("id");
		expect(created.gender).toBe("female");
		expect(created.refUrl).toBe("/uploads/voice-1.wav");
	});

	test("gender is optional, because it is declared rather than detected", async () => {
		const created = await createVoiceClone(input());
		expect(created.gender).toBeNull();
	});

	test("two clones from the same audio are still two voices", async () => {
		const first = await createVoiceClone(input());
		const second = await createVoiceClone(input());
		expect(second.id).not.toBe(first.id);
	});
});

describe("workspace scoping", () => {
	test("a clone is listed in the workspace that created it", async () => {
		const created = await createVoiceClone(input());
		expect((await listVoiceClones(WS, PROVIDER)).map((v) => v.id)).toEqual([created.id]);
	});

	test("a clone is invisible to another workspace", async () => {
		const created = await createVoiceClone(input());
		expect(await listVoiceClones(OTHER, PROVIDER)).toEqual([]);
		expect(await getVoiceClone(OTHER, created.id)).toBeNull();
	});

	test("a clone is not offered under another provider", async () => {
		await createVoiceClone(input());
		expect(await listVoiceClones(WS, "kokoro")).toEqual([]);
	});
});

describe("removal", () => {
	test("a removed clone leaves every listing and lookup", async () => {
		const created = await createVoiceClone(input());
		expect(await softDeleteVoiceClone(WS, created.id)).toBe(true);
		expect(await listVoiceClones(WS, PROVIDER)).toEqual([]);
		expect(await getVoiceClone(WS, created.id)).toBeNull();
	});

	test("a removed clone still resolves for attributing past spend", async () => {
		const created = await createVoiceClone(input());
		await softDeleteVoiceClone(WS, created.id);
		expect((await getVoiceCloneForAttribution(created.id))?.label).toBe("Narrator");
	});

	test("removing twice reports that the second removal hid nothing", async () => {
		const created = await createVoiceClone(input());
		expect(await softDeleteVoiceClone(WS, created.id)).toBe(true);
		expect(await softDeleteVoiceClone(WS, created.id)).toBe(false);
	});

	test("another workspace cannot remove a clone it cannot see", async () => {
		const created = await createVoiceClone(input());
		expect(await softDeleteVoiceClone(OTHER, created.id)).toBe(false);
		expect(await getVoiceClone(WS, created.id)).not.toBeNull();
	});
});
