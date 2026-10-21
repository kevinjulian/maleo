/* TEST SUPPORT ONLY. Turns a real editing scope into one that can be committed.
 *
 * The corpus exists to catch drift that hand-written fixtures cannot: fields the
 * TS types never declared, absent-versus-empty values, odd numbers. So it keeps
 * everything structural and replaces everything a person wrote or uploaded:
 *
 *   - numbers, booleans, null, array lengths and object keys survive unchanged;
 *     an empty string stays empty, because "" and absent mean different things;
 *   - a string survives only when it is vocabulary (a literal in the shared
 *     package's own source, such as `"video"` or `"contain"`), a hex colour, an
 *     ordinal clip id (`video:3`) or an earlier sanitizer token;
 *   - every other string (titles, captions, voiceover, URLs, file names, UUIDs)
 *     becomes `s-` plus 12 hex characters of a SHA-256 of the value, so equal
 *     values stay equal and references between entities still resolve.
 *
 * Deterministic and idempotent: sanitizing a sanitized value changes nothing. */
import { createHash } from "node:crypto";

const TOKEN = /^s-[0-9a-f]{12}$/;
const HEX_COLOUR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const ORDINAL_ID = /^[a-z]+:\d+$/;
const IDENTIFIER_KEY = /^[A-Za-z_][A-Za-z0-9_]*$|^\d+$/;

export const corpusToken = (value: string): string => `s-${createHash("sha256").update(value).digest("hex").slice(0, 12)}`;

const keepString = (value: string, vocabulary: ReadonlySet<string>): boolean =>
	value === "" || TOKEN.test(value) || HEX_COLOUR.test(value) || ORDINAL_ID.test(value) || vocabulary.has(value);

/* Schema keys are identifiers; a key that is not (a UUID, a file name) is data
 * keyed into a record, and is replaced like any other string. */
const sanitizeKey = (key: string, vocabulary: ReadonlySet<string>): string =>
	IDENTIFIER_KEY.test(key) || keepString(key, vocabulary) ? key : corpusToken(key);

export function sanitizeCorpusValue(value: unknown, vocabulary: ReadonlySet<string>): unknown {
	if (typeof value === "string") return keepString(value, vocabulary) ? value : corpusToken(value);
	if (Array.isArray(value)) return value.map((item) => sanitizeCorpusValue(item, vocabulary));
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [sanitizeKey(key, vocabulary), sanitizeCorpusValue(item, vocabulary)]));
	}
	return value;
}

/* Every double-quoted string literal in the given sources: the vocabulary a
 * document's enum-like fields are drawn from. A user's text would have to match
 * a literal already published in this repository to survive. */
export function vocabularyOf(sources: readonly string[]): Set<string> {
	const words = new Set<string>();
	for (const source of sources) for (const match of source.matchAll(/"((?:[^"\\\n]|\\.){1,64})"/g)) words.add(match[1]!);
	return words;
}
