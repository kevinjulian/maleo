/* The mock provider, and the only one whose output is fabricated.
 *
 * Readiness is opt-in because the registry resolves an unconfigured default to
 * the FIRST provider reporting `ready`. A provider that is unconditionally ready
 * is therefore reachable from any misconfiguration — no credentials, an
 * unreachable service, a typo'd model id — and the caller receives mock media
 * through a success response, with a completed ledger row and nothing to
 * distinguish it from real output. Ordering it last does not fix that: last
 * still wins when everything above it is unconfigured, which is exactly the
 * state a fresh or broken deployment is in.
 *
 * Image/TTS keep the environment gate. Video requires explicit selection and
 * declares explicitOnly so automatic fallback cannot reach it. */
import type { Capability } from "../capabilities.ts";
import type { ProviderHealth, ProviderMeta } from "../types.ts";
import { videoBinariesAvailable } from "../video-output.ts";

const OPT_IN_ENV = "MALEO_SANDBOX";

export const SANDBOX_CAPABILITIES: Capability[] = ["image", "tts", "video"];

/** True only when an operator has explicitly asked for fabricated output. */
export function sandboxEnabled(): boolean {
	return process.env[OPT_IN_ENV]?.trim() === "1";
}

export const sandboxMeta: ProviderMeta = {
	id: "sandbox",
	label: "Sandbox (local mock)",
	capabilities: SANDBOX_CAPABILITIES,
	explicitOnly: ["video"],
	models: { image: "sandbox-svg", tts: "sandbox-wav", video: "sandbox-mp4" },
	image: { references: { mode: "text-only" } },
	/* One voice, named for what it is. The mock declares `tts`, so a picker
	 * resolving the sandbox needs something to offer — an empty catalogue would
	 * render as a voice list with no entries rather than as "mock output". The
	 * name is deliberately not a person's: a fabricated voice that reads like a
	 * real narrator is the sandbox's whole failure mode. */
	tts: {
		voices: [
			{ id: "mock", name: "Mock", desc: "Fabricated · sandbox only", gender: "female", lang: "en" },
		],
	},
	async health(capability?: Capability): Promise<ProviderHealth> {
		// Capability-aware first: a provider-wide "ready" would let a picker offer
		// the sandbox for something it does not implement.
		if (capability && !SANDBOX_CAPABILITIES.includes(capability)) return "unconfigured";
		if (capability === "video") return videoBinariesAvailable() ? "ready" : "unconfigured";
		return sandboxEnabled() ? "ready" : "unconfigured";
	},
};
