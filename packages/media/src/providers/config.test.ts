/* Proof for tasks 2.1 and 2.2: the seam defaults to the environment, an injected
 * source displaces it, and every provider's configuration read goes through it. */
import { afterEach, describe, expect, test } from "vite-plus/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
	refreshConfig,
	resolveConfig,
	setConfigSource,
	withConfigOverride,
	type ConfigSource,
} from "./config.ts";
import { kokoroBaseUrlFromEnv, KOKORO_URL_KEY } from "./kokoro/service.ts";
import { readCredentials } from "./cloudflare-ai/credentials.ts";
import {
	ACCOUNT_ID_ENV,
	API_TOKEN_ENV,
	IMAGE_MODEL_ENV as CF_IMAGE_MODEL_ENV,
} from "./cloudflare-ai/models.ts";
import {
	BILL_TO_ENV as HF_BILL_TO_ENV,
	IMAGE_MODEL_ENV as HF_IMAGE_MODEL_ENV,
	INFERENCE_PROVIDER_ENV as HF_INFERENCE_PROVIDER_ENV,
	readToken,
	TOKEN_ENV,
} from "./huggingface/models.ts";

function sourceOf(values: Record<string, string>): ConfigSource {
	return { resolve: (key) => values[key] };
}

const savedEnv = new Map<string, string | undefined>();
function setEnv(key: string, value: string | undefined): void {
	if (!savedEnv.has(key)) savedEnv.set(key, process.env[key]);
	if (value === undefined) delete process.env[key];
	else process.env[key] = value;
}

afterEach(() => {
	setConfigSource(null);
	for (const [key, value] of savedEnv) setEnv(key, value);
	savedEnv.clear();
});

describe("the default source", () => {
	test("reads the process environment, unchanged from before the seam", () => {
		setEnv(KOKORO_URL_KEY, "http://from-env:8880");
		expect(resolveConfig(KOKORO_URL_KEY)).toBe("http://from-env:8880");
		expect(kokoroBaseUrlFromEnv()).toBe("http://from-env:8880");
	});

	test("treats a blank environment variable as unset", () => {
		setEnv(KOKORO_URL_KEY, "   ");
		expect(resolveConfig(KOKORO_URL_KEY)).toBeUndefined();
	});

	test("refresh is a no-op when the source has nothing to reload", async () => {
		await expect(refreshConfig()).resolves.toBeUndefined();
	});
});

describe("an injected source", () => {
	test("displaces the environment entirely", () => {
		setEnv(KOKORO_URL_KEY, "http://from-env:8880");
		setConfigSource(sourceOf({ [KOKORO_URL_KEY]: "http://injected:9000" }));
		expect(kokoroBaseUrlFromEnv()).toBe("http://injected:9000");
	});

	test("is restored to the environment source by passing null", () => {
		setEnv(KOKORO_URL_KEY, "http://from-env:8880");
		setConfigSource(sourceOf({ [KOKORO_URL_KEY]: "http://injected:9000" }));
		setConfigSource(null);
		expect(kokoroBaseUrlFromEnv()).toBe("http://from-env:8880");
	});

	test("refresh reaches the source", async () => {
		let refreshed = 0;
		setConfigSource({
			resolve: () => undefined,
			refresh: async () => {
				refreshed += 1;
			},
		});
		await refreshConfig();
		expect(refreshed).toBe(1);
	});

	// A source that cannot reload must be able to say so — the caller's correct
	// response is to report providers unconfigured, not to run on stale values.
	test("a failing refresh propagates rather than being swallowed", async () => {
		setConfigSource({
			resolve: () => undefined,
			refresh: async () => {
				throw new Error("config service unreachable");
			},
		});
		await expect(refreshConfig()).rejects.toThrow("config service unreachable");
	});
});

describe("every provider reads through the seam", () => {
	test("cloudflare credentials come from the source", () => {
		setEnv(ACCOUNT_ID_ENV, undefined);
		setEnv(API_TOKEN_ENV, undefined);
		setConfigSource(sourceOf({ [ACCOUNT_ID_ENV]: "acct-1", [API_TOKEN_ENV]: "tok-1" }));
		expect(readCredentials()).toEqual({ accountId: "acct-1", apiToken: "tok-1" });
	});

	test("huggingface token comes from the source", () => {
		setEnv(TOKEN_ENV, undefined);
		setConfigSource(sourceOf({ [TOKEN_ENV]: "hf-token" }));
		expect(readToken()).toBe("hf-token");
	});
});

/* A guard, not an example. Every key a provider declares as its configuration
 * must be resolved through the seam — one read of `process.env` left behind is a
 * value that works in the API and is silently missing in the worker, which is
 * exactly the bug the seam exists to remove. Host-level environment reads (PATH,
 * upload directories, the subprocess env, the sandbox opt-in) are not provider
 * configuration and are deliberately not covered. */
describe("no provider reads its own configuration from process.env", () => {
	/* Derived from the constants themselves, never retyped. A hand-written list
	 * silently stops guarding the moment a key is renamed — the first draft of
	 * this test listed `MALEO_HF_TOKEN` for what is actually `HF_TOKEN` and
	 * therefore guarded nothing. */
	const PROVIDER_CONFIG_KEYS = [
		KOKORO_URL_KEY,
		TOKEN_ENV,
		HF_BILL_TO_ENV,
		HF_IMAGE_MODEL_ENV,
		HF_INFERENCE_PROVIDER_ENV,
		ACCOUNT_ID_ENV,
		API_TOKEN_ENV,
		CF_IMAGE_MODEL_ENV,
	];

	test("the guarded key list is real", () => {
		// Cheap proof the list above is not a typo that guards nothing.
		expect(PROVIDER_CONFIG_KEYS).toContain("HF_TOKEN");
		expect(PROVIDER_CONFIG_KEYS.every((k) => typeof k === "string" && k.length > 0)).toBe(true);
	});

	function sourceFiles(dir: string): string[] {
		const out: string[] = [];
		for (const entry of readdirSync(dir)) {
			const path = join(dir, entry);
			if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
			else if (entry.endsWith(".ts") && !entry.includes(".test.")) out.push(path);
		}
		return out;
	}

	test("no configuration key is read from the environment", () => {
		const offenders: string[] = [];
		for (const file of sourceFiles(import.meta.dirname)) {
			const text = readFileSync(file, "utf8");
			for (const line of text.split("\n")) {
				if (!line.includes("process.env")) continue;
				for (const key of PROVIDER_CONFIG_KEYS) {
					// Matches both `process.env.KEY` and `process.env[KEY_CONST]` by
					// looking for the literal key on a line that touches process.env.
					if (line.includes(key)) offenders.push(`${file}: ${line.trim()}`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});
});

/* Proof for task 2.4: candidate configuration for "test before save".
 *
 * The concurrency case is the reason this is AsyncLocalStorage rather than
 * swapping the module's source around the call — two operators testing a
 * provider at the same moment must not see each other's unsaved values. */
describe("candidate configuration", () => {
	test("overrides the installed source for the duration of the call", async () => {
		setConfigSource(sourceOf({ [KOKORO_URL_KEY]: "http://stored:8880" }));
		const seen = await withConfigOverride({ [KOKORO_URL_KEY]: "http://candidate:9999" }, async () =>
			kokoroBaseUrlFromEnv(),
		);
		expect(seen).toBe("http://candidate:9999");
	});

	test("nothing outside the call observes the candidate", async () => {
		setConfigSource(sourceOf({ [KOKORO_URL_KEY]: "http://stored:8880" }));
		await withConfigOverride({ [KOKORO_URL_KEY]: "http://candidate:9999" }, async () => undefined);
		expect(kokoroBaseUrlFromEnv()).toBe("http://stored:8880");
	});

	test("concurrent candidates do not observe each other", async () => {
		setConfigSource(sourceOf({}));
		const read = async (label: string) => {
			await new Promise((r) => setTimeout(r, label === "a" ? 20 : 5));
			return kokoroBaseUrlFromEnv();
		};
		const [a, b] = await Promise.all([
			withConfigOverride({ [KOKORO_URL_KEY]: "http://a" }, () => read("a")),
			withConfigOverride({ [KOKORO_URL_KEY]: "http://b" }, () => read("b")),
		]);
		expect(a).toBe("http://a");
		expect(b).toBe("http://b");
	});
});
