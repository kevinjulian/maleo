/* Proof for task 1.11: env > stored > unset, and shadowing is reported. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { openTestDb, type TestDb } from "../../src/db/handle-testing.ts";
import type { Db } from "../../src/db/handle.ts";
import { encodeKey, generateKey } from "../../src/db/secret-crypto.ts";
import { MASTER_KEY_ENV, setSecret } from "../../src/db/secret-store.ts";
import { resolveConfig, setConfig, shadowedConfigKeys } from "../../src/db/config-resolution.ts";

const KEY = "MALEO_KOKORO_URL";
const SECRET_KEY = "FAL_KEY";

let db: Db;
let t: TestDb;
const original = {
	master: process.env[MASTER_KEY_ENV],
	key: process.env[KEY],
	secret: process.env[SECRET_KEY],
};

function setEnv(name: string, value: string | undefined): void {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}

beforeEach(async () => {
	t = await openTestDb("postgres");
	db = t.db;
	setEnv(MASTER_KEY_ENV, encodeKey(generateKey()));
	setEnv(KEY, undefined);
	setEnv(SECRET_KEY, undefined);
});

afterEach(async () => {
	await t.close();
	setEnv(MASTER_KEY_ENV, original.master);
	setEnv(KEY, original.key);
	setEnv(SECRET_KEY, original.secret);
});

describe("precedence", () => {
	test("unset when neither is present", async () => {
		expect(await resolveConfig(KEY, {}, db)).toMatchObject({
			value: undefined,
			source: "unset",
			shadowed: false,
		});
	});

	test("stored value is used when the environment is silent", async () => {
		await setConfig(KEY, "http://stored:8080", db);
		expect(await resolveConfig(KEY, {}, db)).toMatchObject({
			value: "http://stored:8080",
			source: "stored",
		});
	});

	test("environment wins when both are set", async () => {
		await setConfig(KEY, "http://stored:8080", db);
		setEnv(KEY, "http://from-env:9000");
		expect(await resolveConfig(KEY, {}, db)).toMatchObject({
			value: "http://from-env:9000",
			source: "env",
			shadowed: true,
		});
	});

	// An environment-only deployment must resolve exactly as before this change,
	// with no master key configured at all.
	test("environment resolves with no master key and nothing stored", async () => {
		setEnv(MASTER_KEY_ENV, undefined);
		setEnv(KEY, "http://from-env:9000");
		expect(await resolveConfig(KEY, {}, db)).toMatchObject({
			value: "http://from-env:9000",
			source: "env",
		});
	});

	test("a blank environment variable is not a value", async () => {
		await setConfig(KEY, "http://stored:8080", db);
		setEnv(KEY, "   ");
		expect(await resolveConfig(KEY, {}, db)).toMatchObject({ source: "stored" });
	});
});

describe("secrets", () => {
	test("a stored secret resolves through the secret store", async () => {
		await setSecret(SECRET_KEY, "sk-live-abc", db);
		expect(await resolveConfig(SECRET_KEY, { secret: true }, db)).toMatchObject({
			value: "sk-live-abc",
			source: "stored",
		});
	});

	test("environment overrides a stored secret and reports the shadow", async () => {
		await setSecret(SECRET_KEY, "sk-stored", db);
		setEnv(SECRET_KEY, "sk-from-env");
		expect(await resolveConfig(SECRET_KEY, { secret: true }, db)).toMatchObject({
			value: "sk-from-env",
			source: "env",
			shadowed: true,
		});
	});

	// Reporting an unreadable secret as absent would send the operator to
	// re-enter a credential that is perfectly intact.
	test("an unreadable stored secret reports an error rather than resolving unset", async () => {
		await setSecret(SECRET_KEY, "sk-stored", db);
		setEnv(MASTER_KEY_ENV, encodeKey(generateKey()));
		const resolved = await resolveConfig(SECRET_KEY, { secret: true }, db);
		expect(resolved.value).toBeUndefined();
		expect(resolved.error).toMatch(/different MALEO_MASTER_KEY/);
	});
});

describe("shadowed key report", () => {
	test("names only the keys an environment variable overrides", async () => {
		await setConfig(KEY, "http://stored", db);
		await setConfig("MALEO_MEDIA_WORKER_URL", "http://also-stored", db);
		await setSecret(SECRET_KEY, "sk-stored", db);
		setEnv(KEY, "http://from-env");
		setEnv(SECRET_KEY, "sk-from-env");

		const shadowed = await shadowedConfigKeys(
			[{ key: KEY }, { key: "MALEO_MEDIA_WORKER_URL" }, { key: SECRET_KEY, secret: true }],
			db,
		);
		expect(shadowed.sort()).toEqual([SECRET_KEY, KEY].sort());
	});

	test("reports nothing when nothing is shadowed", async () => {
		await setConfig(KEY, "http://stored", db);
		expect(await shadowedConfigKeys([{ key: KEY }], db)).toEqual([]);
	});
});
