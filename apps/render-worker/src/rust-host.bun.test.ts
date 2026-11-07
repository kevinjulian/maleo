import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	HostCancelled,
	HostFailed,
	HostRefused,
	hostCoverage,
	hostMediaUrls,
	hostRender,
	writeHostJob,
} from "./rust-host";

const FAKE = ["bun", join(import.meta.dir, "..", "tests", "fixtures", "fake-render-host.ts")];
let dir: string | null = null;
const env = { ...process.env };
afterEach(async () => {
	for (const key of Object.keys(process.env))
		if (key.startsWith("FAKE_HOST_")) delete process.env[key];
	Object.assign(process.env, env);
	if (dir) await rm(dir, { recursive: true, force: true });
});

async function job(frames = 5): Promise<{ file: string; out: string }> {
	dir = await mkdtemp(join(tmpdir(), "maleo-rust-host-"));
	const out = join(dir, "out.mp4");
	const file = await writeHostJob(join(dir, "job.json"), {
		storyboard: { scenes: [] },
		media: {},
		width: 1080,
		height: 1920,
		fps: 30,
		frames,
		out,
	});
	return { file, out };
}

test("render reports phases and frames, then the file is at out", async () => {
	const { file, out } = await job(4);
	const output = join(dir!, "fixture.mp4");
	await writeFile(output, "mp4");
	process.env.FAKE_HOST_OUTPUT = output;
	const phases: string[] = [];
	const frames: number[] = [];
	await hostRender(file, {
		command: FAKE,
		onPhase: (p) => phases.push(p),
		onFrame: (f, n) => frames.push(f / n),
	});
	expect(phases).toEqual(["loading", "mixing", "finishing"]);
	expect(frames).toEqual([0.25, 0.5, 0.75, 1]);
	expect(await Bun.file(out).text()).toBe("mp4");
});

test("exit codes become typed outcomes", async () => {
	const { file } = await job();
	process.env.FAKE_HOST_MODE = "refuse";
	await expect(hostRender(file, { command: FAKE })).rejects.toBeInstanceOf(HostRefused);
	process.env.FAKE_HOST_MODE = "fail";
	const failed = await hostRender(file, { command: FAKE }).catch((error: unknown) => error);
	expect(failed).toBeInstanceOf(HostFailed);
	expect((failed as HostFailed).stage).toBe("encode");
	expect((failed as Error).message).toBe("render host failed at encode: encoder stopped reading");
	await expect(hostRender(file, { command: ["/no/such/maleo-render"] })).rejects.toThrow();
});

test("cancel sends SIGTERM and the run ends as cancelled", async () => {
	const { file } = await job();
	process.env.FAKE_HOST_MODE = "slow";
	let seen = 0;
	const started = Date.now();
	await expect(
		hostRender(file, {
			command: FAKE,
			pollMs: 50,
			onFrame: () => seen++,
			cancelled: () => seen >= 5,
		}),
	).rejects.toBeInstanceOf(HostCancelled);
	expect(Date.now() - started).toBeLessThan(5_000);
});

test("media and coverage parse the host's JSON answer", async () => {
	const { file } = await job();
	process.env.FAKE_HOST_MEDIA = '["a.png","b.wav"]';
	process.env.FAKE_HOST_COVERAGE = '[{"frame":3,"path":"t","reason":"r"}]';
	expect(await hostMediaUrls(file, { command: FAKE })).toEqual(["a.png", "b.wav"]);
	expect(await hostCoverage(file, { command: FAKE })).toEqual([
		{ frame: 3, path: "t", reason: "r" },
	]);
});
