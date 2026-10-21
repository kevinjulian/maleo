/* The settings surface's API: what capabilities exist, which provider serves
 * each, and how a provider is configured.
 *
 * ONE selection endpoint for every capability. Three routes doing one thing is
 * why the web surface needed three hooks and three status shapes, and a fourth
 * capability would have added a fourth of each.
 *
 * Secrets here are WRITE-ONLY. A response reports that a secret is set and a
 * masked tail, never the value. A read endpoint that exists "for the settings
 * form" is the one a future surface, log line or error body eventually leaks
 * through. */
import { refreshProviderConfig } from "../lib/provider-config-source.ts";
import { Hono } from "hono";
import { instanceOwnerOnly } from "../middleware/instance-owner.ts";
import { auditConfigMutation } from "../lib/admin-config-audit.ts";
import { z } from "zod";
import { maskSecret } from "../lib/workspace-secrets.ts";
import { resolveConfig, setConfig, shadowedConfigKeys } from "@maleo/db/config-resolution";
import {
	cancelRotation,
	hasSecret,
	resetSecretStorage,
	rotateMasterKey,
	secretStoreStatus,
	unreadableSecretStorage,
	setSecret,
	SecretStoreError,
	unsetSecret,
} from "@maleo/db/secret-store";
import { withConfigOverride } from "@maleo/shared/provider-config";
import { allDeclaredConfigKeys, findCatalogProvider } from "../lib/provider-catalog.ts";
import { setupLocalWhisper } from "../lib/local-whisper.ts";
import {
	activeProviderFor,
	bareProviderId,
	APP_CAPABILITIES,
	listApplicationCapabilities,
	probeProvider,
	providersForCapability,
	providerState,
	setActiveProviderFor,
} from "../lib/application-capabilities.ts";
import type { ProviderCapability } from "../lib/provider-catalog.ts";

const selectionBody = z.object({
	provider_id: z.string().trim().min(1).nullable(),
	/* Capability-specific selection detail. Only text uses these today; they ride
	 * with the provider because a model and a thinking level are meaningful only
	 * relative to one, and a separate write would make a torn update possible —
	 * provider saved, model still pointing at the previous provider's catalogue. */
	model: z.string().trim().min(1).nullable().optional(),
	thinking: z.string().trim().min(1).nullable().optional(),
});
const configBody = z.object({ values: z.record(z.string(), z.string()) });

const CAPABILITY_IDS: ReadonlySet<string> = new Set(APP_CAPABILITIES);

function isCapability(value: string): value is ProviderCapability {
	return CAPABILITY_IDS.has(value);
}

export function capabilitiesRoutes(): Hono {
	const app = new Hono();
	app.use("*", auditConfigMutation());
	app.use("/:capability/provider", instanceOwnerOnly());
	// Readiness and credentials are read synchronously from the config snapshot;
	// every request here is an async boundary, so reload it first.
	app.use("*", async (_c, next) => {
		await refreshProviderConfig();
		await next();
	});

	app.get("/", async (c) => c.json({ capabilities: await listApplicationCapabilities() }));

	/* One endpoint activates a provider for any capability. */
	app.put("/:capability/provider", async (c) => {
		const capability = c.req.param("capability");
		if (!isCapability(capability)) return c.json({ error: "unknown_capability" }, 404);

		const parsed = selectionBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "provider_id required" }, 400);
		const providerId = parsed.data.provider_id;

		if (providerId === null) {
			await setActiveProviderFor(capability, null);
			return c.json({ ok: true, active_provider_id: await activeProviderFor(capability) });
		}

		const detail = {
			...(parsed.data.model !== undefined ? { model: parsed.data.model } : {}),
			...(parsed.data.thinking !== undefined ? { thinking: parsed.data.thinking } : {}),
		};

		const provider = providersForCapability(capability).find((p) => p.id === providerId);
		// Refused rather than stored: a selection naming a provider that cannot
		// serve this capability fails at every later request, and the stored row
		// would make the settings surface report a choice nothing honours.
		if (!provider) return c.json({ error: "provider_does_not_serve_capability" }, 400);

		const state = await providerState(provider, capability);
		if (state !== "ready") {
			return c.json(
				{
					error: "provider_unconfigured",
					message: `${provider.label} is not configured; set its required values before activating it`,
				},
				400,
			);
		}

		/* The BARE id, not the catalog's. Catalog ids are namespaced where two
		 * registries share one; the registries that resolve a selection at
		 * generation time only know the bare form. */
		await setActiveProviderFor(capability, bareProviderId(provider), detail);
		return c.json({ ok: true, active_provider_id: await activeProviderFor(capability) });
	});

	return app;
}

/* Security & Privacy: the master key's state, what a rotation is waiting on, and
 * which stored values an environment variable is currently overriding.
 *
 * The shadowing report is what earns this section its name. Without it an
 * operator sets a value in the UI, an environment variable silently wins, the
 * change has no effect, and no surface anywhere explains why. */
export function securityRoutes(): Hono {
	const app = new Hono();
	app.use("*", auditConfigMutation());
	app.use("*", instanceOwnerOnly());

	app.get("/", async (c) => {
		const master = await secretStoreStatus();
		return c.json({
			master_key: master,
			shadowed: await shadowedConfigKeys(allDeclaredConfigKeys()),
			/* Only meaningful when the key cannot open what is stored. Counted so the
			 * surface can say what a reset costs before it is confirmed. */
			...(master.state === "changed" ? { unreadable: await unreadableSecretStorage() } : {}),
		});
	});

	/* Generate a new master key and re-wrap the data key under it, KEEPING the
	 * previous wrapping. Both keys open the store until a restart proves the
	 * operator saved this one — `process.env` is fixed at boot, so there is no
	 * other moment that proof can exist, and dropping the old wrapping before it
	 * would make a restart at the wrong moment lose every stored credential. */
	app.post("/master-key/rotate", async (c) => {
		try {
			const result = await rotateMasterKey();
			return c.json({
				// Present only when the operator has to place the key themselves.
				// Shown once; no later request returns it.
				...(result.key ? { key: result.key } : {}),
				pending: result.pending,
				source: result.source,
				status: await secretStoreStatus(),
			});
		} catch (error) {
			if (error instanceof SecretStoreError) {
				return c.json({ error: error.reason, message: error.message }, 400);
			}
			throw error;
		}
	});

	/* The way out of a rotation the operator could not finish.
	 *
	 * A rotation completes only on a restart carrying the new key. Lose that key
	 * before saving it and the pending state is permanent — this drops the
	 * wrapping nothing can open and keeps the one in force, so every stored secret
	 * stays readable. */
	app.post("/master-key/cancel-rotation", async (c) => {
		if (!(await cancelRotation())) {
			return c.json(
				{ error: "no_pending_rotation", message: "there is no rotation to cancel" },
				400,
			);
		}
		return c.json({ ok: true, status: await secretStoreStatus() });
	});

	/* The way out of a lost master key.
	 *
	 * Every write fails while the envelope cannot be opened — including the writes
	 * an operator would make to re-enter their credentials, which is exactly what
	 * the error tells them to do. Without this the store is bricked and the remedy
	 * we print does not exist.
	 *
	 * Destroys only what no available key can read. Never automatic: a mismatch is
	 * usually a misconfiguration, and wiping on sight would destroy secrets the
	 * correct key could still open. */
	app.post("/master-key/reset", async (c) => {
		const before = await secretStoreStatus();
		if (before.state !== "changed") {
			return c.json(
				{
					error: "nothing_to_reset",
					message: "the current master key can read stored credentials; nothing needs discarding",
				},
				400,
			);
		}
		const removed = await resetSecretStorage();
		return c.json({ ok: true, removed: removed.secretCount, status: await secretStoreStatus() });
	});

	return app;
}

export function providerRoutes(): Hono {
	const app = new Hono();
	app.use("*", auditConfigMutation());
	app.use("*", instanceOwnerOnly());
	// Readiness and credentials are read synchronously from the config snapshot;
	// every request here is an async boundary, so reload it first.
	app.use("*", async (_c, next) => {
		await refreshProviderConfig();
		await next();
	});

	/* A provider's declared fields and what is currently set.
	 *
	 * `set` plus a masked tail for a secret; the real value for everything else,
	 * because an endpoint is not a credential and a form that cannot show it makes
	 * the operator retype a URL to change a model name. */
	app.get("/:id/config", async (c) => {
		const provider = findCatalogProvider(c.req.param("id"));
		if (!provider) return c.json({ error: "unknown_provider" }, 404);

		const fields = await Promise.all(
			provider.config.map(async (field) => {
				const secret = field.kind === "secret";
				const resolved = await resolveConfig(field.key, { secret });
				return {
					key: field.key,
					label: field.label,
					kind: field.kind,
					required: field.required,
					...(field.help ? { help: field.help } : {}),
					...(field.options ? { options: field.options } : {}),
					set: resolved.value != null || (secret && (await hasSecret(field.key))),
					source: resolved.source,
					// The environment overrides this stored value, so an edit here has no
					// effect. Reported rather than left for the operator to discover.
					shadowed: resolved.shadowed,
					...(resolved.error ? { error: resolved.error } : {}),
					...(secret
						? { value_masked: resolved.value ? maskSecret(resolved.value) : null }
						: { value: resolved.value ?? null }),
				};
			}),
		);

		return c.json({
			provider: provider.id,
			label: provider.label,
			fields,
			// A provider whose setup is an install rather than a form.
			...(provider.action ? { action: provider.action } : {}),
		});
	});

	/* Save. An absent or empty value means "leave this alone" — removal is the
	 * explicit action below, not an emptied field. */
	app.put("/:id/config", async (c) => {
		const provider = findCatalogProvider(c.req.param("id"));
		if (!provider) return c.json({ error: "unknown_provider" }, 404);

		const parsed = configBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "values required" }, 400);

		const declared = new Map(provider.config.map((field) => [field.key, field]));
		const written: string[] = [];
		for (const [key, raw] of Object.entries(parsed.data.values)) {
			const field = declared.get(key);
			// Only declared keys. Otherwise this is a write-any-setting endpoint for
			// anyone who guesses a key name.
			if (!field) continue;
			const value = raw.trim();
			if (!value) continue;
			try {
				if (field.kind === "secret") await setSecret(key, value);
				else await setConfig(key, value);
				await refreshProviderConfig();
			} catch (error) {
				if (error instanceof SecretStoreError) {
					return c.json({ error: error.reason, message: error.message }, 400);
				}
				throw error;
			}
			written.push(key);
		}
		return c.json({ ok: true, written });
	});

	app.delete("/:id/config/:key", async (c) => {
		const provider = findCatalogProvider(c.req.param("id"));
		if (!provider) return c.json({ error: "unknown_provider" }, 404);
		const key = c.req.param("key");
		const field = provider.config.find((f) => f.key === key);
		if (!field) return c.json({ error: "unknown_field" }, 404);

		if (field.kind === "secret") await unsetSecret(key);
		else await setConfig(key, null);
		await refreshProviderConfig();
		return c.json({ ok: true });
	});

	/* Test a candidate configuration WITHOUT saving it.
	 *
	 * An operator who cannot test learns their key is wrong when a generation
	 * fails hours later, with nothing connecting the failure to what they typed.
	 * The candidate is scoped to this call — concurrent tests cannot observe each
	 * other — and nothing is persisted whatever the result. */
	/* Run a provider's bespoke setup action. Local captions installs whisper.cpp
	 * and its model; there is no credential to enter, so the page offers this
	 * instead of a form. */
	app.post("/:id/install", async (c) => {
		const provider = findCatalogProvider(c.req.param("id"));
		if (!provider || provider.action !== "install-captions") {
			return c.json({ error: "no_install_action" }, 404);
		}
		try {
			const status = await setupLocalWhisper();
			return c.json({ ok: true, ready: status.ready });
		} catch (error) {
			/* The web client reports `error`, so it carries the cause, not a code. */
			return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
		}
	});

	app.post("/:id/test", async (c) => {
		const provider = findCatalogProvider(c.req.param("id"));
		if (!provider) return c.json({ error: "unknown_provider" }, 404);

		const parsed = configBody.safeParse(await c.req.json().catch(() => ({ values: {} })));
		const submitted = parsed.success ? parsed.data.values : {};

		const declared = new Set(provider.config.map((field) => field.key));
		const candidate: Record<string, string> = {};
		for (const [key, value] of Object.entries(submitted)) {
			if (declared.has(key) && value.trim()) candidate[key] = value.trim();
		}

		const capability = provider.capabilities[0];
		if (!capability) return c.json({ error: "provider_serves_no_capability" }, 400);

		const probe = await withConfigOverride(candidate, () => probeProvider(provider, capability));

		return c.json({
			ok: probe.ok,
			/* Whether a connection was actually attempted. Without this the surface
			 * cannot tell "it answered" from "it looks configured", and would report
			 * the second as the first. */
			probed: probe.probed,
			...(probe.reason ? { reason: probe.reason } : {}),
			...(probe.ok
				? {}
				: {
						message: probe.probed
							? `${provider.label} could not be reached: ${probe.reason ?? "no response"}`
							: `${provider.label} is still missing required values`,
					}),
		});
	});

	return app;
}
