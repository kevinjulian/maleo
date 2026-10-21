/* A process handed to `stopWithThisProcess` must not outlive its owner, even when
 * the owner is SIGKILLed — which is how `vp run` stops sibling suites after a
 * failure, so no `afterAll` or exit hook gets to clean up. */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { expect, test } from "vite-plus/test";

const alive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

test("a handed-over process stops after its owner is SIGKILLed", async () => {
	const module = join(import.meta.dirname, "../../src/db/pg-embedded.ts");
	// The owner is a Bun process: the Bun suites are the ones that hand servers over.
	const owner = spawn(
		"bun",
		[
			"-e",
			`import { spawn } from "node:child_process";
			import { stopWithThisProcess } from ${JSON.stringify(module)};
			const child = spawn("sleep", ["60"], { stdio: "ignore" });
			stopWithThisProcess(child.pid);
			console.log(child.pid);
			setInterval(() => {}, 1000);`,
		],
		{ stdio: ["ignore", "pipe", "inherit"] },
	);
	const [chunk] = (await once(owner.stdout, "data")) as [Buffer];
	const server = Number(chunk.toString().trim());
	expect(alive(server)).toBe(true);

	owner.kill("SIGKILL");
	await once(owner, "close");
	const deadline = Date.now() + 5_000;
	while (alive(server) && Date.now() < deadline) await sleep(100);
	expect(alive(server)).toBe(false);
}, 10_000);
