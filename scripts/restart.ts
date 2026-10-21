#!/usr/bin/env bun
/* Restart the local dev stack: stop what this repo is running, then `bun run dev`.
 *
 * `--hot` reload does not survive every kind of edit — a changed module graph, a
 * renamed export, a route added after boot — and a half-reloaded server reports
 * failures that the code no longer contains. Restarting by hand means finding
 * several processes across several terminals; this does it in one command.
 *
 * THE SCOPING RULE: a process is killed only when its working directory is inside
 * THIS repository. Port numbers alone are not enough — 3000 and 3030 are the most
 * borrowed ports there are, and another project's server sitting on one is not
 * ours to stop. Every candidate is confirmed by its cwd before it is signalled,
 * and a candidate whose cwd cannot be read is left alone. */
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(import.meta.dir));

/* The ports the dev stack listens on, from the same env vars the package scripts
 * read so a customised port is still found. Remotion studio (3000) and the
 * Inngest dev server (8288) have no env var of their own. */
function port(name: string, fallback: number): number {
	const value = Number(process.env[name]?.trim());
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

const PORTS = [
	port("MALEO_API_PORT", 8090),
	port("MALEO_WEB_PORT", 3030),
	port("MALEO_VIDEO_PORT", 8091),
	port("MALEO_MEDIA_WORKER_PORT", 7071),
	3000, // remotion studio
	8288, // inngest dev
];

async function run(cmd: string[]): Promise<string> {
	const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" });
	const out = await new Response(proc.stdout).text();
	await proc.exited;
	return out;
}

async function pidsListeningOn(tcpPort: number): Promise<number[]> {
	const out = await run(["lsof", "-ti", `tcp:${tcpPort}`, "-sTCP:LISTEN"]);
	return out
		.split("\n")
		.map((line) => Number(line.trim()))
		.filter((pid) => Number.isFinite(pid) && pid > 0);
}

/** Processes whose command line names this repo — the `scripts/dev.ts`
 *  orchestrator, and anything started with an absolute path into the tree. */
async function pidsNamingRepo(): Promise<number[]> {
	const out = await run(["pgrep", "-f", ROOT]);
	return out
		.split("\n")
		.map((line) => Number(line.trim()))
		.filter((pid) => Number.isFinite(pid) && pid > 0);
}

/* A process's working directory, via lsof's field output. Returns undefined when
 * it cannot be read — a process we cannot place is a process we do not kill. */
async function cwdOf(pid: number): Promise<string | undefined> {
	const out = await run(["lsof", "-a", "-d", "cwd", "-p", String(pid), "-Fn"]);
	const line = out.split("\n").find((entry) => entry.startsWith("n"));
	return line?.slice(1) || undefined;
}

async function commandOf(pid: number): Promise<string> {
	const out = await run(["ps", "-o", "command=", "-p", String(pid)]);
	return out.trim().split("\n")[0] ?? "";
}

function inRepo(path: string | undefined): boolean {
	return Boolean(path && (path === ROOT || path.startsWith(`${ROOT}/`)));
}

// Never signal this script, the shell that launched it, or their ancestors.
const SELF = new Set<number>([process.pid, process.ppid]);

async function targets(): Promise<Array<{ pid: number; command: string }>> {
	const candidates = new Set<number>();
	for (const tcpPort of PORTS)
		for (const pid of await pidsListeningOn(tcpPort)) candidates.add(pid);
	for (const pid of await pidsNamingRepo()) candidates.add(pid);

	const found: Array<{ pid: number; command: string }> = [];
	for (const pid of candidates) {
		if (SELF.has(pid)) continue;
		if (!inRepo(await cwdOf(pid))) continue;
		found.push({ pid, command: (await commandOf(pid)).slice(0, 90) });
	}
	return found;
}

const dryRun = process.argv.includes("--dry-run");
const found = await targets();

if (found.length === 0) {
	console.log("[restart] nothing of this repo's is running.");
} else {
	console.log(`[restart] stopping ${found.length} process(es) in ${ROOT}:`);
	for (const { pid, command } of found) console.log(`  ${String(pid).padStart(6)}  ${command}`);
	if (dryRun) {
		console.log("[restart] --dry-run: nothing was signalled.");
		process.exit(0);
	}
	for (const { pid } of found) {
		try {
			process.kill(pid, "SIGTERM");
		} catch {
			/* already gone */
		}
	}
	// Give them a moment to close their ports, then insist.
	await Bun.sleep(2000);
	const survivors = await targets();
	for (const { pid } of survivors) {
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			/* already gone */
		}
	}
	if (survivors.length) await Bun.sleep(500);
}

if (dryRun) process.exit(0);

console.log("[restart] starting the dev stack…\n");
const dev = Bun.spawn(["bun", "run", "dev"], {
	cwd: ROOT,
	stdio: ["inherit", "inherit", "inherit"],
});
// Hand Ctrl-C straight through: `scripts/dev.ts` owns shutting its own children down.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		try {
			dev.kill(signal);
		} catch {
			/* already gone */
		}
	});
}
process.exit(await dev.exited);
