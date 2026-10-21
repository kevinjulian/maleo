/* The credential another of our own processes presents.
 *
 * Used by exactly one route — the internal configuration endpoint — and that
 * route hands out decrypted credentials. It is the highest-value target this
 * application has, so the checks here are deliberately blunt:
 *
 *   no token configured  ->  refuse everything
 *   token configured     ->  constant-time compare, nothing else accepted
 *
 * "No token configured" refusing everything is the important half. The tempting
 * default — allow when unset, so local development is frictionless — means a
 * deployment that forgot to set one serves credentials to anybody who asks, and
 * nothing anywhere reports a problem. */
import { timingSafeEqual } from "node:crypto";

export const SERVICE_TOKEN_ENV = "MALEO_SERVICE_TOKEN";

/* Read per call rather than at module load, so a token set after start is
 * honoured and tests can vary it without reimporting. */
export function configuredServiceToken(): string | undefined {
	const raw = process.env[SERVICE_TOKEN_ENV]?.trim();
	return raw ? raw : undefined;
}

/**
 * Whether `presented` is the configured service token.
 *
 * Compares in constant time: a byte-by-byte early return leaks the token one
 * character at a time to anyone who can measure the response, and this token
 * unlocks every stored credential.
 */
export function isValidServiceToken(presented: string | undefined): boolean {
	const expected = configuredServiceToken();
	if (!expected || !presented) return false;
	const a = Buffer.from(presented);
	const b = Buffer.from(expected);
	// Length is not secret — it is observable from the request anyway — but
	// timingSafeEqual throws on a mismatch, so it is checked first.
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

/** The token from an `authorization: Bearer …` header, if present. */
export function bearerFrom(header: string | undefined | null): string | undefined {
	if (!header) return undefined;
	const match = /^Bearer\s+(.+)$/i.exec(header.trim());
	return match?.[1]?.trim() || undefined;
}
