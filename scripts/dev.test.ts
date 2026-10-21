import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, expect, test } from "vite-plus/test";

const root = mkdtempSync(join(tmpdir(), "maleo-dev-test-"));
mkdirSync(join(root, "scripts"));
copyFileSync(join(import.meta.dirname, "dev.ts"), join(root, "scripts", "dev.ts"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const listening = (server: Server | ReturnType<typeof createNetServer>): Promise<number> =>
	new Promise((done) =>
		server.listen(0, "127.0.0.1", () => done((server.address() as { port: number }).port)),
	);

test("dev fails fast when required Inngest CLI is missing", () => {
	const run = spawnSync("bun", ["scripts/dev.ts", "--only=inngest"], {
		cwd: root,
		env: { ...process.env, MALEO_GEN_WORKER_URL: "" },
		encoding: "utf8",
	});
	expect(run.status).toBe(1);
	expect(run.stderr).toContain("Inngest CLI missing");
	expect(run.stderr).toContain("bun install --frozen-lockfile");
});

test("dev web uses the selected API port when no API URL is configured", async () => {
	const backend = createServer((_, response) => response.end("custom-port-ok"));
	const backendPort = await listening(backend);
	const probe = createNetServer();
	const webPort = await listening(probe);
	await new Promise((done) => probe.close(done));
	const child = spawn("bun", ["scripts/dev.ts", "--only=web"], {
		cwd: join(import.meta.dirname, ".."),
		stdio: ["ignore", "pipe", "pipe"],
		env: {
			...process.env,
			MALEO_API_PORT: String(backendPort),
			MALEO_WEB_PORT: String(webPort),
			MALEO_API_URL: "",
			MALEO_API_URLS: "",
			MALEO_GEN_WORKER_URL: "",
		},
	});
	const exited = new Promise((done) => child.on("close", done));
	try {
		let response: Response | undefined;
		for (let attempt = 0; attempt < 100; attempt++) {
			try {
				response = await fetch(`http://127.0.0.1:${webPort}/api/proxy-check`);
				break;
			} catch {
				await sleep(100);
			}
		}
		expect(await response?.text()).toBe("custom-port-ok");
	} finally {
		child.kill();
		await exited;
		backend.close();
	}
}, 20_000);
