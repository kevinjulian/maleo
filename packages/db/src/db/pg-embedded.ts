/* A real Postgres server started from binaries in node_modules, for development
 * and tests only. Production connects to a managed Postgres through
 * MALEO_DATABASE_URL and never loads this module.
 *
 * It is the same engine and the same wire protocol as production, reached
 * through the same driver — see the migrate-to-postgres design for why PGlite
 * was rejected. Two operational facts from the spike live here:
 *
 *   - the platform package hydrates its library symlinks in a postinstall, which
 *     is why the root package.json lists it under trustedDependencies;
 *   - initdb refuses to run as root, so a container using this runs as a
 *     non-root user.
 *
 * The postmaster is a separate process and outlives ours unless something stops
 * it. The library's own exit hook is async and does not run under `bun test` —
 * the spike left an orphan per test run — and nothing in-process survives a
 * SIGKILL. So a detached watchdog shell waits for this process to disappear,
 * however it went, and then stops the server. */
import EmbeddedPostgres from "embedded-postgres";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/* Local-only credentials. The server listens on localhost, and these never
 * leave the machine that runs it. */
const USER = "maleo";
const PASSWORD = "maleo";

export interface EmbeddedServer {
	/** Connection URL for one database on this server. */
	url(database: string): string;
	stop(): Promise<void>;
}

export interface EmbeddedOptions {
	dir: string;
	port: number;
	/** Delete the data directory when stopped. Tests set this; development does not. */
	ephemeral?: boolean;
}

export async function startEmbeddedPostgres(options: EmbeddedOptions): Promise<EmbeddedServer> {
	const server = new EmbeddedPostgres({
		databaseDir: options.dir,
		port: options.port,
		user: USER,
		password: PASSWORD,
		persistent: !options.ephemeral,
		onLog: () => {},
		onError: () => {},
	});
	// initdb on an existing cluster fails; a development server is reused across starts.
	if (!existsSync(join(options.dir, "PG_VERSION"))) await server.initialise();
	await server.start();
	watchOwner(options.dir, Boolean(options.ephemeral));
	return {
		url: (database) => `postgres://${USER}:${PASSWORD}@127.0.0.1:${options.port}/${database}`,
		stop: () => server.stop(),
	};
}

/* SIGQUIT is Postgres' immediate shutdown: nothing here is worth a checkpoint
 * once its owner is gone. `dir` is a path this module created or was configured
 * with, never user input. */
function watchOwner(dir: string, removeDir: boolean): void {
	const postmaster = Number(readFileSync(join(dir, "postmaster.pid"), "utf8").split("\n")[0]);
	stopWithThisProcess(postmaster, "QUIT", removeDir ? `sleep 1; rm -rf '${dir}'` : "");
}

/** Signal `pid` once this process is gone, however it went — including a
 * SIGKILL, after which no exit hook or `afterAll` runs. `vp run` SIGKILLs the
 * suites still running when one fails, so a test that spawns a long-lived
 * server hands it to this rather than relying on its own teardown. The watchdog
 * also exits once `pid` does. `then` is a fixed shell command, never input. */
export function stopWithThisProcess(pid: number, signal = "TERM", then = ""): void {
	spawn(
		"sh",
		[
			"-c",
			`while kill -0 ${process.pid} 2>/dev/null && kill -0 ${pid} 2>/dev/null; do sleep 1; done; kill -${signal} ${pid} 2>/dev/null${then ? `; ${then}` : ""}`,
		],
		{ detached: true, stdio: "ignore" },
	).unref();
}

/** A port nothing is listening on right now. */
export function freePort(): number {
	const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
	const port = probe.port;
	probe.stop(true);
	return port;
}
