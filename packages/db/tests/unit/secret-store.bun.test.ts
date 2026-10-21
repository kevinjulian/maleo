/* Proof for tasks 1.2, 1.4-1.10.
 *
 * The rotation cases are the ones that matter: the button is only safe to offer
 * if a restart with the OLD key still works. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { openTestDb, type TestDb } from "../../src/db/handle-testing.ts";
import type { Db } from "../../src/db/handle.ts";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	getGlobalSetting,
	listGlobalSettings,
	setGlobalSetting,
} from "../../src/db/global-settings.ts";
import { encodeKey, generateKey } from "../../src/db/secret-crypto.ts";
import {
	cancelRotation,
	completeRotationIfProven,
	getSecret,
	hasSecret,
	MASTER_KEY_ENV,
	resetSecretStorage,
	rotateMasterKey,
	secretStoreStatus,
	SecretStoreError,
	setSecret,
	unreadableSecretStorage,
	unsetSecret,
} from "../../src/db/secret-store.ts";

let db: Db;
let t: TestDb;
let dataDir: string;
const originalKey = process.env[MASTER_KEY_ENV];
const originalDataDir = process.env.MALEO_DATA_DIR;

function useKey(key: string | undefined): void {
	if (key === undefined) delete process.env[MASTER_KEY_ENV];
	else process.env[MASTER_KEY_ENV] = key;
}

beforeEach(async () => {
	t = await openTestDb("postgres");
	db = t.db;
	/* A temp data dir per test: a generated key is written to disk now, and a
	 * suite that wrote into the real one would leave a key behind on the
	 * developer's machine. */
	dataDir = mkdtempSync(join(tmpdir(), "maleo-secret-"));
	process.env.MALEO_DATA_DIR = dataDir;
	useKey(encodeKey(generateKey()));
});

afterEach(async () => {
	await t.close();
	rmSync(dataDir, { recursive: true, force: true });
	/* Restored, never deleted. Deleting removes the floor `test-db-guard.ts` puts
	 * under every suite, and a later test whose own path was cleared then opens the
	 * real `data/maleo.db`. Leaving this test's temp dir in place is harmless;
	 * clearing the variable is not. See test-db-guard-usage.test.ts. */
	if (originalDataDir !== undefined) process.env.MALEO_DATA_DIR = originalDataDir;
	useKey(originalKey);
});

describe("secret storage", () => {
	test("round-trips a secret", async () => {
		await setSecret("fal.api_key", "sk-live-abc", db);
		expect(await getSecret("fal.api_key", db)).toBe("sk-live-abc");
	});

	test("an unset secret reads as undefined", async () => {
		expect(await getSecret("nothing.here", db)).toBeUndefined();
		expect(await hasSecret("nothing.here", db)).toBe(false);
	});

	// The core promise of encryption at rest.
	test("plaintext appears nowhere in a raw table dump", async () => {
		await setSecret("fal.api_key", "hunter2-plaintext", db);
		const dump = (
			await db.all<{ key: string; value: string }>("SELECT key, value FROM global_settings")
		)
			.map((r) => `${r.key}=${r.value}`)
			.join("\n");
		expect(dump).not.toContain("hunter2-plaintext");
	});

	test("removal is explicit and an empty value is refused", async () => {
		await setSecret("a.b", "value", db);
		await expect(setSecret("a.b", "   ", db)).rejects.toThrow(SecretStoreError);
		expect(await getSecret("a.b", db)).toBe("value");
		await unsetSecret("a.b", db);
		expect(await getSecret("a.b", db)).toBeUndefined();
	});
});

describe("reserved namespace", () => {
	test("a general listing excludes secrets and the envelope", async () => {
		await setGlobalSetting("media.provider.image", "cloudflare", db);
		await setSecret("fal.api_key", "sk-live-abc", db);
		const keys = (await listGlobalSettings(db)).map((r) => r.key);
		expect(keys).toContain("media.provider.image");
		expect(keys.some((k) => k.startsWith("secret."))).toBe(false);
	});
});

describe("master key requirement", () => {
	/* The behaviour that used to be a refusal.
	 *
	 * Refusing was guarding a real failure — a process that invents a key per boot
	 * leaves every secret it wrote unreadable — but that failure comes from a key
	 * that cannot PERSIST, not from generating one. Written to disk first, a
	 * generated key is safe, and it is the difference between an operator storing
	 * a credential and being told to go set an environment variable they have
	 * never heard of. */
	test("with no master key anywhere, one is generated and the secret is stored", async () => {
		useKey(undefined);
		await setSecret("fal.api_key", "sk-live-abc", db);
		expect(await getSecret("fal.api_key", db)).toBe("sk-live-abc");
		expect(existsSync(join(dataDir, "master.key"))).toBe(true);
	});

	test("the generated key is owner-only on disk", async () => {
		useKey(undefined);
		await setSecret("fal.api_key", "sk-live-abc", db);
		expect(statSync(join(dataDir, "master.key")).mode & 0o777).toBe(0o600);
	});

	// The whole point: it has to be the SAME key next time.
	test("a generated key is reused rather than reinvented", async () => {
		useKey(undefined);
		await setSecret("fal.api_key", "sk-live-abc", db);
		const first = readFileSync(join(dataDir, "master.key"), "utf8");
		await setSecret("other.key", "second", db);
		expect(readFileSync(join(dataDir, "master.key"), "utf8")).toBe(first);
		expect(await getSecret("fal.api_key", db)).toBe("sk-live-abc");
	});

	// Reading must not be what brings a key into existence.
	test("reading does not generate a key", async () => {
		useKey(undefined);
		expect(await getSecret("nothing.stored", db)).toBeUndefined();
		expect(existsSync(join(dataDir, "master.key"))).toBe(false);
	});

	test("the environment wins over a key on disk", async () => {
		useKey(undefined);
		await setSecret("fal.api_key", "sk-from-file", db);
		// A different key in the environment cannot open what the file's key wrote.
		useKey(encodeKey(generateKey()));
		await expect(getSecret("fal.api_key", db)).rejects.toThrow(SecretStoreError);
	});

	test("a malformed master key is refused", async () => {
		useKey("not-a-32-byte-key");
		await expect(setSecret("fal.api_key", "sk", db)).rejects.toThrow(/32 bytes/);
	});

	// Task 1.8: the failure an operator sees must name the cause. Reporting a
	// key problem as "unconfigured" sends them to re-enter credentials that are
	// perfectly intact.
	test("a changed master key reports as changed, not as absent or corrupt", async () => {
		await setSecret("fal.api_key", "sk-live-abc", db);
		useKey(encodeKey(generateKey()));
		try {
			await getSecret("fal.api_key", db);
			throw new Error("expected getSecret to throw");
		} catch (error) {
			expect(error).toBeInstanceOf(SecretStoreError);
			expect((error as SecretStoreError).reason).toBe("master_key_changed");
		}
	});

	test("a missing master key reports as absent", async () => {
		await setSecret("fal.api_key", "sk-live-abc", db);
		useKey(undefined);
		// The key that wrote it came from the environment and was never written to
		// disk, so with the environment cleared there is nothing to read.
		try {
			await getSecret("fal.api_key", db);
			throw new Error("expected getSecret to throw");
		} catch (error) {
			expect((error as SecretStoreError).reason).toBe("no_master_key");
		}
	});

	test("status distinguishes the four states", async () => {
		useKey(undefined);
		expect((await secretStoreStatus(db)).state).toBe("absent");
		// Reporting must not create one either.
		expect(existsSync(join(dataDir, "master.key"))).toBe(false);

		const key = encodeKey(generateKey());
		useKey(key);
		expect((await secretStoreStatus(db)).state).toBe("uninitialized");

		await setSecret("a.b", "v", db);
		expect((await secretStoreStatus(db)).state).toBe("ready");

		useKey(encodeKey(generateKey()));
		expect((await secretStoreStatus(db)).state).toBe("changed");
	});

	/* Two tests, not one: a store written under the environment's key cannot then
	 * be opened by a generated one, so switching source mid-test asserts the
	 * changed-key guard rather than the reporting. Each starts from a fresh db and
	 * data directory. */
	test("status names the environment as the source when it carries the key", async () => {
		useKey(encodeKey(generateKey()));
		await setSecret("a.b", "v", db);
		expect((await secretStoreStatus(db)).source).toBe("env");
	});

	test("status names the file as the source when the key was generated", async () => {
		useKey(undefined);
		await setSecret("a.b", "v", db);
		const status = await secretStoreStatus(db);
		expect(status.source).toBe("file");
		expect(status.path).toBe(join(dataDir, "master.key"));
	});

	test("status reports a fingerprint but never the key", async () => {
		const key = encodeKey(generateKey());
		useKey(key);
		await setSecret("a.b", "v", db);
		const status = await secretStoreStatus(db);
		expect(status.fingerprint).toBeTruthy();
		expect(status.fingerprint).not.toBe(key);
	});
});

/* The way out of a lost key.
 *
 * Without this the store is bricked: the envelope cannot be opened, so every
 * write fails — including the writes an operator would make to "re-enter the
 * credentials", which is what the error tells them to do. */
describe("recovering from a lost master key", () => {
	test("reports how many stored secrets a reset would destroy", async () => {
		await setSecret("a.b", "one", db);
		await setSecret("c.d", "two", db);
		expect((await unreadableSecretStorage(db)).secretCount).toBe(2);
	});

	test("after a reset, credentials can be stored again under the new key", async () => {
		await setSecret("a.b", "written-under-the-old-key", db);
		useKey(encodeKey(generateKey()));

		// The state an operator is stuck in: the store cannot be read OR written.
		expect((await secretStoreStatus(db)).state).toBe("changed");
		await expect(setSecret("a.b", "retyped", db)).rejects.toThrow(SecretStoreError);

		const removed = await resetSecretStorage(db);
		expect(removed.secretCount).toBe(1);

		await setSecret("a.b", "retyped", db);
		expect(await getSecret("a.b", db)).toBe("retyped");
	});

	test("a reset removes the envelope as well as the secrets", async () => {
		await setSecret("a.b", "one", db);
		await resetSecretStorage(db);
		expect(
			await db.get("SELECT COUNT(*) AS n FROM global_settings WHERE key LIKE 'secret.%'"),
		).toMatchObject({ n: 0 });
	});

	/* Deliberately not automatic: a mismatch is more often a misconfiguration
	 * than a loss, and wiping on sight would destroy secrets the correct key
	 * could still open. */
	test("a changed key alone destroys nothing", async () => {
		await setSecret("a.b", "still-here", db);
		const key = process.env[MASTER_KEY_ENV] as string;
		useKey(encodeKey(generateKey()));
		await expect(getSecret("a.b", db)).rejects.toThrow(SecretStoreError);

		useKey(key);
		expect(await getSecret("a.b", db)).toBe("still-here");
	});
});

/* Rotation finishes differently depending on where the key lives, because that
 * decides whether this process can put the new key where the next one looks.
 *
 * The pending state exists ONLY for an environment-held key: the app cannot write
 * the environment, so the old key has to keep working until a restart proves the
 * operator placed the new one. With a key file the app writes both sides, and a
 * pending state would be a confirmation step for something already done. */
describe("rotating a key kept in a file", () => {
	async function useFileKey(): Promise<void> {
		useKey(undefined);
		await setSecret("seed.a", "value", db);
	}

	test("completes immediately, with nothing to confirm", async () => {
		await useFileKey();
		const result = await rotateMasterKey(db);
		expect(result.pending).toBe(false);
		expect(result.source).toBe("file");
		expect((await secretStoreStatus(db)).rotationPending).toBe(false);
	});

	test("hands back no key, because there is nothing for an operator to do with it", async () => {
		await useFileKey();
		expect((await rotateMasterKey(db)).key).toBeUndefined();
	});

	test("secrets stay readable and the key file is the new one", async () => {
		await useFileKey();
		const before = readFileSync(join(dataDir, "master.key"), "utf8");
		await rotateMasterKey(db);
		const after = readFileSync(join(dataDir, "master.key"), "utf8");
		expect(after).not.toBe(before);
		expect(await getSecret("seed.a", db)).toBe("value");
	});

	test("the previous key no longer opens the store", async () => {
		await useFileKey();
		const before = readFileSync(join(dataDir, "master.key"), "utf8");
		await rotateMasterKey(db);
		useKey(before);
		expect((await secretStoreStatus(db)).state).toBe("changed");
	});

	test("leaves exactly one wrapping", async () => {
		await useFileKey();
		await rotateMasterKey(db);
		const envelope = JSON.parse((await getGlobalSetting("secret.__envelope", db)) as string) as {
			wrappings: unknown[];
			pending?: string;
		};
		expect(envelope.wrappings).toHaveLength(1);
		expect(envelope.pending).toBeUndefined();
	});
});

describe("master key rotation", () => {
	/* These cover the ENVIRONMENT-held key, where the pending state belongs.
	 * `beforeEach` puts a key there, so they already stand in that case. */
	test("secrets survive rotation without being re-encrypted", async () => {
		await setSecret("fal.api_key", "sk-live-abc", db);
		const before = await getGlobalSetting("secret.fal.api_key", db);

		const { key: newKey } = await rotateMasterKey(db);

		// The whole point of the envelope: the secret's own ciphertext is untouched,
		// so an operator never reconfigures a provider after rotating.
		expect(await getGlobalSetting("secret.fal.api_key", db)).toBe(before);

		useKey(newKey);
		expect(await getSecret("fal.api_key", db)).toBe("sk-live-abc");
	});

	// THE case that makes the button safe to offer. process.env is fixed at boot,
	// so between rotating and the operator pasting the key into their deployment,
	// a restart still has the old key. That must keep working.
	test("a restart with the OLD key still reads every secret", async () => {
		const oldKey = process.env[MASTER_KEY_ENV] as string;
		await setSecret("fal.api_key", "sk-live-abc", db);
		await rotateMasterKey(db);

		useKey(oldKey);
		expect(await getSecret("fal.api_key", db)).toBe("sk-live-abc");
		expect((await secretStoreStatus(db)).state).toBe("ready");
	});

	test("rotation is reported pending until a startup proves the new key", async () => {
		const oldKey = process.env[MASTER_KEY_ENV] as string;
		await setSecret("fal.api_key", "sk-live-abc", db);
		const { key: newKey } = await rotateMasterKey(db);

		expect((await secretStoreStatus(db)).rotationPending).toBe(true);

		// Booting with the old key does NOT complete it — nothing has proven the
		// operator saved the new one.
		useKey(oldKey);
		expect(await completeRotationIfProven(db)).toBe(false);
		expect((await secretStoreStatus(db)).rotationPending).toBe(true);
		expect(await getSecret("fal.api_key", db)).toBe("sk-live-abc");

		useKey(newKey);
		expect(await completeRotationIfProven(db)).toBe(true);
		expect((await secretStoreStatus(db)).rotationPending).toBe(false);
		expect(await getSecret("fal.api_key", db)).toBe("sk-live-abc");
	});

	test("once rotation completes the old key no longer opens the store", async () => {
		const oldKey = process.env[MASTER_KEY_ENV] as string;
		await setSecret("fal.api_key", "sk-live-abc", db);
		const { key: newKey } = await rotateMasterKey(db);

		useKey(newKey);
		await completeRotationIfProven(db);

		useKey(oldKey);
		expect((await secretStoreStatus(db)).state).toBe("changed");
	});

	test("completing is a no-op when no rotation is pending", async () => {
		await setSecret("a.b", "v", db);
		expect(await completeRotationIfProven(db)).toBe(false);
	});

	test("rotating twice before confirmation keeps every key working", async () => {
		const oldKey = process.env[MASTER_KEY_ENV] as string;
		await setSecret("a.b", "v", db);
		const first = (await rotateMasterKey(db)).key;
		const second = (await rotateMasterKey(db)).key;

		for (const key of [oldKey, first, second]) {
			useKey(key);
			expect(await getSecret("a.b", db)).toBe("v");
		}
	});
});

/* A rotation the operator could not finish.
 *
 * It completes only on a restart carrying the new key. Lose that key before
 * saving it and the pending state is permanent — the surface reports a waiting
 * rotation forever, and nothing clears it. */
describe("abandoning a rotation", () => {
	test("clears the pending state and keeps every secret readable", async () => {
		const key = process.env[MASTER_KEY_ENV] as string;
		await setSecret("a.b", "value", db);
		await rotateMasterKey(db);
		expect((await secretStoreStatus(db)).rotationPending).toBe(true);

		useKey(key);
		expect(await cancelRotation(db)).toBe(true);
		expect((await secretStoreStatus(db)).rotationPending).toBe(false);
		expect(await getSecret("a.b", db)).toBe("value");
	});

	test("the discarded key no longer opens the store", async () => {
		await setSecret("a.b", "value", db);
		const { key: abandoned } = await rotateMasterKey(db);
		await cancelRotation(db);

		useKey(abandoned);
		expect((await secretStoreStatus(db)).state).toBe("changed");
	});

	test("does nothing when no rotation is pending", async () => {
		await setSecret("a.b", "value", db);
		expect(await cancelRotation(db)).toBe(false);
	});

	/* Never leave the store with no wrapping the available key can open: that
	 * would turn an abandoned rotation into total loss. */
	test("refuses when the key in force is not among the wrappings", async () => {
		await setSecret("a.b", "value", db);
		await rotateMasterKey(db);
		useKey(encodeKey(generateKey()));
		expect(await cancelRotation(db)).toBe(false);
	});
});
