/* Proof for task 2.5: with the API's source installed, a provider resolves a
 * value that exists ONLY in storage — no environment variable set.
 *
 * That is the whole point of the change: before this, a credential entered in
 * Settings reached nothing. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resolveConfig, setConfigSource, refreshConfig } from "@maleo/shared/provider-config";
import { setConfig } from "@maleo/db/config-resolution";
import { TEST_MASTER_KEY } from "@maleo/db/secret-store-testing";
import { MASTER_KEY_ENV, setSecret, unsetSecret } from "@maleo/db/secret-store";
import { installProviderConfigSource } from "./provider-config-source.ts";

const URL_KEY = "MALEO_KOKORO_URL";
const SECRET_KEY = "MALEO_TEST_PROVIDER_SECRET";

const saved = new Map<string, string | undefined>();
function setEnv(key: string, value: string | undefined): void {
	if (!saved.has(key)) saved.set(key, process.env[key]);
	if (value === undefined) delete process.env[key];
	else process.env[key] = value;
}

beforeEach(async () => {
	setEnv(MASTER_KEY_ENV, TEST_MASTER_KEY);
	setEnv(URL_KEY, undefined);
	setEnv(SECRET_KEY, undefined);
	await installProviderConfigSource();
});

afterEach(async () => {
	setConfigSource(null);
	await setConfig(URL_KEY, null);
	try {
		await unsetSecret(SECRET_KEY);
	} catch {
		/* nothing stored */
	}
	for (const [key, value] of saved) setEnv(key, value);
	saved.clear();
});

describe("the API's provider config source", () => {
	test("resolves a stored value with no environment variable set", async () => {
		await setConfig(URL_KEY, "http://stored-only:8880");
		await refreshConfig();
		expect(resolveConfig(URL_KEY)).toBe("http://stored-only:8880");
	});

	test("resolves a stored secret without being told it is one", async () => {
		await setSecret(SECRET_KEY, "sk-stored");
		await refreshConfig();
		expect(resolveConfig(SECRET_KEY)).toBe("sk-stored");
	});

	test("the environment still wins over a stored value", async () => {
		await setConfig(URL_KEY, "http://stored:8880");
		await refreshConfig();
		setEnv(URL_KEY, "http://from-env:9000");
		expect(resolveConfig(URL_KEY)).toBe("http://from-env:9000");
	});

	test("an unset key resolves to undefined", () => {
		expect(resolveConfig("MALEO_NOTHING_IS_HERE")).toBeUndefined();
	});
});
