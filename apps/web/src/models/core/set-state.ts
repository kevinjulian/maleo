/* Resolve a React `SetStateAction` to its value.
 *
 * `SetStateAction<T>` is `T | ((prev: T) => T)`, and `typeof next === "function"`
 * does NOT narrow it — because `T` itself could be a function type, TypeScript
 * cannot rule out that the function IS the value. So every caller that wanted
 * the resolved value wrote the same assertion, ten times across the app.
 *
 * One place carries the claim now. This is the same trade `keysOf` makes in
 * `@maleo/shared`: the assertion does not disappear, it stops being repeated,
 * and it gets a stated condition instead of being re-derived at each site.
 *
 * The condition: this is wrong for a `T` that is itself a function type, where a
 * caller passing the function AS the value would have it called instead. No
 * state in this app is a function, and a store that held one would need its own
 * resolver anyway — an updater and a function value are indistinguishable at
 * runtime, so the ambiguity is in `SetStateAction`, not here.
 */
import type { SetStateAction } from "react";

export function resolveSetState<T>(next: SetStateAction<T>, current: T): T {
	// SAFETY: `typeof next === "function"` is the runtime test React itself uses
	// to tell an updater from a value. The narrowing it cannot do is the one
	// described above, and it holds for every `T` in this app.
	return typeof next === "function" ? (next as (prev: T) => T)(current) : next;
}
