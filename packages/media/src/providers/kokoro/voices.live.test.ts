/* The static catalogue exists so it can be read with the service down. That
 * choice buys offline reads and costs the guarantee that the list is current —
 * a pinned third-party image that moves can add or drop a voice, and the first
 * sign would be an operator picking one the service does not have.
 *
 * This is the check that closes it. It runs only when a service is configured,
 * so a local checkout with no deployment still passes, and it is why
 * `infra/kokoro-tts/AGENTS.md` calls moving the image pin a deploy decision. */
import { describe, expect, it } from "vite-plus/test";
import { KOKORO_VOICES } from "./voices.ts";
import { kokoroBaseUrlFromEnv } from "./service.ts";

const base = kokoroBaseUrlFromEnv();

describe.skipIf(!base)("catalogue matches the deployed service", () => {
	it("names exactly the voices the service reports", async () => {
		const res = await fetch(`${base}/v1/audio/voices`, { signal: AbortSignal.timeout(15_000) });
		expect(res.ok).toBe(true);

		/* kokoro-fastapi answers `{ voices: [{ id, name }, ...] }`. Bare arrays and
		 * bare strings are tolerated too: the shape moving is exactly the kind of
		 * drift this test exists for, and it should report a changed VOICE LIST
		 * rather than fail on the envelope. */
		const body: unknown = await res.json();
		const live: unknown = Array.isArray(body) ? body : (body as { voices?: unknown })?.voices;
		expect(Array.isArray(live)).toBe(true);

		const liveIds = [
			...new Set(
				(live as Array<string | { id?: string }>).map((entry) =>
					typeof entry === "string" ? entry : (entry?.id ?? ""),
				),
			),
		].sort();
		const staticIds = KOKORO_VOICES.map((v) => v.id).sort();
		expect(staticIds).toEqual(liveIds);
	});
});
