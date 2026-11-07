#!/usr/bin/env bun
/* A stand-in for `maleo-render` in worker tests: the same commands, stdout lines
 * and exit codes (crates/render-host/src/progress.rs), with the behaviour chosen
 * by FAKE_HOST_MODE: ok, fail, refuse, slow (renders until SIGTERM).
 * `plan` and `compare-frames` run FAKE_HOST_REAL, the built `maleo-render`.
 * `media` prints FAKE_HOST_MEDIA (a JSON array); `coverage` prints FAKE_HOST_COVERAGE.
 * `render` records the job it received at FAKE_HOST_RECORD and copies
 * FAKE_HOST_OUTPUT to the job's `out`. */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const [command, , jobPath] = process.argv.slice(2);
// The comparison commands are the real host's when FAKE_HOST_REAL names it.
if (command === "plan" || command === "compare-frames") {
	const real = process.env.FAKE_HOST_REAL;
	if (!real || !existsSync(real)) {
		process.stdout.write(
			`${JSON.stringify({ failed: `${command}: no real host`, stage: "arguments" })}\n`,
		);
		process.exit(1);
	}
	const result = spawnSync(real, process.argv.slice(2), { stdio: "inherit" });
	process.exit(result.status ?? 1);
}
const job = JSON.parse(readFileSync(jobPath!, "utf8")) as {
	frames: number;
	out: string;
	media: Record<string, string>;
};
const say = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);

if (command === "media") {
	say(JSON.parse(process.env.FAKE_HOST_MEDIA ?? "[]"));
	process.exit(0);
}
if (command === "coverage") {
	say(JSON.parse(process.env.FAKE_HOST_COVERAGE ?? "[]"));
	process.exit(0);
}
if (process.env.FAKE_HOST_RECORD) writeFileSync(process.env.FAKE_HOST_RECORD, JSON.stringify(job));
const mode = process.env.FAKE_HOST_MODE ?? "ok";
if (mode === "refuse") {
	say({
		refused: "frame 3 cannot be exported: textOverlays[0] `lower-third` preset",
		coverage: [],
	});
	process.exit(2);
}
for (const path of Object.values(job.media))
	if (!existsSync(path)) {
		say({ failed: `media: ${path} is missing`, stage: "media" });
		process.exit(1);
	}
say({ phase: "loading" });
say({ phase: "mixing" });
if (mode === "slow") {
	process.on("SIGTERM", () => {
		say({ cancelled: true });
		process.exit(143);
	});
	let frame = 0;
	setInterval(() => say({ phase: "rendering", frame: ++frame, frames: 100000 }), 20);
} else {
	for (let frame = 1; frame <= job.frames; frame++)
		say({ phase: "rendering", frame, frames: job.frames });
	if (mode === "fail") {
		say({ failed: "encode: encoder stopped reading", stage: "encode" });
		process.exit(1);
	}
	say({ phase: "finishing" });
	copyFileSync(process.env.FAKE_HOST_OUTPUT!, job.out);
	say({ done: true, frames: job.frames });
	process.exit(0);
}
