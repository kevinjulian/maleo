/** One of a closed set of string values, or `undefined` when the input is not
 *  one of them.
 *
 *  For query parameters and other client input, where the union is what the
 *  handler accepts and anything else is simply not it. Asserting instead —
 *  `c.req.query("scope") as "workspace" | "campaign" | "project"` — types a
 *  value the client chose as if the server had checked it, and a bogus one then
 *  travels as far as whatever finally fails to match it.
 *
 *  Returns the matched member rather than a boolean, so there is nothing left to
 *  assert: `find` already has the narrowed type. */
export function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
	if (typeof value !== "string") return undefined;
	return allowed.find((candidate) => candidate === value);
}
