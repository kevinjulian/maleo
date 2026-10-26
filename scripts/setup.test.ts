import { spawn, spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";

const root = join(import.meta.dirname, "..");
const fixture = mkdtempSync(join(tmpdir(), "maleo-setup-test-"));

/* Measured uncontended on an M-series laptop: archive+extract 1.3s, fixture install
 * 9.3s, first setup (embedded Postgres, migrations, VUI build) 10.8s, the two reruns
 * 0.5s. All of it is disk-bound and slows together when the gate runs other suites,
 * so the budget is ~5x that and the test owns it: an overrun fails with each step's
 * time, naming the slow one, instead of a bare runner timeout. */
const BUDGET_MS = 120_000;

/* The fixture holds a full `bun install`; deleting it took 5s of a busy disk. It is
 * removed in a detached process after the test, so cleanup never counts against an
 * assertion that already passed. */
test(
	"setup creates, migrates, and preserves local state; missing Inngest fails",
	async () => {
		const started = performance.now();
		const timings: string[] = [];
		const step = <T>(name: string, run: () => T): T => {
			const at = performance.now();
			try {
				return run();
			} finally {
				timings.push(`${name} ${Math.round(performance.now() - at)}ms`);
			}
		};
		try {
			mkdirSync(join(fixture, "scripts"));
			const archive = join(fixture, "source.tar");
			step("archive", () => {
				expect(
					spawnSync("git", ["archive", "--output", archive, "HEAD"], { cwd: root }).status,
				).toBe(0);
				expect(spawnSync("tar", ["-xf", archive, "-C", fixture]).status).toBe(0);
			});
			copyFileSync(join(root, "scripts", "setup.ts"), join(fixture, "scripts", "setup.ts"));
			for (const name of ["package.json", "bun.lock", "vite.config.ts"])
				copyFileSync(join(root, name), join(fixture, name));
			copyFileSync(join(root, "apps/web/package.json"), join(fixture, "apps/web/package.json"));
			// Exercise the working tree together: renamed manifests cannot use archived imports.
			const modified = spawnSync("git", ["diff", "--name-only", "-z", "HEAD"], {
				cwd: root,
				encoding: "utf8",
			});
			expect(modified.status).toBe(0);
			const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
				cwd: root,
				encoding: "utf8",
			});
			expect(untracked.status).toBe(0);
			for (const name of `${modified.stdout}\0${untracked.stdout}`.split("\0").filter(Boolean)) {
				const target = join(fixture, name);
				if (!existsSync(join(root, name))) rmSync(target, { force: true });
				else {
					mkdirSync(join(target, ".."), { recursive: true });
					copyFileSync(join(root, name), target);
				}
			}
			const install = step("install", () =>
				spawnSync("bun", ["install", "--frozen-lockfile"], { cwd: fixture, encoding: "utf8" }),
			);
			if (install.status !== 0) throw new Error(`${install.stdout}\n${install.stderr}`);
			const listener = createServer();
			const port = await new Promise<number>((done) =>
				listener.listen(0, "127.0.0.1", () => done((listener.address() as { port: number }).port)),
			);
			await new Promise((done) => listener.close(done));
			const env = {
				...process.env,
				MALEO_DATA_DIR: join(fixture, "data"),
				MALEO_PG_PORT: String(port),
				MALEO_DATABASE_URL: "",
				MALEO_PG_EPHEMERAL: "0",
				OPENAI_API_KEY: "",
				ELEVENLABS_API_KEY: "",
				MALEO_GEN_WORKER_URL: "",
			};
			const run = (name: string) =>
				step(name, () =>
					spawnSync("bun", ["scripts/setup.ts"], { cwd: fixture, env, encoding: "utf8" }),
				);
			const first = run("setup");
			if (first.status !== 0) throw new Error(`${first.stdout}\n${first.stderr}`);
			expect(first.status).toBe(0);
			expect(existsSync(join(fixture, ".env"))).toBe(true);
			expect(existsSync(join(fixture, "data", "postgres", "PG_VERSION"))).toBe(true);
			expect(first.stdout).toContain("OPENAI_API_KEY not set");

			writeFileSync(join(fixture, ".env"), "MY_LOCAL_SECRET=preserve\n", { flag: "a" });
			writeFileSync(join(fixture, "data", "keep.txt"), "preserve");
			const second = run("rerun");
			expect(second.status).toBe(0);
			expect(readFileSync(join(fixture, ".env"), "utf8")).toContain("MY_LOCAL_SECRET=preserve");
			expect(readFileSync(join(fixture, "data", "keep.txt"), "utf8")).toBe("preserve");

			rmSync(join(fixture, "node_modules", ".bin", "inngest"));
			const missing = run("missing-inngest");
			expect(missing.status).toBe(1);
			expect(missing.stderr).toContain("Inngest CLI missing");
			const elapsed = Math.round(performance.now() - started);
			if (elapsed > BUDGET_MS)
				throw new Error(`setup test took ${elapsed}ms, budget ${BUDGET_MS}ms`);
		} catch (error) {
			throw new Error(
				`${error instanceof Error ? error.message : String(error)}\nstep timings: ${timings.join(", ")}`,
			);
		} finally {
			spawn("rm", ["-rf", fixture], { detached: true, stdio: "ignore" }).unref();
		}
		/* The runner's limit sits above the budget so the budget check, with its
		 * timings, is what reports an overrun. */
	},
	BUDGET_MS + 60_000,
);
