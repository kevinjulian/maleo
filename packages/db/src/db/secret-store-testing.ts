/* One master key for the whole test run.
 *
 * TEST SUPPORT ONLY. Never import this from shipped code paths — it is a fixed,
 * public key, and anything encrypted under it is encrypted under a value that is
 * in the repository.
 *
 * Why it has to be shared rather than generated per file: `bun test` runs a
 * package's files in ONE process against ONE database (the preload in
 * `scripts/test-db-guard.ts` points every suite at a single temp path). The
 * secret store wraps its data key under whichever master key first stored a
 * secret, so a file that mints its own key cannot open an envelope created by a
 * file that ran before it. The symptom is the worst kind: every suite passes in
 * isolation and some fail together, in whatever order the runner picked.
 *
 * A test that specifically exercises a CHANGED or ROTATED key still generates its
 * own — that is the behaviour under test, and it switches keys after storing
 * rather than before. */
import { MASTER_KEY_ENV } from "./secret-store.ts";

/** A fixed, valid 32-byte key, base64. Public on purpose. */
export const TEST_MASTER_KEY = "YWluY2VyLXRlc3QtbWFzdGVyLWtleS0zMi1ieXRlcyE=";

/** Install the shared test key, returning what was there before. */
export function useTestMasterKey(): string | undefined {
	const previous = process.env[MASTER_KEY_ENV];
	process.env[MASTER_KEY_ENV] = TEST_MASTER_KEY;
	return previous;
}
