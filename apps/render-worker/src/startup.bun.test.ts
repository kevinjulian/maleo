import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("worker starts in its runtime directory after bundler restores cwd", async () => {
	const dir = await mkdtemp(join(tmpdir(), "maleo-render-startup-"));
	const entry = new URL("./index.ts", import.meta.url).pathname;
	try {
		const child = Bun.spawn(
			[
				process.execPath,
				"--eval",
				`
import { mock } from "bun:test";
const runtime = process.cwd();
Bun.serve = () => ({ port: 8091, stop() {} });
mock.module("@maleo/storage", () => ({
  assertMediaStorageConfigured() {},
  async verifyMediaStorageReady() {},
}));
mock.module(${JSON.stringify(new URL("./worker.ts", import.meta.url).pathname)}, () => ({
  async warmBundle() {
    process.chdir(${JSON.stringify(dir)});
    await Bun.sleep(30);
    process.chdir(runtime);
  },
  startWorker() {
    console.log(process.cwd() === runtime ? "runtime directory restored" : "wrong runtime directory");
    process.exit(process.cwd() === runtime ? 0 : 1);
  },
}));
await import(${JSON.stringify(entry)});
`,
			],
			{
				env: {
					...process.env,
					MALEO_VIDEO_DB: join(dir, "jobs.db"),
					MALEO_VIDEO_TOKEN: "startup-test-token",
				},
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const [stdout, stderr, code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
		expect(stdout).toContain("runtime directory restored");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
