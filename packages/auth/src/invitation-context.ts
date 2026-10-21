/* "An invitation authorises this sign-up."
 *
 * Registration is closed by default, and the refusal lives in a better-auth
 * `databaseHooks.user.create.before` hook — one layer below the route, with no
 * access to what the caller presented. Redemption has to reach through it.
 *
 * A module-level boolean would do it, and would be a race: the hook is async,
 * two redemptions and an ordinary sign-up can be in flight together, and a flag
 * set by one would authorise another. AsyncLocalStorage scopes the permission
 * to the one call stack that earned it, which is exactly the shape of the
 * claim being made.
 *
 * Nothing outside this file may set it. The only caller is the redemption
 * route, and only after `findRedeemable` has returned a row.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage<{ workspace: string }>();

/** Run `fn` with sign-up authorised by a verified invitation to `workspace`. */
export function withInvitationAuthorisation<T>(
	workspace: string,
	fn: () => Promise<T>,
): Promise<T> {
	return store.run({ workspace }, fn);
}

/** The workspace an in-flight redemption is for, or null outside one. */
export function invitationAuthorisation(): { workspace: string } | null {
	return store.getStore() ?? null;
}
