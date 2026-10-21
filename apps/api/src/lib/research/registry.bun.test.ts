/* Which provider answers, and what happens when it cannot.
 *
 * No provider is opened here — resolution is what is under test, and opening
 * `browseros` would try to reach a local daemon. The one assertion that matters
 * most is the LAST one: there is no fallthrough, because a silent substitution
 * turns a visible outage into an invisible change in grounding quality.
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
	researchProviderIds,
	resolveResearchProvider,
	selectedResearchProviderId,
} from "./registry.ts";

const KEYS = [
	"MALEO_RESEARCH_PROVIDER",
	"MALEO_SEARXNG_URL",
	"MALEO_CRAWL4AI_URL",
	"CF_ACCESS_CLIENT_ID",
	"CF_ACCESS_CLIENT_SECRET",
] as const;
const saved = new Map<string, string | undefined>();

function setEnv(values: Partial<Record<(typeof KEYS)[number], string>>): void {
	for (const key of KEYS) {
		if (!saved.has(key)) saved.set(key, process.env[key]);
		const value = values[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
}

const CONFIGURED = {
	MALEO_SEARXNG_URL: "https://searxng.example",
	MALEO_CRAWL4AI_URL: "https://crawl4ai.example",
	CF_ACCESS_CLIENT_ID: "id.access",
	CF_ACCESS_CLIENT_SECRET: "secret",
} as const;

afterEach(() => {
	for (const [key, value] of saved) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	saved.clear();
});

describe("registration order is the default", () => {
	/* Positional default, as `media-provider-selection` requires: the first entry
	 * is what an operator who has chosen nothing gets, so the order is behavior. */
	test("searxng leads, because it needs no daemon on the planning machine", () => {
		expect(researchProviderIds()[0]).toBe("searxng");
		expect(researchProviderIds()).toContain("browseros");
	});

	test("with nothing selected and searxng configured, searxng answers", () => {
		setEnv(CONFIGURED);
		expect(resolveResearchProvider().id).toBe("searxng");
	});
});

describe("an unconfigured provider is skipped, not selected and failed", () => {
	test("no searxng configuration falls through to browseros", () => {
		setEnv({});
		expect(resolveResearchProvider().id).toBe("browseros");
	});

	/* Partial configuration is NOT something to work around. Both services sit
	 * behind Cloudflare Access, so a url without the service token gets a login
	 * page rather than data — "not ready" is the truthful state. */
	test("a url without its credentials is not ready", () => {
		setEnv({
			MALEO_SEARXNG_URL: CONFIGURED.MALEO_SEARXNG_URL,
			MALEO_CRAWL4AI_URL: CONFIGURED.MALEO_CRAWL4AI_URL,
		});
		expect(resolveResearchProvider().id).toBe("browseros");
	});
});

describe("an explicit selection wins", () => {
	test("selecting browseros overrides a configured searxng", () => {
		setEnv({ ...CONFIGURED, MALEO_RESEARCH_PROVIDER: "browseros" });
		expect(resolveResearchProvider().id).toBe("browseros");
	});

	test("an argument beats the environment", () => {
		setEnv({ ...CONFIGURED, MALEO_RESEARCH_PROVIDER: "browseros" });
		expect(resolveResearchProvider("searxng").id).toBe("searxng");
	});

	/* A deliberate choice is honoured even when unconfigured, so it fails loudly
	 * on open instead of being silently swapped for something else. That is the
	 * no-fallthrough rule, one step earlier. */
	test("an explicitly selected provider is used even when it is not ready", () => {
		setEnv({ MALEO_RESEARCH_PROVIDER: "searxng" });
		expect(resolveResearchProvider().id).toBe("searxng");
	});

	test("an unknown name is ignored rather than fatal", () => {
		setEnv({ ...CONFIGURED, MALEO_RESEARCH_PROVIDER: "exa" });
		expect(selectedResearchProviderId()).toBeUndefined();
		expect(resolveResearchProvider().id).toBe("searxng");
	});

	test("selection is case- and whitespace-insensitive", () => {
		setEnv({ ...CONFIGURED, MALEO_RESEARCH_PROVIDER: "  BrowserOS  " });
		expect(selectedResearchProviderId()).toBe("browseros");
	});
});

describe("there is no fallthrough between providers", () => {
	/* The decision this test exists to protect. A plan grounded in sources from
	 * an unexpected provider is indistinguishable from a well-grounded plan at
	 * every layer that reads it afterwards, so a failing provider must surface as
	 * an outage — which `story-plan-staging` already reports as an ungrounded
	 * plan — rather than be quietly replaced.
	 *
	 * Asserted structurally: resolution returns ONE registration and the module
	 * exposes no chain, retry-with-next, or ordered-attempt helper. */
	test("resolution yields a single provider, and the module offers no chain", async () => {
		setEnv(CONFIGURED);
		const resolved = resolveResearchProvider();
		expect(resolved.id).toBe("searxng");

		const registry = (await import("./registry.ts")) as Record<string, unknown>;
		const exported = Object.keys(registry);
		expect(
			exported.some((name) => /fallback|fallthrough|chain|nextProvider|tryEach/i.test(name)),
		).toBe(false);

		const source = await Bun.file(new URL("./registry.ts", import.meta.url)).text();
		// A loop over registrations that OPENS each one would be a fallthrough.
		expect(source).not.toContain("for (const entry of REGISTRY) {");
	});
});
