import { describe, expect, it } from "bun:test";
import { getProvider, resolveProvider, selectReadyProvider, providersFor } from "./index.ts";

/* Codex generates by spawning the `codex` CLI, so observing its unconfigured
 * branch means taking that CLI off PATH. */
async function withoutCodexRunner(run: () => Promise<void>): Promise<void> {
	const priorPath = process.env.PATH;
	try {
		process.env.PATH = "";
		await run();
	} finally {
		if (priorPath === undefined) delete process.env.PATH;
		else process.env.PATH = priorPath;
	}
}

describe("provider selection", () => {
	/* The default per capability is positional, so these two assertions are the
	 * guard against a registry edit silently moving production traffic. */
	it("leads with kokoro for TTS", () => {
		const p = resolveProvider("tts");
		expect(p.meta.id).toBe("kokoro");
		expect(p.tts).toBeDefined();
		expect(providersFor("tts")[0]?.meta.id).toBe("kokoro");
	});

	it("leads with cloudflare-ai for image", () => {
		const p = resolveProvider("image");
		expect(p.meta.id).toBe("cloudflare-ai");
		expect(p.image).toBeDefined();
		expect(providersFor("image")[0]?.meta.id).toBe("cloudflare-ai");
	});

	it("honors an explicit project selection when it implements the capability", () => {
		const p = resolveProvider("tts", { project: { tts: "kokoro" } });
		expect(p.meta.id).toBe("kokoro");
	});

	/* An unresolvable id means two different things depending on where it came
	 * from, so the failure differs by source. Persisted rows were valid when
	 * written and went stale when a provider was retired — the code changed, not
	 * the config — while an env var was typed just now. One cell per case. */
	describe("an id naming no registered provider", () => {
		it("falls through to the default when persisted in a project row", () => {
			expect(resolveProvider("tts", { project: { tts: "retired-provider" } }).meta.id).toBe(
				"kokoro",
			);
		});

		it("falls through to the default when persisted in a workspace row", () => {
			expect(resolveProvider("tts", { workspace: { tts: "retired-provider" } }).meta.id).toBe(
				"kokoro",
			);
		});

		it("still throws when it came from the environment", () => {
			const prior = process.env.MALEO_PROVIDER_TTS;
			try {
				process.env.MALEO_PROVIDER_TTS = "retired-tts";
				expect(() => resolveProvider("tts")).toThrow(
					/env provider "retired-tts" does not implement/,
				);
			} finally {
				if (prior === undefined) delete process.env.MALEO_PROVIDER_TTS;
				else process.env.MALEO_PROVIDER_TTS = prior;
			}
		});

		it("recovers through health-aware selection too, reporting the default as the source", async () => {
			const prior = process.env.MALEO_KOKORO_URL;
			try {
				process.env.MALEO_KOKORO_URL = "https://tts.example";
				const decision = await selectReadyProvider("tts", {
					workspace: { tts: "retired-provider" },
				});
				expect(decision.provider.meta.id).toBe("kokoro");
				expect(decision.source).toBe("default");
			} finally {
				if (prior === undefined) delete process.env.MALEO_KOKORO_URL;
				else process.env.MALEO_KOKORO_URL = prior;
			}
		});
	});

	it("still rejects a registered provider that does not implement the capability", () => {
		// Registered but incapable is an operator error, not stale config, so it
		// fails loudly from a persisted row as well.
		expect(() => resolveProvider("tts", { project: { tts: "cloudflare-ai" } })).toThrow(
			/does not implement/,
		);
	});

	it("rejects an unhealthy explicit selection with an actionable reason", async () => {
		const previous = process.env.MALEO_KOKORO_URL;
		try {
			delete process.env.MALEO_KOKORO_URL;
			await expect(selectReadyProvider("tts", { workspace: { tts: "kokoro" } })).rejects.toThrow(
				/unconfigured.*choose a ready provider/,
			);
		} finally {
			if (previous === undefined) delete process.env.MALEO_KOKORO_URL;
			else process.env.MALEO_KOKORO_URL = previous;
		}
	});

	it("registers providers in display order per capability", () => {
		expect(providersFor("image").map((p) => p.meta.id)).toEqual([
			"cloudflare-ai",
			"huggingface",
			"codex",
			"sandbox",
		]);
		/* `pocket-tts-id` sits after `kokoro`: it speaks Indonesian only, and
		 * leading here would make it the default an unconfigured selection falls to. */
		expect(providersFor("tts").map((p) => p.meta.id)).toEqual([
			"kokoro",
			"pocket-tts-id",
			"sandbox",
		]);
	});

	/* Kokoro reaches a caller only when its own URL is set. */
	it("reports Kokoro TTS health from its own service configuration", async () => {
		const prior = process.env.MALEO_KOKORO_URL;
		try {
			delete process.env.MALEO_KOKORO_URL;
			const kokoro = providersFor("tts").find((p) => p.meta.id === "kokoro");
			expect(await kokoro?.meta.health("tts")).toBe("unconfigured");
			process.env.MALEO_KOKORO_URL = "https://kokoro-tts.example";
			expect(await kokoro?.meta.health("tts")).toBe("ready");
		} finally {
			if (prior === undefined) delete process.env.MALEO_KOKORO_URL;
			else process.env.MALEO_KOKORO_URL = prior;
		}
	});

	it("refuses an explicitly selected Kokoro that has no service URL", async () => {
		const prior = process.env.MALEO_KOKORO_URL;
		try {
			delete process.env.MALEO_KOKORO_URL;
			await expect(selectReadyProvider("tts", { workspace: { tts: "kokoro" } })).rejects.toThrow(
				/unconfigured.*choose a ready provider/,
			);
		} finally {
			if (prior === undefined) delete process.env.MALEO_KOKORO_URL;
			else process.env.MALEO_KOKORO_URL = prior;
		}
	});

	/* Derived from what the mock declares rather than a fixed capability list, so
	 * this keeps holding when the sandbox gains a capability. */
	it("keeps the mock last for image and TTS", () => {
		const sandbox = getProvider("sandbox");
		expect(sandbox).toBeDefined();
		for (const capability of ["image", "tts"] as const) {
			expect(
				providersFor(capability)
					.map((p) => p.meta.id)
					.at(-1),
			).toBe("sandbox");
		}
	});

	it("honors sandbox selection for local mock images", () => {
		const p = resolveProvider("image", { project: { image: "sandbox" } });
		expect(p.meta.id).toBe("sandbox");
		expect(p.image).toBeDefined();
	});

	it("exposes codex as a selectable image provider without changing the default", () => {
		expect(resolveProvider("image").meta.id).toBe("cloudflare-ai");
		const p = resolveProvider("image", { project: { image: "codex" } });
		expect(p.meta.id).toBe("codex");
		expect(p.image).toBeDefined();
		expect(p.tts).toBeUndefined();
	});

	it("reports codex image health from the configured runner boundary", async () => {
		await withoutCodexRunner(async () => {
			const codex = providersFor("image").find((p) => p.meta.id === "codex");
			expect(await codex?.meta.health("image")).toBe("unconfigured");
			// Capability-aware: codex never claims readiness for tts.
			expect(await codex?.meta.health("tts")).toBe("unconfigured");
		});
	});

	it("fails loudly for every explicit codex selection when the runner is absent", async () => {
		await withoutCodexRunner(async () => {
			await expect(selectReadyProvider("image", { project: { image: "codex" } })).rejects.toThrow(
				/project provider "codex" is unconfigured/,
			);
			await expect(selectReadyProvider("image", { workspace: { image: "codex" } })).rejects.toThrow(
				/workspace provider "codex" is unconfigured/,
			);
			const priorEnv = process.env.MALEO_PROVIDER_IMAGE;
			try {
				process.env.MALEO_PROVIDER_IMAGE = "codex";
				await expect(selectReadyProvider("image")).rejects.toThrow(
					/env provider "codex" is unconfigured/,
				);
			} finally {
				if (priorEnv === undefined) delete process.env.MALEO_PROVIDER_IMAGE;
				else process.env.MALEO_PROVIDER_IMAGE = priorEnv;
			}
		});
	});
});
