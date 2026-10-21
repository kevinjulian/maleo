/* Two readers for walking an object's own entries.
 *
 * `Object.keys` and `Object.entries` are typed to return `string` keys, and
 * correctly so: a TypeScript object type is open, and a value can carry keys the
 * type never declared. Every call site that wanted the declared keys back said
 * so with an assertion — thirteen of them, each repeating the same claim.
 *
 * Stated once, here. */

/** An object's own keys, at the type it declares.
 *
 *  Sound for an object this code CONSTRUCTED — a literal, a defaults table, a
 *  store's initial state — and unsound for one that arrived from outside. Use it
 *  on the former; a parsed payload should be parsed, not walked. */
export function keysOf<T extends object>(value: T): Array<keyof T> {
	// SAFETY: `Object.keys` returns `string[]` because a runtime value may carry
	// keys its type never declared. Narrowing them back to `keyof T` holds only
	// under the constructed-here condition stated above.
	return Object.keys(value) as Array<keyof T>;
}

/** An object's own entries, keyed at the type it declares. Same condition as
 *  `keysOf`: the object has to be one this code built. */
export function entriesOf<T extends object>(value: T): Array<[keyof T, T[keyof T]]> {
	// SAFETY: as `keysOf` above. The value type is the object's own, so only the
	// key narrowing is a claim.
	return Object.entries(value) as Array<[keyof T, T[keyof T]]>;
}

/** The own entries of a value that may not be an object at all.
 *
 *  For walking a payload rather than a value this code built: anything that is
 *  not a plain object reads as empty rather than throwing. No key narrowing is
 *  claimed, because for an unknown value there is no declared key set to narrow
 *  to — which is the honest difference from `entriesOf`. */
export function entriesOfUnknown(value: unknown): Array<[string, unknown]> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
	return Object.entries(value);
}

/** One own property off a value that may not be an object at all.
 *
 *  For reading a payload nothing has parsed yet — a provider's response, a
 *  stored blob — without first claiming a shape for the envelope. Returns
 *  `undefined` for a non-object rather than throwing, so a caller checks the
 *  field it wants instead of the wrapper it does not care about.
 *
 *  No assertion: `getOwnPropertyDescriptor` gives back `unknown`, which is what
 *  the value actually is until something checks it. */
export function fieldOf(value: unknown, key: string): unknown {
	if (value === null || typeof value !== "object") return undefined;
	return Object.getOwnPropertyDescriptor(value, key)?.value;
}

/** A field read off untrusted data, as text: a string as it is, a number,
 *  boolean or bigint written out, and anything else — an object, an array,
 *  null — as `fallback`. `String()` on those would be `[object Object]`, which
 *  then reads as real content. */
export function textOf(value: unknown, fallback = ""): string {
	switch (typeof value) {
		case "string":
			return value;
		case "number":
		case "boolean":
		case "bigint":
			return String(value);
		case "object":
		case "undefined":
		case "function":
		case "symbol":
			return fallback;
	}
}
