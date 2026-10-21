/* Column decoders for the JSON-typed columns, and the read-back guard.
 *
 * SQLite stores these as text; every family that reads one decodes it the same
 * way, so the decoding lives once rather than per family. */

/** Read back a row this call just inserted or updated.
 *
 *  Writers across this package end by selecting the row they just wrote and
 *  asserting it non-null — `.get(id) as Row`, on a SELECT for an id written a
 *  few lines above. The claim is nearly always true and was never checked; when
 *  it is false the old code threw a TypeError deep inside a mapper destructuring
 *  `null`, which says nothing about what went wrong.
 *
 *  This throws in the same situation with the table named, so behaviour is
 *  unchanged and the failure is legible. It is deliberately NOT a silent
 *  fallback: a write that did not land is a bug, not a value to default. */
export function readBack<T>(row: T | null | undefined, table: string): T {
	if (!row) throw new Error(`${table}: row missing immediately after write`);
	return row;
}

export function parseJsonObject(input: string | null): Record<string, unknown> | null {
	if (!input) return null;
	try {
		const parsed: unknown = JSON.parse(input);
		// The narrowing IS the check — `typeof` plus the array test is what makes
		// this a `Record`, so nothing is claimed that was not just proven.
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
		return Object.fromEntries(Object.entries(parsed));
	} catch {
		return null;
	}
}

/** Decode a JSON column, falling back when it is absent, unparseable, or — when
 *  a `check` is supplied — not the shape the caller expects.
 *
 *  The `check` argument is OPTIONAL on purpose. Without it this does what it
 *  always did: `JSON.parse(input) as T`, one assertion standing in for every
 *  caller's claim, with the claim itself stated below. With it, the value is
 *  actually verified and `T` is inferred from the check rather than declared by
 *  the caller.
 *
 *  Callers move over one family at a time, because these columns hold rows
 *  written by earlier builds: a check too strict for an old row does not throw,
 *  it silently returns the fallback, which looks exactly like an empty column.
 *  That is the same property that makes this safe to adopt incrementally and
 *  dangerous to adopt in bulk. */
export function parseJsonValue<T>(
	input: string | null,
	fallback: T,
	check?: (value: unknown) => value is T,
): T {
	if (!input) return fallback;
	let parsed: unknown;
	try {
		parsed = JSON.parse(input);
	} catch {
		return fallback;
	}
	if (check) return check(parsed) ? parsed : fallback;
	// SAFETY: no `check` was supplied, so this is the caller's claim about a
	// column it also writes, not a verified shape. Supplying a `check` is what
	// retires this branch, one caller family at a time.
	return parsed as T;
}

/** A JSON column holding an object (not an array, not a scalar). */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** A JSON column holding an object, or an explicit null. Several columns are
 *  declared `Record<string, unknown> | null`, and a stored `null` is a value
 *  those readers handle rather than an absence. */
export function isJsonObjectOrNull(value: unknown): value is Record<string, unknown> | null {
	return value === null || isJsonObject(value);
}

/** A JSON column holding a list of strings. Non-string entries are a shape this
 *  never wrote, so a mixed array is rejected rather than filtered — a tag list
 *  that half-survives is harder to notice than one that reads as empty. */
export function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function parseJsonStringArray(input: string | null): string[] {
	if (!input) return [];
	try {
		const parsed = JSON.parse(input);
		return Array.isArray(parsed)
			? parsed.filter((item): item is string => typeof item === "string")
			: [];
	} catch {
		return [];
	}
}
