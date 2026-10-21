/* The configuration service other processes of ours read.
 *
 * The media worker is a separate deployment with its own storage, and it is the
 * process that resolves and runs providers for durable generation. Without this
 * endpoint a credential entered in Settings is invisible exactly where it is
 * needed, and the surface reports a provider ready that cannot run.
 *
 * THIS ROUTE RETURNS DECRYPTED CREDENTIALS. It is the highest-value target the
 * application has, so it is deliberately not part of the public API:
 *
 *   - mounted OUTSIDE the `api` Hono app, which applies CORS to `*`. A browser
 *     must never be able to reach this, and inheriting a permissive origin from
 *     a sibling route is exactly how it would.
 *   - refuses every request when no service token is configured, rather than
 *     defaulting open for convenience.
 *   - constant-time token comparison.
 *   - answers 401 for an unknown provider as well as a bad token, so it cannot
 *     be used to enumerate what exists.
 *
 * Only keys a provider DECLARES are served. The endpoint cannot be used to read
 * arbitrary settings by guessing key names. */
import { Hono } from "hono";
import { resolveDeclared } from "../lib/declared-config.ts";
import { bearerFrom, configuredServiceToken, isValidServiceToken } from "../lib/service-token.ts";
import { allDeclaredConfigKeys, findCatalogProvider } from "../lib/provider-catalog.ts";

export function internalConfigRoutes(): Hono {
	const app = new Hono();

	/* Every declared key at once.
	 *
	 * The provider seam resolves BY KEY, synchronously, deep inside a provider —
	 * it has no provider id to ask for. So a worker's snapshot has to hold every
	 * key any provider might read, which is one request rather than one per
	 * provider on every refresh.
	 *
	 * Least privilege is not lost by much: a worker runs whichever provider a job
	 * names, so it legitimately needs all of them. `/provider-config/:id` remains
	 * for a caller that wants exactly one. */
	app.get("/config", async (c) => {
		const presented = bearerFrom(c.req.header("authorization")) ?? c.req.header("x-service-token");
		if (!isValidServiceToken(presented)) {
			return c.json(
				{
					error: "unauthorized",
					message: configuredServiceToken()
						? "invalid service token"
						: "no MALEO_SERVICE_TOKEN is configured on this server",
				},
				401,
			);
		}
		const { values, errors } = await resolveDeclared(allDeclaredConfigKeys());
		return c.json({
			values,
			...(Object.keys(errors).length > 0 ? { errors } : {}),
		});
	});

	app.get("/provider-config/:id", async (c) => {
		const presented = bearerFrom(c.req.header("authorization")) ?? c.req.header("x-service-token");
		if (!isValidServiceToken(presented)) {
			return c.json(
				{
					error: "unauthorized",
					// Naming the cause is safe and saves an operator an hour: it says
					// the server has no token, never anything about the one presented.
					message: configuredServiceToken()
						? "invalid service token"
						: "no MALEO_SERVICE_TOKEN is configured on this server",
				},
				401,
			);
		}

		const provider = findCatalogProvider(c.req.param("id"));
		// Same status and body as a bad token: an authenticated caller is one of
		// our own processes and knows its provider ids, so distinguishing the two
		// only helps someone probing.
		if (!provider) return c.json({ error: "unauthorized" }, 401);

		const { values, errors } = await resolveDeclared(provider.config);

		return c.json({
			provider: provider.id,
			values,
			...(Object.keys(errors).length > 0 ? { errors } : {}),
		});
	});

	return app;
}
