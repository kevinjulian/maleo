/* Offline cutover only. Never import this module from an application entrypoint. */
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { pgDb, type Db } from "../packages/db/src/db/handle.ts";
import { databaseConfig } from "../packages/db/src/db/database-config.ts";
import { createSql } from "../packages/db/src/db/pg.ts";
import { decodeKey, unseal } from "../packages/db/src/db/secret-crypto.ts";

const OLD = "AINCER_";
const NEW = "MALEO_";
const ENVELOPE = "secret.__envelope";
const fingerprint = (key: Buffer, brand: string): string =>
	createHash("sha256")
		.update(`${brand}:master-key-fingerprint:v1`)
		.update(key)
		.digest("base64url")
		.slice(0, 22);

export async function convertBrandState(
	db: Db,
	key?: Buffer,
): Promise<{ renamed: number; envelope: boolean }> {
	return db.transaction(async (tx) => {
		if (tx.dialect === "postgres")
			await tx.exec("LOCK TABLE global_settings IN ACCESS EXCLUSIVE MODE");
		const rows = await tx.all<{ key: string; value: string }>(
			"SELECT key, value FROM global_settings",
		);
		const workspaceSecrets = await tx.all<{ headers_sealed: string }>(
			"SELECT headers_sealed FROM mcp_servers WHERE headers_sealed IS NOT NULL",
		);
		const names = new Set(rows.map((row) => row.key));
		const source = rows.filter((row) => /^(config|secret)\.AINCER_[A-Z0-9_]+$/.test(row.key));
		if (rows.some((row) => /^(config|secret)\.AINCER_/.test(row.key) && !source.includes(row)))
			throw new Error("Unsupported setting name; no changes committed.");
		const current = rows.filter((row) => /^(config|secret)\.MALEO_[A-Z0-9_]+$/.test(row.key));
		if (source.length && current.length)
			throw new Error("Mixed configuration names: restore pre-cutover backup before retrying.");
		for (const row of source) {
			if (names.has(row.key.replace(OLD, NEW)))
				throw new Error("Destination setting already exists; no changes committed.");
		}
		const raw = rows.find((row) => row.key === ENVELOPE)?.value;
		let updated: string | undefined;
		if (raw) {
			if (!key) throw new Error("Existing master key is required; no changes committed.");
			let parsed: unknown;
			try {
				parsed = JSON.parse(raw);
			} catch {
				throw new Error("Malformed secret envelope; restore backup.");
			}
			if (
				!parsed ||
				typeof parsed !== "object" ||
				!("wrappings" in parsed) ||
				!Array.isArray(parsed.wrappings) ||
				parsed.wrappings.length !== 1 ||
				"pending" in parsed
			) {
				throw new Error(
					"Finish or abandon key rotation in prior release; envelope must have one wrapping and no pending rotation.",
				);
			}
			const wrapping: unknown = parsed.wrappings[0];
			if (
				!wrapping ||
				typeof wrapping !== "object" ||
				!("fingerprint" in wrapping) ||
				!("wrapped" in wrapping) ||
				typeof wrapping.fingerprint !== "string" ||
				typeof wrapping.wrapped !== "string"
			)
				throw new Error("Malformed secret envelope; restore backup.");
			const oldFingerprint = fingerprint(key, "aincer");
			const newFingerprint = fingerprint(key, "maleo");
			if (wrapping.fingerprint !== oldFingerprint && wrapping.fingerprint !== newFingerprint)
				throw new Error("Master key does not match stored envelope; no changes committed.");
			if (
				(source.length && wrapping.fingerprint === newFingerprint) ||
				(current.length && wrapping.fingerprint === oldFingerprint)
			)
				throw new Error("Mixed envelope and configuration names; restore pre-cutover backup.");
			try {
				const dataKey = decodeKey(unseal(wrapping.wrapped, key));
				for (const row of rows)
					if (row.key.startsWith("secret.") && row.key !== ENVELOPE) unseal(row.value, dataKey);
				for (const row of workspaceSecrets) unseal(row.headers_sealed, dataKey);
			} catch {
				throw new Error("Stored encryption could not be verified; no changes committed.");
			}
			if (wrapping.fingerprint === oldFingerprint)
				updated = JSON.stringify({
					...parsed,
					wrappings: [{ ...wrapping, fingerprint: newFingerprint }],
				});
		} else if (workspaceSecrets.length || rows.some((row) => row.key.startsWith("secret."))) {
			throw new Error("Encrypted settings have no envelope; restore backup.");
		}
		for (const row of source)
			await tx.run("UPDATE global_settings SET key = ? WHERE key = ?", [
				row.key.replace(OLD, NEW),
				row.key,
			]);
		if (updated)
			await tx.run("UPDATE global_settings SET value = ? WHERE key = ?", [updated, ENVELOPE]);
		return { renamed: source.length, envelope: updated !== undefined };
	});
}

if (import.meta.main) {
	const { values } = parseArgs({
		options: { "services-stopped": { type: "boolean" }, "backup-confirmed": { type: "boolean" } },
		strict: true,
	});
	if (!values["services-stopped"] || !values["backup-confirmed"])
		throw new Error(
			"Stop application services and back up state; pass --services-stopped --backup-confirmed.",
		);
	const config = databaseConfig({ ...process.env, NODE_ENV: "production" });
	if (config.kind !== "url") throw new Error("Set MALEO_DATABASE_URL to explicit cutover target.");
	const sql = createSql(config.url, { max: 1, ssl: config.ssl });
	try {
		const [active] = await sql<
			{ count: number }[]
		>`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend'`;
		if (active?.count)
			throw new Error("Other database clients are connected; stop all application services.");
		const raw = process.env.MALEO_MASTER_KEY;
		console.log(
			JSON.stringify(await convertBrandState(pgDb(sql), raw ? decodeKey(raw) : undefined)),
		);
	} catch {
		console.error(
			"Cutover failed; no conversion committed. Verify backup, key, configuration conflicts and rotation state.",
		);
		process.exitCode = 1;
	} finally {
		await sql.end();
	}
}
