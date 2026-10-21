/* Entity fingerprints — how a settled result finds out whether the thing it
 * edited changed underneath it.
 *
 * A run can take minutes. The user keeps working during them. So when a result
 * finally arrives, something has to answer: is the clip this result rewrites
 * still the clip the run read? A project-wide revision counter answers a
 * different and worse question — "did anything at all change" — and reports a
 * conflict for an edit three scenes away that the result never touches.
 *
 * A content hash per entity answers exactly the right question. Hash what the run
 * read, hash it again at apply time, compare. Equal means untouched. It also gets
 * the awkward case right for free: an entity edited and then undone hashes back
 * to its original value and correctly does not conflict, where a counter would
 * have incremented twice and blocked a result for no reason.
 *
 * The hash is not a security boundary. Nobody is attacking it; it detects
 * concurrent edits by the same user in the same document, so a short, fast,
 * dependency-free hash is the right tool and a cryptographic one would be
 * cargo cult. */
import type { ChatEntityRef, EntityFingerprint } from "./chat-context-envelope.ts";
import type { Clip } from "./timeline-doc.ts";
import { entityKey } from "./chat-context-envelope.ts";

/* Canonical JSON: key order must not change the hash.
 *
 * Two records with identical content but different key insertion order are the
 * same record, and they arrive in different orders constantly — one from the
 * editor's own state, one round-tripped through the API's JSON. If key order fed
 * the hash, every result would look like a conflict.
 *
 * `undefined` is dropped so an explicitly-absent field and a never-set field
 * agree, which is the same distinction JSON itself refuses to make. */
export function stableStringify(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	/* Entries rather than an asserted index type: `Object.entries` already gives
	 * the key/value pairs with no claim about what the values are, which is the
	 * honest shape for a function whose whole job is to walk arbitrary JSON. */
	const parts = Object.entries(value)
		.filter(([, entryValue]) => entryValue !== undefined)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
	return `{${parts.join(",")}}`;
}

/* FNV-1a, 64-bit, hex.
 *
 * Fast, deterministic across web and API, and needs no dependency in a package
 * that is bundled into the browser. Collisions are the only failure mode and a
 * collision here means one stale result applies — the same outcome as not
 * fencing at all, which is what the code did before this existed. */
export function hashString(input: string): string {
	let hash = 0xcbf29ce484222325n;
	const prime = 0x100000001b3n;
	const mask = 0xffffffffffffffffn;
	for (let i = 0; i < input.length; i++) {
		hash ^= BigInt(input.charCodeAt(i));
		hash = (hash * prime) & mask;
	}
	return hash.toString(16).padStart(16, "0");
}

/** The content hash of one entity's canonical record. */
export function fingerprintValue(value: unknown): string {
	return hashString(stableStringify(value));
}

/** A timeline clip's fingerprint: its content, filed under its id. The id is the
 *  identity, not part of the value. One rule for the editor's capture and the
 *  server's record of a run's starting document, so the two compare. */
export function clipFingerprint(clip: Clip): EntityFingerprint {
	const { id, ...content } = clip;
	return {
		...fingerprintEntity({ kind: "clip", id }, content),
		...(clip.caption?.sources.length
			? { sourceClipIds: [...new Set(clip.caption.sources.map((source) => source.clipId))] }
			: {}),
	};
}

/** Fingerprint one entity: what it is plus what it contained at capture time. */
export function fingerprintEntity(ref: ChatEntityRef, value: unknown): EntityFingerprint {
	return { ...ref, hash: fingerprintValue(value) };
}

/** Index fingerprints by entity for lookup at apply time. */
export function fingerprintIndex(fingerprints: EntityFingerprint[]): Map<string, string> {
	return new Map(fingerprints.map((fp) => [entityKey(fp), fp.hash]));
}

/* Did this entity change since capture?
 *
 * An entity with no captured fingerprint is reported as changed. The run never
 * established what it looked like, so "unchanged" would be a claim nothing
 * supports — and the safe direction of that uncertainty is to hold the result for
 * review rather than to write over whatever is there now. */
export function hasEntityChanged(
	captured: Map<string, string>,
	ref: ChatEntityRef,
	currentValue: unknown,
): boolean {
	const before = captured.get(entityKey(ref));
	if (before === undefined) return true;
	return before !== fingerprintValue(currentValue);
}
