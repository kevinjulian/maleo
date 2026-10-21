/* Where the runtime database comes from, decided from the environment alone.
 *
 * Two requirements live here: production refuses to start without a database
 * credential rather than inventing a local one, and a connection that leaves the
 * host is encrypted. */
import { describe, expect, test } from "vite-plus/test";
import { databaseConfig, DatabaseConfigError } from "../../src/db/database-config.ts";

const prod = (extra: Record<string, string> = {}) => ({ NODE_ENV: "production", ...extra });

describe("a production deployment", () => {
	test("refuses to start without a database credential, naming it", () => {
		expect(() => databaseConfig(prod())).toThrow(DatabaseConfigError);
		expect(() => databaseConfig(prod())).toThrow(/MALEO_DATABASE_URL/);
	});

	test("never falls back to an embedded server", () => {
		expect(() => databaseConfig(prod({ MALEO_DATABASE_URL: "  " }))).toThrow(/MALEO_DATABASE_URL/);
	});

	test("an off-host database is reached over TLS", () => {
		expect(
			databaseConfig(prod({ MALEO_DATABASE_URL: "postgres://u:p@example.com:5432/maleo" })),
		).toEqual({ kind: "url", url: "postgres://u:p@example.com:5432/maleo", ssl: "require" });
	});

	test("an off-host database that asks for no TLS is refused", () => {
		for (const mode of ["disable", "allow", "prefer"]) {
			expect(() =>
				databaseConfig(
					prod({ MALEO_DATABASE_URL: `postgres://u:p@example.com/maleo?sslmode=${mode}` }),
				),
			).toThrow(/encrypted/);
		}
	});

	test("a database on this host may be reached without TLS", () => {
		for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
			expect(
				databaseConfig(prod({ MALEO_DATABASE_URL: `postgres://u:p@${host}:5432/maleo` })),
			).toMatchObject({ kind: "url", ssl: false });
		}
	});

	test("a stricter TLS mode in the URL is kept", () => {
		expect(
			databaseConfig(
				prod({ MALEO_DATABASE_URL: "postgres://u:p@example.com/maleo?sslmode=verify-full" }),
			),
		).toMatchObject({ ssl: "verify-full" });
	});

	test("a malformed URL is refused naming the variable, not echoing the credential", () => {
		let message = "";
		try {
			databaseConfig(prod({ MALEO_DATABASE_URL: "not a url secret-password" }));
		} catch (e) {
			message = String(e);
		}
		expect(message).toContain("MALEO_DATABASE_URL");
		expect(message).not.toContain("secret-password");
	});
});

describe("development", () => {
	test("with nothing configured, runs an embedded server in the data directory", () => {
		expect(databaseConfig({ MALEO_DATA_DIR: "/tmp/maleo-data" })).toEqual({
			kind: "embedded",
			dir: "/tmp/maleo-data/postgres",
			port: 54329,
			ephemeral: false,
		});
	});

	test("an external database is used when configured, by configuration alone", () => {
		expect(
			databaseConfig({ MALEO_DATABASE_URL: "postgres://u:p@localhost:5433/dev" }),
		).toMatchObject({ kind: "url" });
	});

	test("the embedded port and a throwaway cluster are configurable", () => {
		expect(
			databaseConfig({ MALEO_DATA_DIR: "/d", MALEO_PG_PORT: "55000", MALEO_PG_EPHEMERAL: "1" }),
		).toEqual({ kind: "embedded", dir: "/d/postgres", port: 55000, ephemeral: true });
	});

	test("a port that is not a port is refused", () => {
		expect(() => databaseConfig({ MALEO_PG_PORT: "nope" })).toThrow(/MALEO_PG_PORT/);
	});
});
