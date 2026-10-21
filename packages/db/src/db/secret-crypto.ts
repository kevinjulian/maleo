/* Authenticated encryption for operator-supplied secrets.
 *
 * Primitives only: this file knows how to seal a string under a 32-byte key and
 * how to fingerprint a key. It knows nothing about where keys or ciphertexts are
 * stored — `secret-store.ts` owns that, and owns the envelope that makes master
 * key rotation a one-row rewrite.
 *
 * AES-256-GCM rather than a stream cipher plus a MAC: the tag is what makes a
 * wrong key distinguishable from a corrupt row, and that distinction is a
 * requirement here, not a nicety. See `managed-secret-storage`. */
import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12; // 96 bits, the size GCM is defined for
const TAG_BYTES = 16;
export const KEY_BYTES = 32;

/* Sealed values carry their format so a later format can be added without
 * guessing at the shape of what is already stored. */
const FORMAT = "v1";

export type SecretCryptoFailure =
	// The text is not a sealed value at all: wrong shape, wrong format tag, or
	// bad base64. Distinct from `auth` because it cannot be caused by a key.
	| "malformed"
	// The ciphertext did not authenticate. Either the key is wrong or the bytes
	// were altered; GCM alone cannot say which, which is why the store keeps a
	// key fingerprint and checks it first.
	| "auth";

export class SecretCryptoError extends Error {
	readonly reason: SecretCryptoFailure;

	constructor(reason: SecretCryptoFailure, message: string) {
		super(message);
		this.name = "SecretCryptoError";
		this.reason = reason;
	}
}

/** A fresh 256-bit key. Used for both the master key and the data key. */
export function generateKey(): Buffer {
	return randomBytes(KEY_BYTES);
}

export function encodeKey(key: Buffer): string {
	return key.toString("base64");
}

/**
 * Parse a base64 or 64-character hex key, rejecting anything that is not
 * exactly 32 bytes.
 *
 * Hex is accepted because `openssl rand -hex 32` and platform generators produce
 * it; read as base64 it would decode to 48 bytes. The two never collide: a
 * 32-byte key is 44 base64 characters or 64 hex characters.
 *
 * A short key is the failure worth catching loudly: it would otherwise be padded
 * or rejected deep inside the cipher, at a point where the message no longer says
 * "your MALEO_MASTER_KEY is the wrong length".
 */
export function decodeKey(text: string): Buffer {
	const trimmed = text.trim();
	if (!trimmed) throw new SecretCryptoError("malformed", "key is empty");
	const key = /^[0-9a-f]{64}$/i.test(trimmed)
		? Buffer.from(trimmed, "hex")
		: Buffer.from(trimmed, "base64");
	if (key.length !== KEY_BYTES) {
		throw new SecretCryptoError(
			"malformed",
			`key must be ${KEY_BYTES} bytes, base64 or 64 hex characters, got ${key.length}`,
		);
	}
	return key;
}

/**
 * A stable, non-reversible identifier for a key.
 *
 * Lets the store answer "is this the key this wrapping was made for" before
 * attempting decryption, so a rotated key reports as a rotated key rather than as
 * indistinguishable ciphertext corruption.
 *
 * Domain-separated so this value can never collide with anything else derived
 * from the same key material.
 */
export function keyFingerprint(key: Buffer): string {
	return createHash("sha256")
		.update("maleo:master-key-fingerprint:v1")
		.update(key)
		.digest("base64url")
		.slice(0, 22);
}

export function fingerprintsMatch(a: string, b: string): boolean {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	if (left.length !== right.length) return false;
	return timingSafeEqual(left, right);
}

/**
 * Encrypt `plaintext` under `key`.
 *
 * A fresh nonce per call is what keeps GCM safe; reusing one under the same key
 * is catastrophic rather than merely weak, so the nonce is generated here and
 * never accepted from a caller.
 */
export function seal(plaintext: string, key: Buffer): string {
	const nonce = randomBytes(NONCE_BYTES);
	const cipher = createCipheriv(ALGORITHM, key, nonce);
	const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag();
	return [
		FORMAT,
		nonce.toString("base64url"),
		ciphertext.toString("base64url"),
		tag.toString("base64url"),
	].join(".");
}

/** Decrypt a value produced by `seal`. Throws `SecretCryptoError` on any failure. */
export function unseal(sealed: string, key: Buffer): string {
	const parts = sealed.split(".");
	if (parts.length !== 4 || parts[0] !== FORMAT) {
		throw new SecretCryptoError("malformed", "value is not a sealed secret");
	}
	const nonce = Buffer.from(parts[1] ?? "", "base64url");
	const ciphertext = Buffer.from(parts[2] ?? "", "base64url");
	const tag = Buffer.from(parts[3] ?? "", "base64url");
	if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES) {
		throw new SecretCryptoError("malformed", "sealed secret has a malformed nonce or tag");
	}
	try {
		const decipher = createDecipheriv(ALGORITHM, key, nonce);
		decipher.setAuthTag(tag);
		return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
	} catch {
		// `final()` throws when the tag does not verify. Nothing here distinguishes
		// a wrong key from altered bytes — the caller checks the fingerprint first
		// precisely because this layer cannot.
		throw new SecretCryptoError("auth", "sealed secret failed authentication");
	}
}
