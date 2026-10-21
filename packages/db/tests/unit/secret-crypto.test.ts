/* Proof for tasks 1.1 and 1.3: sealing round-trips, repeats never look alike,
 * and a wrong key is reported as a wrong key rather than as corruption. */
import { describe, expect, test } from "vite-plus/test";
import {
	decodeKey,
	encodeKey,
	fingerprintsMatch,
	generateKey,
	KEY_BYTES,
	keyFingerprint,
	seal,
	SecretCryptoError,
	unseal,
} from "../../src/db/secret-crypto.ts";

describe("secret-crypto", () => {
	test("round-trips a value", () => {
		const key = generateKey();
		expect(unseal(seal("sk-live-abc123", key), key)).toBe("sk-live-abc123");
	});

	test("round-trips an empty string and multibyte text", () => {
		const key = generateKey();
		expect(unseal(seal("", key), key)).toBe("");
		expect(unseal(seal("токен・鍵・🔑", key), key)).toBe("токен・鍵・🔑");
	});

	// The nonce is per-call, so identical plaintexts must not produce identical
	// ciphertexts — otherwise the store leaks which providers share a credential.
	test("two encryptions of the same plaintext differ", () => {
		const key = generateKey();
		expect(seal("same", key)).not.toBe(seal("same", key));
	});

	test("plaintext does not appear in the sealed value", () => {
		const key = generateKey();
		expect(seal("hunter2", key)).not.toContain("hunter2");
	});

	test("a wrong key fails authentication rather than returning garbage", () => {
		const sealed = seal("secret", generateKey());
		try {
			unseal(sealed, generateKey());
			throw new Error("expected unseal to throw");
		} catch (error) {
			expect(error).toBeInstanceOf(SecretCryptoError);
			expect((error as SecretCryptoError).reason).toBe("auth");
		}
	});

	test("altered ciphertext fails authentication", () => {
		const key = generateKey();
		const parts = seal("secret", key).split(".");
		const bytes = Buffer.from(parts[2] ?? "", "base64url");
		bytes[0] = (bytes[0] ?? 0) ^ 0xff;
		parts[2] = bytes.toString("base64url");
		expect(() => unseal(parts.join("."), key)).toThrow(SecretCryptoError);
	});

	// `malformed` and `auth` are separate reasons so the store can tell "this row
	// is not a secret" from "this key cannot open it".
	test("a non-sealed string is malformed, not an auth failure", () => {
		for (const bad of ["", "plain text", "v2.a.b.c", "v1.only.three"]) {
			try {
				unseal(bad, generateKey());
				throw new Error(`expected unseal to throw for ${JSON.stringify(bad)}`);
			} catch (error) {
				expect(error).toBeInstanceOf(SecretCryptoError);
				expect((error as SecretCryptoError).reason).toBe("malformed");
			}
		}
	});

	test("keys encode and decode", () => {
		const key = generateKey();
		expect(key.length).toBe(KEY_BYTES);
		expect(decodeKey(encodeKey(key)).equals(key)).toBe(true);
	});

	test("a 64-character hex key is accepted as the same 32 bytes", () => {
		const key = generateKey();
		expect(decodeKey(key.toString("hex")).equals(key)).toBe(true);
		expect(decodeKey(key.toString("hex").toUpperCase()).equals(key)).toBe(true);
	});

	test("a key of the wrong length is rejected with a message naming the length", () => {
		expect(() => decodeKey("a".repeat(64).replace(/a$/, "z"))).toThrow(/got 48/);
		expect(() => decodeKey(Buffer.alloc(16).toString("base64"))).toThrow(/32 bytes/);
		expect(() => decodeKey("")).toThrow(SecretCryptoError);
	});
});

describe("key fingerprint", () => {
	test("is stable for one key and differs across keys", () => {
		const key = generateKey();
		expect(keyFingerprint(key)).toBe(keyFingerprint(key));
		expect(keyFingerprint(key)).not.toBe(keyFingerprint(generateKey()));
	});

	test("does not reveal the key", () => {
		const key = generateKey();
		expect(keyFingerprint(key)).not.toContain(encodeKey(key));
		expect(keyFingerprint(key).length).toBeLessThan(encodeKey(key).length);
	});

	test("compares equal fingerprints and rejects different ones", () => {
		const key = generateKey();
		expect(fingerprintsMatch(keyFingerprint(key), keyFingerprint(key))).toBe(true);
		expect(fingerprintsMatch(keyFingerprint(key), keyFingerprint(generateKey()))).toBe(false);
		expect(fingerprintsMatch("short", keyFingerprint(key))).toBe(false);
	});
});
