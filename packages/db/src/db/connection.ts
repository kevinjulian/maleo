/* The runtime database connection — one file opens it, migrates it, and hands
 * it out.
 *
 * Postgres everywhere. `database-config.ts` decides where it is: a managed
 * database named by MALEO_DATABASE_URL (required in production), or an
 * embedded server in the data directory for development. Before the first
 * query every pending migration runs; a migration that fails leaves every query
 * rejecting with that failure, so a partially migrated database is never
 * served. The shipped library fixtures are then written once per process.
 *
 * Nothing here creates a table or adds a column: the migration sequence owns
 * the schema — see packages/db/tests/unit/schema-ownership.bun.test.ts. */
import { databaseConfig, type DatabaseConfig } from "./database-config.ts";
import { gated, pgDb, type Db, type Param } from "./handle.ts";
import { bootstrapLibraryFixtures } from "./library-fixtures.ts";
import { loadMigrations, migrate } from "./migrate.ts";
import { createSql, type Sql } from "./pg.ts";
import { startEmbeddedPostgres, type EmbeddedServer } from "./pg-embedded.ts";

const EMBEDDED_DATABASE = "maleo";

interface Connection {
	sql: Sql;
	release(): Promise<void>;
}

interface Runtime {
	db: Db;
	connection: Promise<Connection>;
	ready: Promise<void>;
}

let runtime: Runtime | null = null;
let generation = 0;
let embedded: Promise<EmbeddedServer> | null = null;

/* One embedded server per process. A development server another process of ours
 * already started on the same port is joined rather than fought over: the data
 * directory admits one postmaster. */
async function embeddedServer(
	config: Extract<DatabaseConfig, { kind: "embedded" }>,
): Promise<EmbeddedServer> {
	embedded ??= (async () => {
		const running = createSql(`postgres://maleo:maleo@127.0.0.1:${config.port}/postgres`, {
			max: 1,
		});
		try {
			await running.unsafe("SELECT 1");
			return {
				url: (database: string) => `postgres://maleo:maleo@127.0.0.1:${config.port}/${database}`,
				stop: async () => {},
			};
		} catch {
			return startEmbeddedPostgres({ dir: config.dir, port: config.port });
		} finally {
			await running.end();
		}
	})();
	return embedded;
}

async function connect(config: DatabaseConfig): Promise<Connection> {
	if (config.kind === "url") {
		const sql = createSql(config.url, { ssl: config.ssl });
		return { sql, release: () => sql.end() };
	}
	if (config.ephemeral) {
		/* A throwaway cluster: every open is a fresh database cloned from the
		 * migrated template, which is what the test preload selects. */
		const { createTestDatabase } = await import("./pg-testing.ts");
		const database = await createTestDatabase();
		return { sql: database.sql, release: database.drop };
	}
	const server = await embeddedServer(config);
	const admin = createSql(server.url("postgres"), { max: 1 });
	try {
		const [exists] = await admin.unsafe(`SELECT 1 FROM pg_database WHERE datname = $1`, [
			EMBEDDED_DATABASE,
		]);
		if (!exists) await admin.unsafe(`CREATE DATABASE ${EMBEDDED_DATABASE}`);
	} finally {
		await admin.end();
	}
	const sql = createSql(server.url(EMBEDDED_DATABASE));
	return { sql, release: () => sql.end() };
}

/** A handle that waits for the connection, then behaves as `pgDb` over it. */
function deferred(connection: Promise<Connection>): Db {
	const db = async (): Promise<Db> => pgDb((await connection).sql);
	return {
		dialect: "postgres",
		all: async <T>(text: string, params?: readonly Param[]) => (await db()).all<T>(text, params),
		get: async <T>(text: string, params?: readonly Param[]) => (await db()).get<T>(text, params),
		run: async (text, params) => (await db()).run(text, params),
		exec: async (text) => (await db()).exec(text),
		transaction: async (fn) => (await db()).transaction(fn),
	};
}

function open(): Runtime {
	const connection = (async () => {
		const opened = await connect(databaseConfig());
		await migrate(opened.sql, loadMigrations());
		return opened;
	})();
	/* Shipped Materials, Video Templates and Project Presets become rows here,
	 * found and rewritten by immutable slug, once per process rather than inside
	 * every library read. A database that cannot bootstrap its fixtures is still
	 * worth serving: the rows it has keep resolving, and the next process retries.
	 * A migration failure is not swallowed: it rejects `ready` and every query.
	 * The one-time SQLite carry-over turns it off: it must copy the old fixture
	 * rows first, which the next start then finds by slug. */
	const ready = connection.then(async (c) => {
		if (process.env.MALEO_BOOTSTRAP_FIXTURES === "0") return;
		await bootstrapLibraryFixtures(pgDb(c.sql)).catch(() => {});
	});
	// Observed here so an unused runtime never reports an unhandled rejection;
	// every caller awaiting it still receives the failure.
	connection.catch(() => {});
	ready.catch(() => {});
	return { db: gated(deferred(connection), ready), connection, ready };
}

/** Changes whenever the runtime is closed, for anything that must follow it. */
export function runtimeGeneration(): number {
	return generation;
}

/** The runtime handle. Every family module defaults to it. */
export function openDb(): Db {
	runtime ??= open();
	return runtime.db;
}

/** Resolves once the database is migrated and bootstrapped; rejects with the
 *  reason it cannot be served. The API awaits this before it listens. */
export async function databaseReady(): Promise<void> {
	runtime ??= open();
	await runtime.ready;
}

/** The underlying pool, for the one library that speaks to Postgres itself. */
export async function runtimeSql(): Promise<Sql> {
	runtime ??= open();
	await runtime.ready;
	return (await runtime.connection).sql;
}

/** The runtime database's connection URL, for a library that opens its own pool
 *  (Mastra's execution store). A throwaway test cluster has none to share. */
export async function runtimeDatabaseUrl(): Promise<string> {
	const config = databaseConfig();
	if (config.kind === "url") return config.url;
	if (config.ephemeral) throw new Error("a throwaway test database has no shared connection URL");
	return (await embeddedServer(config)).url(EMBEDDED_DATABASE);
}

/** Close the runtime pool; the next `openDb` opens a new one. In an ephemeral
 *  cluster that is a fresh database, which is how a test starts clean. */
export async function closeMaleoDb(): Promise<void> {
	const current = runtime;
	runtime = null;
	generation += 1;
	if (!current) return;
	const connection = await current.connection.catch(() => null);
	await connection?.release();
}
