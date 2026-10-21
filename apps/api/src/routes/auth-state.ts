/* What the sign-in screen needs to know BEFORE anyone is signed in.
 *
 * Exactly one bit: has this deployment got an account yet. Without it the web
 * client cannot tell "sign in" from "create the first owner", and guessing
 * wrong either asks a new operator for a credential that cannot exist or
 * offers account creation on a deployment that already refuses it.
 *
 * Deliberately one boolean and nothing else. This route answers an anonymous
 * caller, so every field it gains is a field an anonymous caller gets — account
 * counts, addresses, and instance names are all things a prober would like and
 * the screen does not need. */
import { Hono } from "hono";
import { openDb } from "@maleo/db/connection";
import { MODEL_NAMES, selfRegistrationEnabled } from "@maleo/auth/config";

export function authStateRoutes(): Hono {
	const app = new Hono();

	app.get("/", async (c) => {
		const count =
			(await openDb().get<{ c: number }>(`SELECT count(*) AS c FROM ${MODEL_NAMES.user}`))?.c ?? 0;
		return c.json({
			hasAccounts: count > 0,
			// Whether the screen should offer sign-up at all. An operator who opened
			// registration expects to see the option; one who did not should not be
			// shown a form that will be refused.
			registrationOpen: count === 0 || (await selfRegistrationEnabled()),
		});
	});

	return app;
}
