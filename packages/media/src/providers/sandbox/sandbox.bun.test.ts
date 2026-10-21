/* The mock provider's contract. The assertions that matter here are negative:
 * fabricated output must be unreachable unless somebody asked for it. */
import { afterEach, beforeEach, describe, expect, it, test } from "bun:test";
import { describeProviderConformance } from "../conformance.ts";
import { providersFor } from "../registry.ts";
import { selectReadyProvider } from "../selection.ts";
import { sandboxProvider } from "./index.ts";

describeProviderConformance({ describe, test, expect }, sandboxProvider);

/* Every credential an image provider ahead of the sandbox reads, plus PATH for
 * the codex CLI probe. Cleared together so "nothing is configured" is the state
 * under test rather than a property of the machine running it. */
const ENV_KEYS = [
	"MALEO_SANDBOX",
	"MALEO_PROVIDER_IMAGE",
	"MALEO_PROVIDER_TTS",
	"MALEO_CF_ACCOUNT_ID",
	"MALEO_CF_API_TOKEN",
	"HF_TOKEN",
	"MALEO_KOKORO_URL",
	"PATH",
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
	saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
	for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
	for (const key of ENV_KEYS) {
		const value = saved[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

describe("sandbox readiness is opt-in", () => {
	it("is unconfigured for image and TTS without the opt-in", async () => {
		for (const capability of ["image", "tts"] as const) {
			expect(await sandboxProvider.meta.health(capability)).toBe("unconfigured");
		}
		expect(await sandboxProvider.meta.health()).toBe("unconfigured");
	});

	it("is ready for image and TTS with the opt-in", async () => {
		process.env.MALEO_SANDBOX = "1";
		for (const capability of ["image", "tts"] as const) {
			expect(await sandboxProvider.meta.health(capability)).toBe("ready");
		}
	});

	it("treats any value other than 1 as absent", async () => {
		for (const value of ["", "0", "true", "yes"]) {
			process.env.MALEO_SANDBOX = value;
			expect(await sandboxProvider.meta.health("image")).toBe("unconfigured");
		}
	});
});

describe("the mock is never reached by accident", () => {
	it("fails an explicit selection when the opt-in is missing", async () => {
		await expect(selectReadyProvider("image", { project: { image: "sandbox" } })).rejects.toThrow(
			/project provider "sandbox" is unconfigured/,
		);
		process.env.MALEO_PROVIDER_IMAGE = "sandbox";
		await expect(selectReadyProvider("image")).rejects.toThrow(
			/env provider "sandbox" is unconfigured/,
		);
	});

	it("honours an explicit selection once the opt-in is set", async () => {
		process.env.MALEO_SANDBOX = "1";
		const decision = await selectReadyProvider("image", { project: { image: "sandbox" } });
		expect(decision.provider.meta.id).toBe("sandbox");
		expect(decision.source).toBe("project");
	});

	it("throws rather than falling through to the mock when nothing real is ready", async () => {
		// The failure this asserts is the one that has no symptom: a generation
		// that returns fabricated media through a 200 with a completed ledger row.
		await expect(selectReadyProvider("image")).rejects.toThrow(/no ready provider implements/);
	});

	it("fails TTS rather than producing mock audio when Kokoro is unreachable", async () => {
		// Sandbox implements tts and sits last, so without the opt-in this is the
		// case where an unset MALEO_KOKORO_URL would otherwise narrate a video
		// with a tone and report success.
		await expect(selectReadyProvider("tts")).rejects.toThrow(/no ready provider implements/);
	});

	it("is the last candidate for existing image and TTS capabilities", () => {
		for (const capability of ["image", "tts"] as const) {
			expect(
				providersFor(capability)
					.map((p) => p.meta.id)
					.at(-1),
			).toBe("sandbox");
		}
	});
});
