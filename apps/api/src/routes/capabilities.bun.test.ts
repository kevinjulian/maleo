/* Proof for tasks 5.2-5.8. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { TEST_MASTER_KEY } from "@maleo/db/secret-store-testing";
import { MASTER_KEY_ENV, getSecret, setSecret, unsetSecret } from "@maleo/db/secret-store";
import { encodeKey, generateKey } from "@maleo/db/secret-crypto";
import { resolveConfig, setConfig } from "@maleo/db/config-resolution";
import { setGlobalSetting, setGlobalTtsProvider } from "@maleo/db/global-settings";
import { installProviderConfigSource } from "../lib/provider-config-source.ts";
import { capabilitiesRoutes, providerRoutes, securityRoutes } from "./capabilities.ts";
import { openDb } from "@maleo/db/connection";
import { clearStockCache, setFreesoundFetchForTests, setPexelsFetchForTests } from "@maleo/stock";
import { stockRoutes } from "./stock.ts";
import { testApp } from "../middleware/auth-testing.ts";

import { createMediaClient } from "@maleo/media/api";
import { setMediaClientForTests } from "../lib/image-gen-client.ts";
import { VIDEO_PROVIDER_SETTING } from "../lib/generation/video-generator.ts";
const capabilities = capabilitiesRoutes();
const providers = providerRoutes();
const security = securityRoutes();
const stock = stockRoutes();

/* The routes use the default handle, so the tests write through the same one. */
const db = () => openDb();

const KOKORO_URL = "MALEO_KOKORO_URL";
const CF_TOKEN = "MALEO_CF_API_TOKEN";
const CF_ACCOUNT = "MALEO_CF_ACCOUNT_ID";
const MASTER = TEST_MASTER_KEY;
const PEXELS_KEY = "PEXELS_API_KEY";
const FREESOUND_KEY = "FREESOUND_API_KEY";
const FREESOUND_APPROVAL = "FREESOUND_COMMERCIAL_USE_APPROVED";

const saved = new Map<string, string | undefined>();
function setEnv(key: string, value: string | undefined): void {
	if (!saved.has(key)) saved.set(key, process.env[key]);
	if (value === undefined) delete process.env[key];
	else process.env[key] = value;
}

async function call(
	app: typeof capabilities,
	method: string,
	path: string,
	body?: unknown,
): Promise<Response> {
	return await testApp(app).fetch(
		new Request(`http://api${path}`, {
			method,
			...(body === undefined
				? {}
				: { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
		}),
	);
}

beforeEach(async () => {
	setMediaClientForTests(
		createMediaClient({
			baseUrl: "http://worker.test",
			fetch: async () => Response.json({ video: { sandbox: "ready", fal: "unconfigured" } }),
		}),
	);
	await setGlobalSetting(VIDEO_PROVIDER_SETTING, null);
	/* What `index.ts` does at startup. Without it providers resolve from the
	 * process environment alone and a stored value reaches nothing — which is
	 * exactly the bug this change exists to fix, so the test has to stand where
	 * production stands. */
	await installProviderConfigSource();
	setEnv(MASTER_KEY_ENV, MASTER);
	setEnv(KOKORO_URL, undefined);
	setEnv(CF_TOKEN, undefined);
	setEnv(CF_ACCOUNT, undefined);
	setEnv(PEXELS_KEY, undefined);
	setEnv(FREESOUND_KEY, undefined);
	setEnv(FREESOUND_APPROVAL, undefined);
	await setGlobalTtsProvider(null);
});

afterEach(async () => {
	setMediaClientForTests(undefined);
	await setGlobalSetting(VIDEO_PROVIDER_SETTING, null);
	await setConfig(KOKORO_URL, null);
	await setConfig(CF_ACCOUNT, null);
	await setConfig(FREESOUND_APPROVAL, null);
	await setGlobalTtsProvider(null);
	for (const key of [CF_TOKEN, PEXELS_KEY, FREESOUND_KEY]) {
		try {
			await unsetSecret(key);
		} catch {
			/* nothing stored */
		}
	}
	setPexelsFetchForTests(null);
	setFreesoundFetchForTests(null);
	clearStockCache();
	for (const [key, value] of saved) setEnv(key, value);
	saved.clear();
});

describe("listing capabilities", () => {
	test("returns every capability, provider-keyed registries unioned", async () => {
		const body = await (await call(capabilities, "GET", "/")).json();
		const ids = body.capabilities.map((c: { id: string }) => c.id);
		expect(ids).toEqual([
			"text",
			"image",
			"tts",
			"research",
			"video",
			"captions",
			"stock-visuals",
			"sound-effects",
		]);
	});

	// A capability with no providers is LISTED, not omitted — otherwise the
	// surface's completeness depends on state and an operator cannot tell "this
	// app cannot do video" from "video is configured elsewhere".
	test("video lists providers but stays not_configured without explicit mock selection", async () => {
		const body = await (await call(capabilities, "GET", "/")).json();
		const video = body.capabilities.find((c: { id: string }) => c.id === "video");
		expect(video.providers.map((provider: { id: string }) => provider.id)).toEqual(
			expect.arrayContaining(["sandbox", "fal"]),
		);
		expect(video.state).toBe("not_configured");
	});

	test("a capability with providers lists them from the registry", async () => {
		const body = await (await call(capabilities, "GET", "/")).json();
		const tts = body.capabilities.find((c: { id: string }) => c.id === "tts");
		expect(tts.providers.map((p: { id: string }) => p.id)).toContain("kokoro");
	});

	test("configuring a provider flips its capability to ready", async () => {
		await setConfig(KOKORO_URL, "http://kokoro:8880");
		const body = await (await call(capabilities, "GET", "/")).json();
		const tts = body.capabilities.find((c: { id: string }) => c.id === "tts");
		expect(tts.state).toBe("ready");
	});

	test("stock capabilities use exact consumer labels and fixed providers", async () => {
		const body = await (await call(capabilities, "GET", "/")).json();
		const visuals = body.capabilities.find((c: { id: string }) => c.id === "stock-visuals");
		const sounds = body.capabilities.find((c: { id: string }) => c.id === "sound-effects");
		expect(visuals).toMatchObject({
			label: "Stock visuals",
			state: "not_configured",
			activeProviderId: "pexels",
		});
		expect(visuals.providers).toEqual([
			{ id: "pexels", label: "Pexels", state: "unconfigured", active: true },
		]);
		expect(sounds).toMatchObject({
			label: "Sound effects",
			state: "not_configured",
			activeProviderId: "freesound",
		});
		expect(sounds.providers).toEqual([
			{ id: "freesound", label: "Freesound", state: "unconfigured", active: true },
		]);
		expect(body.capabilities.some((c: { id: string }) => c.id === "stock-assets")).toBe(false);
	});

	test("stored stock credentials make real capabilities ready", async () => {
		await setSecret(PEXELS_KEY, "stored-pexels");
		await setSecret(FREESOUND_KEY, "stored-freesound");
		await setConfig(FREESOUND_APPROVAL, "yes");
		const body = await (await call(capabilities, "GET", "/")).json();
		expect(body.capabilities.find((c: { id: string }) => c.id === "stock-visuals").state).toBe(
			"ready",
		);
		expect(body.capabilities.find((c: { id: string }) => c.id === "sound-effects").state).toBe(
			"ready",
		);
	});
});

describe("activating a provider", () => {
	test("one endpoint activates for any capability", async () => {
		await setConfig(KOKORO_URL, "http://kokoro:8880");
		const res = await call(capabilities, "PUT", "/tts/provider", { provider_id: "kokoro" });
		expect(res.status).toBe(200);
		expect((await res.json()).active_provider_id).toBe("kokoro");
	});

	test("refuses a provider that does not serve the capability", async () => {
		const res = await call(capabilities, "PUT", "/tts/provider", { provider_id: "cloudflare-ai" });
		expect(res.status).toBe(400);
		expect((await res.json()).error).toBe("provider_does_not_serve_capability");
	});

	// Storing an unconfigured choice makes the surface report a selection that
	// fails at every later request.
	test("refuses an unconfigured provider and stores nothing", async () => {
		const res = await call(capabilities, "PUT", "/tts/provider", { provider_id: "kokoro" });
		expect(res.status).toBe(400);
		expect((await res.json()).error).toBe("provider_unconfigured");

		const body = await (await call(capabilities, "GET", "/")).json();
		expect(
			body.capabilities.find((c: { id: string }) => c.id === "tts").activeProviderId,
		).toBeNull();
	});

	test("an unknown capability is a 404", async () => {
		expect((await call(capabilities, "PUT", "/nope/provider", { provider_id: "x" })).status).toBe(
			404,
		);
	});

	test("clearing the selection is allowed", async () => {
		await setConfig(KOKORO_URL, "http://kokoro:8880");
		await call(capabilities, "PUT", "/tts/provider", { provider_id: "kokoro" });
		const res = await call(capabilities, "PUT", "/tts/provider", { provider_id: null });
		expect((await res.json()).active_provider_id).toBeNull();
	});

	test("fixed stock provider selection is idempotent", async () => {
		await setSecret(PEXELS_KEY, "stored-pexels");
		const selected = await call(capabilities, "PUT", "/stock-visuals/provider", {
			provider_id: "pexels",
		});
		expect(selected.status).toBe(200);
		expect((await selected.json()).active_provider_id).toBe("pexels");

		const cleared = await call(capabilities, "PUT", "/stock-visuals/provider", {
			provider_id: null,
		});
		expect((await cleared.json()).active_provider_id).toBe("pexels");
	});

	test("fixed stock capability rejects a mismatched provider", async () => {
		const res = await call(capabilities, "PUT", "/stock-visuals/provider", {
			provider_id: "freesound",
		});
		expect(res.status).toBe(400);
		expect((await res.json()).error).toBe("provider_does_not_serve_capability");
	});
});

describe("provider configuration", () => {
	test("declared fields are returned with their metadata", async () => {
		const body = await (await call(providers, "GET", "/kokoro/config")).json();
		expect(body.fields.map((f: { key: string }) => f.key)).toEqual([KOKORO_URL]);
		expect(body.fields[0]).toMatchObject({ label: "Service URL", kind: "url", required: true });
	});

	// The rule the whole store depends on.
	test("a secret is never returned, only masked", async () => {
		await setSecret(CF_TOKEN, "cf-super-secret-value");
		const res = await call(providers, "GET", "/cloudflare-ai/config");
		const text = await res.text();
		expect(text).not.toContain("cf-super-secret-value");
		const field = JSON.parse(text).fields.find((f: { key: string }) => f.key === CF_TOKEN);
		expect(field.set).toBe(true);
		expect(field.value).toBeUndefined();
		expect(field.value_masked).toMatch(/•/);
	});

	test("stock provider forms declare canonical masked keys", async () => {
		await setSecret(PEXELS_KEY, "pexels-secret");
		const pexels = await (await call(providers, "GET", "/pexels/config")).text();
		expect(pexels).not.toContain("pexels-secret");
		expect(JSON.parse(pexels).fields).toEqual([
			expect.objectContaining({
				key: PEXELS_KEY,
				label: "API key",
				kind: "secret",
				required: true,
				set: true,
			}),
		]);
		const freesound = await (await call(providers, "GET", "/freesound/config")).json();
		expect(freesound.fields).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					key: FREESOUND_KEY,
					label: "API key",
					kind: "secret",
					required: true,
					set: false,
				}),
				expect.objectContaining({
					key: FREESOUND_APPROVAL,
					label: "Commercial API permission",
					kind: "choice",
					required: true,
				}),
			]),
		);
	});

	test("a non-secret value is readable back so the form can show it", async () => {
		await setConfig(KOKORO_URL, "http://kokoro:8880");
		const body = await (await call(providers, "GET", "/kokoro/config")).json();
		expect(body.fields[0].value).toBe("http://kokoro:8880");
	});

	test("saving writes declared values", async () => {
		const res = await call(providers, "PUT", "/kokoro/config", {
			values: { [KOKORO_URL]: "http://saved:8880" },
		});
		expect((await res.json()).written).toEqual([KOKORO_URL]);
		const body = await (await call(providers, "GET", "/kokoro/config")).json();
		expect(body.fields[0].value).toBe("http://saved:8880");
	});

	// Without this the endpoint is a write-any-setting oracle for anyone who
	// guesses a key name.
	test("an undeclared key is never written", async () => {
		const res = await call(providers, "PUT", "/kokoro/config", {
			values: { MALEO_NOT_DECLARED: "nope", [KOKORO_URL]: "http://ok:8880" },
		});
		expect((await res.json()).written).toEqual([KOKORO_URL]);
		// Checked against the store itself, not against the response.
		expect((await resolveConfig("MALEO_NOT_DECLARED", {})).value).toBeUndefined();
	});

	// An emptied field means "leave this alone" — the promise the form makes.
	test("an empty value leaves a stored secret untouched", async () => {
		await setSecret(CF_TOKEN, "cf-original");
		await call(providers, "PUT", "/cloudflare-ai/config", { values: { [CF_TOKEN]: "   " } });
		expect(await getSecret(CF_TOKEN)).toBe("cf-original");
	});

	test("removal is an explicit endpoint", async () => {
		await setSecret(CF_TOKEN, "cf-original");
		const res = await call(providers, "DELETE", "/cloudflare-ai/config/" + CF_TOKEN);
		expect(res.status).toBe(200);
		expect(await getSecret(CF_TOKEN)).toBeUndefined();
	});

	// Precedence that is implemented but not reported is how an operator loses an
	// afternoon to an edit that silently had no effect.
	test("a shadowed stored value is reported as shadowed", async () => {
		await setConfig(KOKORO_URL, "http://stored:8880");
		setEnv(KOKORO_URL, "http://from-env:9000");
		const body = await (await call(providers, "GET", "/kokoro/config")).json();
		expect(body.fields[0]).toMatchObject({ source: "env", shadowed: true });
	});

	test("Security & Privacy reports a shadowed stock secret", async () => {
		await setSecret(PEXELS_KEY, "stored-pexels");
		setEnv(PEXELS_KEY, "environment-pexels");
		const body = await (await call(security, "GET", "/")).json();
		expect(body.shadowed).toContain(PEXELS_KEY);
	});
});

describe("testing before saving", () => {
	/* Against a real listener, because the probe really connects now. A made-up
	 * host used to pass here — which was the bug: the test checked that a URL was
	 * set, not that anything answered it. */
	test("a candidate pointing at a live service reports success", async () => {
		const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
		try {
			const res = await call(providers, "POST", "/kokoro/test", {
				values: { [KOKORO_URL]: `http://127.0.0.1:${server.port}` },
			});
			expect(await res.json()).toMatchObject({ ok: true, probed: true });
		} finally {
			void server.stop(true);
		}
	});

	test("a candidate pointing at nothing reports failure, not success", async () => {
		// Bound then released, so the port is closed and refuses immediately.
		const probe = Bun.serve({ port: 0, fetch: () => new Response("ok") });
		const closedPort = probe.port;
		void probe.stop(true);

		const res = await call(providers, "POST", "/kokoro/test", {
			values: { [KOKORO_URL]: `http://127.0.0.1:${closedPort}` },
		});
		const body = await res.json();
		expect(body.ok).toBe(false);
		expect(body.probed).toBe(true);
	});

	test("an incomplete candidate reports why", async () => {
		const res = await call(providers, "POST", "/cloudflare-ai/test", {
			values: { [CF_ACCOUNT]: "acct" },
		});
		const body = await res.json();
		expect(body.ok).toBe(false);
		expect(body.message).toMatch(/missing required values/);
	});

	test("testing persists nothing and changes no selection", async () => {
		await call(providers, "POST", "/kokoro/test", {
			values: { [KOKORO_URL]: "http://candidate:8880" },
		});

		const config = await (await call(providers, "GET", "/kokoro/config")).json();
		expect(config.fields[0].value).toBeNull();

		const caps = await (await call(capabilities, "GET", "/")).json();
		expect(
			caps.capabilities.find((c: { id: string }) => c.id === "tts").activeProviderId,
		).toBeNull();
	});

	test("stock candidate probes connect without persisting", async () => {
		let pexelsAuth = "";
		setPexelsFetchForTests(async (_url, init) => {
			pexelsAuth = new Headers(init.headers).get("authorization") ?? "";
			return Response.json({ photos: [] });
		});
		setFreesoundFetchForTests(async (url) => {
			expect(url).toContain("token=freesound-candidate");
			return Response.json({ results: [] });
		});

		const pexels = await call(providers, "POST", "/pexels/test", {
			values: { [PEXELS_KEY]: "pexels-candidate" },
		});
		const freesound = await call(providers, "POST", "/freesound/test", {
			values: { [FREESOUND_KEY]: "freesound-candidate", [FREESOUND_APPROVAL]: "yes" },
		});
		expect(await pexels.json()).toMatchObject({ ok: true, probed: true });
		expect(await freesound.json()).toMatchObject({ ok: true, probed: true });
		expect(pexelsAuth).toBe("pexels-candidate");
		expect(await getSecret(PEXELS_KEY)).toBeUndefined();
		expect(await getSecret(FREESOUND_KEY)).toBeUndefined();
	});

	test("stock candidate rejection reports provider status", async () => {
		setPexelsFetchForTests(async () => new Response(null, { status: 401 }));
		const res = await call(providers, "POST", "/pexels/test", { values: { [PEXELS_KEY]: "bad" } });
		expect(await res.json()).toMatchObject({
			ok: false,
			probed: true,
			reason: "Pexels returned 401",
		});
	});

	test("stored credentials drive attributed read-only stock searches", async () => {
		await setSecret(PEXELS_KEY, "stored-pexels");
		await setSecret(FREESOUND_KEY, "stored-freesound");
		await setConfig(FREESOUND_APPROVAL, "yes");
		setPexelsFetchForTests(async (_url, init) => {
			expect(new Headers(init.headers).get("authorization")).toBe("stored-pexels");
			return {
				photos: [
					{
						id: 7,
						photographer: "Maker",
						src: { large: "https://cdn/image.jpg", medium: "https://cdn/thumb.jpg" },
					},
				],
			};
		});
		setFreesoundFetchForTests(async (url) => {
			expect(url).toContain("token=stored-freesound");
			return Response.json({
				results: [
					{
						name: "Whoosh",
						username: "Maker",
						duration: 1.5,
						previews: { "preview-hq-mp3": "https://cdn/sound.mp3" },
					},
				],
			});
		});
		// No write: the settings a search could persist are unchanged.
		const settings = () =>
			db().get("SELECT count(*) AS n, max(updated_at) AS at FROM global_settings");
		const writesBefore = await settings();
		const body = await (await call(stock, "GET", "/search?type=images&q=forest")).json();
		expect(body).toEqual({
			configured: true,
			items: [
				{
					id: "7",
					thumb: "https://cdn/thumb.jpg",
					url: "https://cdn/image.jpg",
					kind: "image",
					author: "Maker",
					provider: "Pexels",
					license: "Pexels License",
					licenseUrl: "https://www.pexels.com/license/",
				},
			],
		});
		const sfx = await (await call(stock, "GET", "/search?type=sfx&q=whoosh")).json();
		expect(sfx).toMatchObject({
			configured: true,
			items: [
				{ url: "https://cdn/sound.mp3", kind: "audio", title: "Whoosh", author: "Maker", dur: 1.5 },
			],
		});
		expect(await settings()).toEqual(writesBefore);
	});
});

/* The one selection endpoint carries text's model and thinking level.
 *
 * These travel WITH the provider because they are meaningful only relative to
 * one. The first version of this endpoint took a provider id alone and wrote it
 * through `writeTextProviderSelection({ providerId })`, which dropped both — so
 * choosing a provider in Settings silently discarded the model an operator had
 * picked in the editor, and no surface said so.
 */
describe("text selection carries its model and thinking level", () => {
	const priorKey = process.env.MALEO_AI_API_KEY;
	// The route refuses a provider that is not ready; the API provider is ready with a key.
	beforeEach(() => {
		process.env.MALEO_AI_API_KEY = "sk-test";
	});
	// The stored selection outlives this file in the same process unless cleared.
	afterEach(async () => {
		const { writeTextProviderSelection } = await import("../lib/text-provider-settings.ts");
		await writeTextProviderSelection(null);
		if (priorKey === undefined) delete process.env.MALEO_AI_API_KEY;
		else process.env.MALEO_AI_API_KEY = priorKey;
	});

	async function selection(): Promise<{ providerId?: string; model?: string; thinking?: string }> {
		const { readTextProviderSelection } = await import("../lib/text-provider-settings.ts");
		return (await readTextProviderSelection()).default ?? {};
	}

	test("a model and thinking level sent with the provider are stored", async () => {
		const res = await call(capabilities, "PUT", "/text/provider", {
			provider_id: "api",
			model: "gpt-5.5",
			thinking: "high",
		});
		expect(res.status).toBe(200);
		expect(await selection()).toMatchObject({
			providerId: "api",
			model: "gpt-5.5",
			thinking: "high",
		});
	});

	// The regression: re-selecting the SAME provider must not wipe them.
	test("re-selecting the same provider keeps them", async () => {
		await call(capabilities, "PUT", "/text/provider", {
			provider_id: "api",
			model: "gpt-5.5",
			thinking: "high",
		});
		await call(capabilities, "PUT", "/text/provider", { provider_id: "api" });
		expect(await selection()).toMatchObject({
			providerId: "api",
			model: "gpt-5.5",
			thinking: "high",
		});
	});

	/* These two exercise the WRITER directly rather than the route: changing
	 * provider needs a second text provider, and the only other one is the
	 * internal test provider the route never offers. */
	test("changing provider clears them rather than pointing at the old catalogue", async () => {
		const { setActiveProviderFor } = await import("../lib/application-capabilities.ts");
		await setActiveProviderFor("text", "api", { model: "gpt-5.5", thinking: "high" });
		await setActiveProviderFor("text", "fake");
		const after = await selection();
		expect(after.providerId).toBe("fake");
		expect(after.model).toBeUndefined();
		expect(after.thinking).toBeUndefined();
	});

	test("an unrecognised thinking level is dropped rather than stored", async () => {
		const { setActiveProviderFor } = await import("../lib/application-capabilities.ts");
		await setActiveProviderFor("text", "api", { model: "gpt-5.5", thinking: "turbo" });
		const after = await selection();
		expect(after.model).toBe("gpt-5.5");
		expect(after.thinking).toBeUndefined();
	});

	/* A namespaced catalog id must never reach the store: the registry that
	 * resolves a selection at generation time only knows the bare form, and the
	 * settings surface compares against both — so a stored `text:api` would
	 * render as selected while resolving to nothing. */
	test("the stored id is the bare one, not the catalog's namespaced id", async () => {
		await call(capabilities, "PUT", "/text/provider", { provider_id: "api" });
		expect((await selection()).providerId).toBe("api");
	});
});

/* The way out of a lost master key.
 *
 * Every write fails while the envelope cannot be opened — including the writes an
 * operator would make to re-enter their credentials, which is what the error tells
 * them to do. Without this endpoint the store is bricked and the remedy the UI
 * prints does not exist.
 */
describe("recovering from a lost master key", () => {
	test("refuses when the current key can still read what is stored", async () => {
		const res = await call(security, "POST", "/master-key/reset");
		expect(res.status).toBe(400);
		expect((await res.json()).error).toBe("nothing_to_reset");
	});

	test("reports what a reset would cost while the key cannot open the store", async () => {
		await setSecret("recovery.a", "value", db());
		setEnv(MASTER_KEY_ENV, encodeKey(generateKey()));
		const body = await (await call(security, "GET", "/")).json();
		expect(body.master_key.state).toBe("changed");
		expect(body.unreadable.secretCount).toBeGreaterThan(0);
	});

	test("after a reset, a credential can be stored again", async () => {
		await setSecret("recovery.a", "value", db());
		setEnv(MASTER_KEY_ENV, encodeKey(generateKey()));

		const reset = await call(security, "POST", "/master-key/reset");
		expect(reset.status).toBe(200);
		expect((await reset.json()).removed).toBeGreaterThan(0);

		await setSecret("recovery.a", "retyped", db());
		expect(await getSecret("recovery.a", db())).toBe("retyped");
	});
});

/* Testing a connection must attempt a connection.
 *
 * Built on `health()` at first, which is deliberately offline because it runs on
 * every settings render — so it checked that a URL was SET. A Kokoro URL pointing
 * at nothing reported "Connection succeeded", which is worse than no test at all:
 * it tells an operator their credential is good and defers the failure to a
 * generation hours later.
 */
describe("test connection actually connects", () => {
	test("a URL pointing at nothing fails, and says why", async () => {
		/* A port that was bound and released: it refuses at once. A blackholed
		 * address would instead sit until the client's timeout, which makes this
		 * assert the test runner's patience rather than the probe. */
		const probe = Bun.serve({ port: 0, fetch: () => new Response("ok") });
		const closedPort = probe.port;
		void probe.stop(true);

		const res = await call(providers, "POST", "/kokoro/test", {
			values: { MALEO_KOKORO_URL: `http://127.0.0.1:${closedPort}` },
		});
		const body = await res.json();
		expect(body.ok).toBe(false);
		expect(body.probed).toBe(true);
		expect(body.message).toMatch(/could not be reached/);
	});

	test("a missing required value fails without claiming a probe", async () => {
		const res = await call(providers, "POST", "/kokoro/test", { values: {} });
		const body = await res.json();
		expect(body.ok).toBe(false);
		expect(body.message).toMatch(/missing required values|could not be reached/);
	});

	/* A provider with no probe must not report a success it never observed. */
	test("an unprobeable provider reports that nothing was contacted", async () => {
		const res = await call(providers, "POST", "/cloudflare-ai/test", {
			values: { MALEO_CF_ACCOUNT_ID: "acct", MALEO_CF_API_TOKEN: "tok" },
		});
		const body = await res.json();
		expect(body.probed).toBe(false);
	});
});

test("video sandbox selection persists without environment opt-in and clearing excludes it", async () => {
	setEnv("MALEO_SANDBOX", undefined);
	const activated = await call(capabilities, "PUT", "/video/provider", { provider_id: "sandbox" });
	expect(activated.status).toBe(200);
	const listing = await (await call(capabilities, "GET", "/")).json();
	expect(listing.capabilities.find((item: { id: string }) => item.id === "video")).toMatchObject({
		state: "ready",
		activeProviderId: "sandbox",
	});
	expect((await call(capabilities, "PUT", "/video/provider", { provider_id: null })).status).toBe(
		200,
	);
	const cleared = await (await call(capabilities, "GET", "/")).json();
	expect(cleared.capabilities.find((item: { id: string }) => item.id === "video").state).toBe(
		"not_configured",
	);
});
