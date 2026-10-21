import { spawn } from "node:child_process";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";

// Native output assertions belong to the normal package/CI gate, not only manual proof.
/* One at a time: two proofs started together both bound Remotion's first free
 * port (3000) and one was reset (2026-10-09). A muted-audio failure seen in the
 * same runs was not concurrency but the proofs' own measurement under load; see
 * scripts/pcm.ts. */
for (const script of [
	"prove-source-crop.ts",
	"prove-reversed-media.ts",
	"prove-retimed-audio.ts",
	"prove-clip-animation.ts",
	"prove-clip-compositing.ts",
]) {
	test(`production pixels and audio support ${script}`, async () => {
		// The proofs are Bun programs, the runtime that renders in production.
		const child = spawn("bun", [join(import.meta.dirname, "../scripts", script)], {
			stdio: "inherit",
		});
		expect(await new Promise((done) => child.on("close", done))).toBe(0);
	}, 180_000);
}
