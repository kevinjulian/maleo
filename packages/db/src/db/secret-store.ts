/* Where operator-supplied secrets live.
 *
 * Envelope encryption, for one reason: rotating the master key must not ask an
 * operator to reconfigure their providers. A random DATA KEY encrypts every
 * secret; the data key is itself stored wrapped under the master key from the
 * environment. Rotation re-wraps one row and touches no secret.
 *
 *   MALEO_MASTER_KEY  --wraps-->  data key  --encrypts-->  every stored secret
 *      (environment)               (one row)
 *
 * The data key is wrapped under MORE THAN ONE master key during a rotation.
 * `process.env` is fixed at process start, so a running app cannot verify the
 * operator actually saved the new key into their deployment until it next boots.
 * Dropping the old wrapping before that proof means a restart at the wrong moment
 * makes every secret permanently unreachable — from a button we offered them. So
 * both wrappings persist until a startup proves the new key is present.
 *
 * Everything lives in `global_settings` under a reserved prefix rather than in a
 * table of its own: this database's tables are all declared in
 * unified-schema.ts, and a key/value row needs nothing that table does not
 * already have. */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveDataDir } from "../data-path.ts";
import { openDb } from "./connection.ts";
import type { Db } from "./handle.ts";
import { getGlobalSetting, SECRET_NAMESPACE, setGlobalSetting } from "./global-settings.ts";
import {
	decodeKey,
	encodeKey,
	fingerprintsMatch,
	generateKey,
	keyFingerprint,
	seal,
	SecretCryptoError,
	unseal,
} from "./secret-crypto.ts";

export const MASTER_KEY_ENV = "MALEO_MASTER_KEY";

/* Where a generated key is kept when the environment does not carry one.
 *
 * Beside the database, in the data directory — so wherever that survives a
 * restart, the key does too. This is the arrangement Rails uses for
 * `config/master.key`, and it accepts the same trade: copying the whole data
 * directory copies the key with it, so encryption at rest protects a dumped or
 * shared DATABASE, not a copied volume. Worth it, because the alternative is an
 * operator who cannot store a credential at all.
 *
 * `/data/` is gitignored, so this cannot be committed. */
export function masterKeyPath(): string {
	return join(resolveDataDir(), "master.key");
}

export type MasterKeySource = "env" | "file" | "generated";

/** The key in force, and where it came from. */
export interface ResolvedMasterKey {
	key: Buffer;
	source: MasterKeySource;
}

/**
 * The master key, generating one on first use if there is none.
 *
 * The environment wins, so a deployment that sets `MALEO_MASTER_KEY` keeps
 * exactly the key it chose and the file is never consulted.
 *
 * Generation is safe HERE and nowhere else, because the key is written down
 * before it is used. The failure this once refused to allow — a process
 * inventing a key per boot, leaving every secret it wrote unreadable after a
 * restart — comes from generating a key that cannot persist. So if the write
 * fails, nothing is generated: the caller is told, rather than handed a key that
 * will not exist next time.
 */
export function readOrCreateMasterKey(): ResolvedMasterKey {
	const fromEnv = masterKey();
	if (fromEnv) return { key: fromEnv, source: "env" };

	const path = masterKeyPath();
	if (existsSync(path)) {
		/* A file that exists but cannot be parsed is NOT replaced. Overwriting it
		 * would destroy the only copy of the key that every stored secret was
		 * encrypted under — the loudest possible failure is the safe one. */
		return { key: decodeKey(readFileSync(path, "utf8")), source: "file" };
	}

	const generated = generateKey();
	writeMasterKeyFile(generated);
	return { key: generated, source: "generated" };
}

function writeMasterKeyFile(key: Buffer): void {
	const path = masterKeyPath();
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, encodeKey(key), { mode: 0o600 });
	try {
		chmodSync(path, 0o600);
	} catch {
		/* best-effort on filesystems without unix modes, as writeWorkspaceSecrets does */
	}
}

/* The envelope row. Named under the reserved namespace so the same exclusion
 * that hides secrets from a generic listing hides the wrapped data key too. */
const ENVELOPE_KEY = `${SECRET_NAMESPACE}__envelope`;

export type SecretStoreFailure =
	// No master key in the environment at all.
	| "no_master_key"
	// A master key is present, but no stored wrapping was made for it. This is the
	// reason a fingerprint is stored: without it this case is indistinguishable
	// from corruption, and the operator is told their data is damaged when in fact
	// they simply pasted the wrong key.
	| "master_key_changed"
	// The wrapping was made for this key and still failed to open.
	| "corrupt";

export class SecretStoreError extends Error {
	readonly reason: SecretStoreFailure;

	constructor(reason: SecretStoreFailure, message: string) {
		super(message);
		this.name = "SecretStoreError";
		this.reason = reason;
	}
}

/** One wrapping of the data key, tagged with the master key it was made for. */
interface Wrapping {
	fingerprint: string;
	wrapped: string;
}

interface Envelope {
	wrappings: Wrapping[];
	/* Fingerprint of the key a rotation is waiting on.
	 *
	 * Without this, ANY wrapping that opens counts as proof — so booting with the
	 * key the operator is rotating away from would complete the rotation and
	 * discard the new one. The rotation is only finished when the environment
	 * carries the key rotation produced, not merely a key that works. */
	pending?: string;
}

function isWrapping(value: unknown): value is Wrapping {
	return (
		typeof value === "object" &&
		value !== null &&
		"fingerprint" in value &&
		typeof value.fingerprint === "string" &&
		"wrapped" in value &&
		typeof value.wrapped === "string"
	);
}

/* Every malformed shape resolves to `undefined` rather than throwing, so a
 * damaged envelope row reports as "no data key" — which the callers already
 * translate into a legible master-key message — instead of turning every read
 * into an unhandled parse error. */
async function readEnvelope(db: Db): Promise<Envelope | undefined> {
	const raw = await getGlobalSetting(ENVELOPE_KEY, db);
	if (!raw) return undefined;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return undefined;
		const wrappings = "wrappings" in parsed ? parsed.wrappings : undefined;
		if (!Array.isArray(wrappings)) return undefined;
		const cleaned = wrappings.filter(isWrapping);
		if (cleaned.length === 0) return undefined;
		const pending = "pending" in parsed ? parsed.pending : undefined;
		return { wrappings: cleaned, pending: typeof pending === "string" ? pending : undefined };
	} catch {
		return undefined;
	}
}

async function writeEnvelope(envelope: Envelope, db: Db): Promise<void> {
	await setGlobalSetting(ENVELOPE_KEY, JSON.stringify(envelope), db);
}

/** The master key from the environment, or undefined when none is configured. */
function masterKey(): Buffer | undefined {
	const raw = process.env[MASTER_KEY_ENV]?.trim();
	if (!raw) return undefined;
	// A malformed key is a configuration error worth surfacing as itself rather
	// than as "no key": the operator set something, it is just wrong.
	return decodeKey(raw);
}

/**
 * The key already in force: environment, then the file. Creates nothing.
 *
 * Used by every READ. A read that generated a key would put a `data/master.key`
 * on disk just because something asked whether a secret was set — and the new
 * key could not open anything anyway, so it would answer a question by making a
 * file nobody asked for.
 */
function readMasterKey(): Buffer | undefined {
	const fromEnv = masterKey();
	if (fromEnv) return fromEnv;
	const path = masterKeyPath();
	return existsSync(path) ? decodeKey(readFileSync(path, "utf8")) : undefined;
}

/** The key, creating one if there is none. Used only where something is STORED. */
function requireMasterKey(): Buffer {
	try {
		return readOrCreateMasterKey().key;
	} catch (error) {
		if (error instanceof SecretCryptoError) throw error;
		throw new SecretStoreError(
			"no_master_key",
			`no ${MASTER_KEY_ENV} is set and one could not be written to ${masterKeyPath()}: ` +
				`${error instanceof Error ? error.message : String(error)}. ` +
				`Set ${MASTER_KEY_ENV} in the environment instead.`,
		);
	}
}

/**
 * Unwrap the data key using the master key currently in the environment.
 *
 * Fingerprint first, decryption second — that ordering is what lets a rotated key
 * be reported as a rotated key.
 */
async function openDataKey(db: Db): Promise<Buffer> {
	const key = readMasterKey();
	if (!key) {
		throw new SecretStoreError(
			"no_master_key",
			`no master key is available: ${MASTER_KEY_ENV} is unset and ${masterKeyPath()} does not exist`,
		);
	}
	const envelope = await readEnvelope(db);
	if (!envelope) {
		throw new SecretStoreError("master_key_changed", "no stored data key to unwrap");
	}
	const fingerprint = keyFingerprint(key);
	const wrapping = envelope.wrappings.find((w) => fingerprintsMatch(w.fingerprint, fingerprint));
	if (!wrapping) {
		throw new SecretStoreError(
			"master_key_changed",
			`stored secrets were encrypted under a different ${MASTER_KEY_ENV}`,
		);
	}
	try {
		return Buffer.from(unseal(wrapping.wrapped, key), "base64");
	} catch (error) {
		throw new SecretStoreError(
			"corrupt",
			`the stored data key could not be opened: ${error instanceof SecretCryptoError ? error.reason : "unknown"}`,
		);
	}
}

/** Unwrap the data key, creating and wrapping a fresh one when none exists yet. */
async function openOrCreateDataKey(db: Db): Promise<Buffer> {
	const key = requireMasterKey();
	if (await readEnvelope(db)) return openDataKey(db);
	const dataKey = generateKey();
	await writeEnvelope(
		{
			wrappings: [
				{ fingerprint: keyFingerprint(key), wrapped: seal(dataKey.toString("base64"), key) },
			],
		},
		db,
	);
	return dataKey;
}

function secretKey(name: string): string {
	return `${SECRET_NAMESPACE}${name}`;
}

/**
 * Read a stored secret.
 *
 * Returns undefined when nothing is stored. Throws `SecretStoreError` when
 * something IS stored and cannot be read, because reporting an unreadable secret
 * as absent would present a key problem as an unconfigured provider.
 */
export async function getSecret(name: string, db: Db = openDb()): Promise<string | undefined> {
	const stored = await getGlobalSetting(secretKey(name), db);
	if (!stored) return undefined;
	const dataKey = await openDataKey(db);
	try {
		return unseal(stored, dataKey);
	} catch {
		throw new SecretStoreError("corrupt", `stored secret "${name}" could not be decrypted`);
	}
}

/** Store a secret. Refuses when no master key is configured. */
export async function setSecret(name: string, value: string, db: Db = openDb()): Promise<void> {
	const trimmed = value.trim();
	if (!trimmed) {
		// Removal is an explicit action. An emptied field means "leave this alone",
		// which is what the settings surface promises.
		throw new SecretStoreError(
			"corrupt",
			`refusing to store an empty secret for "${name}"; use unsetSecret`,
		);
	}
	const dataKey = await openOrCreateDataKey(db);
	await setGlobalSetting(secretKey(name), seal(trimmed, dataKey), db);
}

/* A sealed value kept by its owner rather than by name — a credential that
 * belongs to a workspace row and must go with it. Sealed under the same data key,
 * so a master-key rotation leaves it readable. */
export async function sealValue(value: string, db: Db = openDb()): Promise<string> {
	return seal(value, await openOrCreateDataKey(db));
}

export async function openSealedValue(sealed: string, db: Db = openDb()): Promise<string> {
	const dataKey = await openDataKey(db);
	try {
		return unseal(sealed, dataKey);
	} catch {
		throw new SecretStoreError("corrupt", "a sealed value could not be decrypted");
	}
}

export async function unsetSecret(name: string, db: Db = openDb()): Promise<void> {
	await setGlobalSetting(secretKey(name), null, db);
}

export async function hasSecret(name: string, db: Db = openDb()): Promise<boolean> {
	return Boolean(await getGlobalSetting(secretKey(name), db));
}

export type MasterKeyState =
	| "ready" // key present, data key opens
	| "absent" // no key configured
	| "changed" // key present but no wrapping matches it
	| "uninitialized"; // key present, nothing stored yet

export interface SecretStoreStatus {
	state: MasterKeyState;
	/** True while a rotation has happened but no startup has proven the new key. */
	rotationPending: boolean;
	/** Fingerprint of the key in use, for display. Never the key. */
	fingerprint: string | null;
	/* Where the key came from. An operator who needs to back it up, or who is
	 * wondering why an edit did nothing, needs to know which one is in force. */
	source: MasterKeySource | null;
	/** Where a generated key is kept, so the surface can say so. */
	path: string;
}

/**
 * Reports the key WITHOUT creating one.
 *
 * Reading a settings page must not be what brings a key into existence: that
 * would make a `data/master.key` appear on a machine nobody configured anything
 * on, and make "is this set up?" a question that changes the answer by asking.
 * Generation happens on the first WRITE, where the operator has asked for
 * something to be stored.
 */
export async function secretStoreStatus(db: Db = openDb()): Promise<SecretStoreStatus> {
	const envelope = await readEnvelope(db);
	const rotationPending = Boolean(envelope?.pending);
	const path = masterKeyPath();
	const absent = {
		state: "absent" as const,
		rotationPending,
		fingerprint: null,
		source: null,
		path,
	};

	let key: Buffer | undefined;
	let source: MasterKeySource | null = null;
	try {
		key = masterKey();
		if (key) source = "env";
		else if (existsSync(path)) {
			key = decodeKey(readFileSync(path, "utf8"));
			source = "file";
		}
	} catch {
		// A malformed key is reported as absent for display; the write path still
		// throws with the specific parse error when it is used.
		return absent;
	}
	if (!key) return absent;

	const fingerprint = keyFingerprint(key);
	if (!envelope)
		return { state: "uninitialized", rotationPending: false, fingerprint, source, path };
	const matches = envelope.wrappings.some((w) => fingerprintsMatch(w.fingerprint, fingerprint));
	return { state: matches ? "ready" : "changed", rotationPending, fingerprint, source, path };
}

/** What a reset would destroy, so an operator can be told before they confirm. */
export interface UnreadableStorage {
	/** Stored secrets that the current master key cannot open. */
	secretCount: number;
}

export async function unreadableSecretStorage(db: Db = openDb()): Promise<UnreadableStorage> {
	const rows = await db.get<{ n: number }>(
		`SELECT COUNT(*) AS n FROM global_settings WHERE key LIKE ?1 || '%' AND key != ?1 || '__envelope'`,
		[SECRET_NAMESPACE],
	);
	return { secretCount: rows?.n ?? 0 };
}

/**
 * Discard encrypted storage that no available key can open, so the operator can
 * start again.
 *
 * WITHOUT THIS THERE IS NO WAY OUT. A lost or replaced master key leaves the
 * envelope unopenable, and every write fails against it — including the writes an
 * operator would make to "just re-enter the credentials", which is what the error
 * tells them to do. The store ends up bricked with a message describing a remedy
 * the product does not offer.
 *
 * Deliberately NOT automatic on a key mismatch. A mismatch is far more often a
 * misconfiguration than a loss — an environment variable that failed to load this
 * boot, a deploy that forgot to carry the key — and wiping on sight would destroy
 * secrets the correct key could still open. This runs only when an operator asks
 * for it, having been told what it costs.
 *
 * What it removes is already unreadable, so nothing recoverable is lost by it.
 */
export async function resetSecretStorage(db: Db = openDb()): Promise<UnreadableStorage> {
	// Read before the delete: on a pool the two need not run in issue order.
	const removed = await unreadableSecretStorage(db);
	await db.run(`DELETE FROM global_settings WHERE key LIKE ?1 || '%'`, [SECRET_NAMESPACE]);
	return removed;
}

export interface RotationResult {
	/* The new key, base64 — ONLY when the operator has to place it themselves.
	 * Absent when the key is kept in a file this app writes, because there is
	 * nothing for them to do with it. */
	key?: string;
	/** True while the rotation waits on a restart carrying the new key. */
	pending: boolean;
	/** Where the new key now lives. */
	source: MasterKeySource;
}

/**
 * Generate a new master key and re-wrap the data key under it.
 *
 * HOW THIS FINISHES DEPENDS ON WHERE THE KEY LIVES, because that decides whether
 * this process can put the new key where the next one will look.
 *
 * Key in a FILE (the default): the app writes both sides, so the rotation
 * completes here. Nothing is shown, nothing is confirmed, no restart is needed.
 * Ordered so a crash at any point leaves a key that opens the store — the new
 * wrapping is added before the file is replaced, and the old wrapping is dropped
 * only after.
 *
 * Key in the ENVIRONMENT: this process cannot write the environment. All it can
 * do is hand the operator a key and hope they place it, so the OLD key has to keep
 * working until a restart proves they did — otherwise a restart at the wrong
 * moment locks every stored secret. That is the only case the pending state
 * exists for.
 */
export async function rotateMasterKey(db: Db = openDb()): Promise<RotationResult> {
	const dataKey = await openOrCreateDataKey(db);
	const current = readOrCreateMasterKey();
	const envelope = (await readEnvelope(db)) ?? { wrappings: [] };

	const next = generateKey();
	const fingerprint = keyFingerprint(next);
	const wrapping = { fingerprint, wrapped: seal(dataKey.toString("base64"), next) };
	const others = envelope.wrappings.filter((w) => !fingerprintsMatch(w.fingerprint, fingerprint));

	if (current.source === "env") {
		await writeEnvelope({ wrappings: [...others, wrapping], pending: fingerprint }, db);
		return { key: encodeKey(next), pending: true, source: "env" };
	}

	// Both wrappings first, so a crash before the file is replaced leaves the old
	// key still opening the store.
	await writeEnvelope({ wrappings: [...others, wrapping] }, db);
	writeMasterKeyFile(next);
	// Only now is the old wrapping unnecessary.
	await writeEnvelope({ wrappings: [wrapping] }, db);
	return { pending: false, source: "file" };
}

/**
 * Abandon a rotation, keeping the key that is currently in force.
 *
 * A rotation completes only when the app restarts with the NEW key in its
 * environment. An operator who loses that key before saving it — closed the tab,
 * copied the wrong thing — can never complete it, and without this the surface
 * reports a pending rotation forever with no way to clear it.
 *
 * Safe by construction: it removes the wrapping nothing can open and keeps the
 * one the in-force key opens, so every stored secret stays readable. Refuses if
 * the current key is not among the wrappings, because then dropping the other one
 * would leave nothing that works.
 */
export async function cancelRotation(db: Db = openDb()): Promise<boolean> {
	const envelope = await readEnvelope(db);
	if (!envelope?.pending) return false;

	let key: Buffer | undefined;
	try {
		key = readMasterKey();
	} catch {
		return false;
	}
	if (!key) return false;

	const fingerprint = keyFingerprint(key);
	const keep = envelope.wrappings.filter((w) => fingerprintsMatch(w.fingerprint, fingerprint));
	// Never leave the store with no wrapping the available key can open.
	if (keep.length === 0) return false;

	await writeEnvelope({ wrappings: keep }, db);
	return true;
}

/**
 * Finish a rotation once the environment proves the new key was saved.
 *
 * Called at startup. When the key in the environment opens the data key and other
 * wrappings remain, those are dropped and the rotation is complete. Booting with
 * the OLD key is not a failure — it leaves the rotation pending and everything
 * readable, which is the whole reason both wrappings were kept.
 *
 * Returns true when a rotation was completed by this call.
 */
export async function completeRotationIfProven(db: Db = openDb()): Promise<boolean> {
	const envelope = await readEnvelope(db);
	if (!envelope?.pending) return false;
	let key: Buffer | undefined;
	try {
		key = readMasterKey();
	} catch {
		return false;
	}
	if (!key) return false;
	const fingerprint = keyFingerprint(key);
	// Only the key rotation produced counts. A different key that happens to open
	// the store is the key being rotated AWAY from, and treating it as proof would
	// discard the new wrapping the operator was told to save.
	if (!fingerprintsMatch(fingerprint, envelope.pending)) return false;
	const wrapping = envelope.wrappings.find((w) => fingerprintsMatch(w.fingerprint, fingerprint));
	if (!wrapping) return false;
	await writeEnvelope({ wrappings: [wrapping] }, db);
	return true;
}
