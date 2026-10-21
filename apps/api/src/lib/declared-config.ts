/* Every declared configuration key, resolved at once: environment first, then
 * the stored value. Served to other processes by /internal/config and held as
 * this process's own provider snapshot. */
import { resolveAnyConfig } from "@maleo/db/config-resolution";

export interface ResolvedDeclared {
	values: Record<string, string>;
	errors: Record<string, string>;
}

/** Resolve a set of declared keys, separating what could not be read. */
export async function resolveDeclared(keys: readonly { key: string }[]): Promise<ResolvedDeclared> {
	const values: Record<string, string> = {};
	const errors: Record<string, string> = {};
	for (const { key } of keys) {
		const resolved = await resolveAnyConfig(key);
		if (resolved.value != null) values[key] = resolved.value;
		// A key that is stored but unreadable is reported as itself rather than
		// omitted — the worker must be able to fail closed naming the cause,
		// instead of treating a master key problem as an unconfigured provider.
		if (resolved.error) errors[key] = resolved.error;
	}
	return { values, errors };
}
