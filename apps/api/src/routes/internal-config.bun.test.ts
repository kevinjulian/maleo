/* Proof for tasks 4.1 and 4.2.
 *
 * This endpoint hands out decrypted credentials, so its refusals matter more than
 * its successes. The case worth staring at is "no token configured": the
 * convenient default of allowing everything when unset means a deployment that
 * forgot to set a token serves every credential to anyone who asks, silently. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { encodeKey, generateKey } from "@maleo/db/secret-crypto";
import { TEST_MASTER_KEY } from "@maleo/db/secret-store-testing";
import { MASTER_KEY_ENV, setSecret, unsetSecret } from "@maleo/db/secret-store";
import { setConfig } from "@maleo/db/config-resolution";
import { SERVICE_TOKEN_ENV } from "../lib/service-token.ts";
import { internalConfigRoutes } from "./internal-config.ts";

const TOKEN = "service-token-for-tests";
const KOKORO_URL = "MALEO_KOKORO_URL";
const CF_TOKEN = "MALEO_CF_API_TOKEN";
const CF_ACCOUNT = "MALEO_CF_ACCOUNT_ID";

const app = internalConfigRoutes();

/* One master key for the whole suite. A fresh key per test would leave the
 * envelope created by the first test unopenable by the second — the store is
 * shared, so rotating the key is a suite-wide act, not a per-test one. The test
 * that needs a CHANGED key changes it after storing. */
const MASTER = TEST_MASTER_KEY;

const saved = new Map<string, string | undefined>();
function setEnv(key: string, value: string | undefined): void {
	if (!saved.has(key)) saved.set(key, process.env[key]);
	if (value === undefined) delete process.env[key];
	else process.env[key] = value;
}

async function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
	return await app.fetch(new Request(`http://internal${path}`, { headers }));
}

const auth = { authorization: `Bearer ${TOKEN}` };

beforeEach(() => {
	setEnv(SERVICE_TOKEN_ENV, TOKEN);
	setEnv(MASTER_KEY_ENV, MASTER);
	setEnv(KOKORO_URL, undefined);
	setEnv(CF_TOKEN, undefined);
	setEnv(CF_ACCOUNT, undefined);
});

afterEach(async () => {
	await setConfig(KOKORO_URL, null);
	await setConfig(CF_ACCOUNT, null);
	try {
		await unsetSecret(CF_TOKEN);
	} catch {
		/* nothing stored */
	}
	for (const [key, value] of saved) setEnv(key, value);
	saved.clear();
});

describe("authentication", () => {
	test("a valid token returns the provider's resolved configuration", async () => {
		await setConfig(KOKORO_URL, "http://stored:8880");
		const res = await get("/provider-config/kokoro", auth);
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			provider: "kokoro",
			values: { [KOKORO_URL]: "http://stored:8880" },
		});
	});

	test("the x-service-token header is accepted too", async () => {
		await setConfig(KOKORO_URL, "http://stored:8880");
		const res = await get("/provider-config/kokoro", { "x-service-token": TOKEN });
		expect(res.status).toBe(200);
	});

	test("a wrong token is refused", async () => {
		const res = await get("/provider-config/kokoro", { authorization: "Bearer wrong" });
		expect(res.status).toBe(401);
	});

	test("no credential at all is refused", async () => {
		expect((await get("/provider-config/kokoro")).status).toBe(401);
	});

	// The default that would be convenient and catastrophic.
	test("with no token configured, every request is refused", async () => {
		setEnv(SERVICE_TOKEN_ENV, undefined);
		await setConfig(KOKORO_URL, "http://stored:8880");

		const withToken = await get("/provider-config/kokoro", auth);
		const without = await get("/provider-config/kokoro");

		expect(withToken.status).toBe(401);
		expect(without.status).toBe(401);
		expect(await withToken.text()).not.toContain("stored:8880");
	});

	test("an empty token does not authenticate against an unset one", async () => {
		setEnv(SERVICE_TOKEN_ENV, undefined);
		const res = await get("/provider-config/kokoro", { authorization: "Bearer " });
		expect(res.status).toBe(401);
	});
});

describe("what it will serve", () => {
	test("secrets resolve for an authenticated caller", async () => {
		await setConfig(CF_ACCOUNT, "acct-1");
		await setSecret(CF_TOKEN, "cf-secret-value");
		const body = await (await get("/provider-config/cloudflare-ai", auth)).json();
		expect(body.values[CF_TOKEN]).toBe("cf-secret-value");
		expect(body.values[CF_ACCOUNT]).toBe("acct-1");
	});

	// Only declared keys. Otherwise the endpoint is a read-any-setting oracle for
	// anyone who guesses a key name.
	test("undeclared keys are never served", async () => {
		await setConfig("MALEO_SOMETHING_ELSE", "should-not-appear");
		const body = await (await get("/provider-config/kokoro", auth)).json();
		expect(Object.keys(body.values)).toEqual(expect.not.arrayContaining(["MALEO_SOMETHING_ELSE"]));
		await setConfig("MALEO_SOMETHING_ELSE", null);
	});

	test("an unknown provider is refused, not described", async () => {
		const res = await get("/provider-config/no-such-provider", auth);
		expect(res.status).toBe(401);
		expect(await res.text()).not.toContain("no-such-provider");
	});

	test("an unreadable stored secret is reported rather than omitted", async () => {
		await setSecret(CF_TOKEN, "cf-secret-value");
		setEnv(MASTER_KEY_ENV, encodeKey(generateKey()));
		const body = await (await get("/provider-config/cloudflare-ai", auth)).json();
		expect(body.values[CF_TOKEN]).toBeUndefined();
		expect(body.errors?.[CF_TOKEN]).toMatch(/MALEO_MASTER_KEY/);
	});
});

describe("it is not part of the public surface", () => {
	test("no CORS headers are emitted", async () => {
		await setConfig(KOKORO_URL, "http://stored:8880");
		const res = await get("/provider-config/kokoro", { ...auth, origin: "http://evil.example" });
		expect(res.headers.get("access-control-allow-origin")).toBeNull();
		expect(res.headers.get("access-control-allow-credentials")).toBeNull();
	});
});
