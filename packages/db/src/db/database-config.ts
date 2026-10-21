/* Where the runtime database comes from, decided from the environment alone.
 *
 * Pure — it reads the environment it is handed — so the two rules it carries
 * are tested directly: production never starts without a database credential,
 * and a connection that leaves the host is encrypted. */
import { resolve } from "node:path";

export class DatabaseConfigError extends Error {
	override name = "DatabaseConfigError";
}

export type DatabaseConfig =
	| { kind: "url"; url: string; ssl: false | "require" | "verify-full" }
	| { kind: "embedded"; dir: string; port: number; ephemeral: boolean };

type Env = Record<string, string | undefined>;

export const DEFAULT_EMBEDDED_PORT = 54329;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const WEAK_TLS_MODES = new Set(["disable", "allow", "prefer"]);

function urlConfig(raw: string): DatabaseConfig {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		// The value may carry a password; name the variable, never the value.
		throw new DatabaseConfigError("MALEO_DATABASE_URL is not a valid connection URL");
	}
	const mode = url.searchParams.get("sslmode")?.toLowerCase();
	// A unix socket (empty host, or a host= path) never leaves the machine.
	const socket = url.hostname === "" || url.searchParams.get("host")?.startsWith("/");
	const local = socket || LOCAL_HOSTS.has(url.hostname);
	// The driver verifies a certificate only together with its hostname, so a
	// request to verify the CA is honoured by verifying both — stricter, never weaker.
	const verified = mode === "verify-ca" || mode === "verify-full";
	if (local) {
		return {
			kind: "url",
			url: raw,
			ssl: verified ? "verify-full" : mode === "require" ? "require" : false,
		};
	}
	if (mode && WEAK_TLS_MODES.has(mode)) {
		throw new DatabaseConfigError(
			`MALEO_DATABASE_URL names a database on another host with sslmode=${mode}; a connection that leaves the host must be encrypted`,
		);
	}
	return { kind: "url", url: raw, ssl: verified ? "verify-full" : "require" };
}

export function databaseConfig(env: Env = process.env): DatabaseConfig {
	const url = env.MALEO_DATABASE_URL?.trim();
	if (url) return urlConfig(url);
	if (env.NODE_ENV === "production") {
		throw new DatabaseConfigError(
			"MALEO_DATABASE_URL is not set; a production deployment connects to a managed Postgres and never starts an embedded one",
		);
	}
	const rawPort = env.MALEO_PG_PORT?.trim();
	const port = rawPort ? Number(rawPort) : DEFAULT_EMBEDDED_PORT;
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		throw new DatabaseConfigError(`MALEO_PG_PORT must be a TCP port, got "${rawPort}"`);
	}
	const dataDir = env.MALEO_DATA_DIR?.trim()
		? resolve(env.MALEO_DATA_DIR.trim())
		: resolve(import.meta.dirname, "../../../..", "data");
	return {
		kind: "embedded",
		dir: resolve(dataDir, "postgres"),
		port,
		ephemeral: env.MALEO_PG_EPHEMERAL === "1",
	};
}
