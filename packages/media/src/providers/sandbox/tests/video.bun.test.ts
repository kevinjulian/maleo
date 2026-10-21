import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMediaCommand } from "../../../processing/probe.ts";
import { sandboxVideo } from "../video.ts";
import { sandboxProvider } from "../index.ts";
import { selectReadyProvider } from "../../selection.ts";
import { providerViolations } from "../../conformance.ts";

const priorCache = process.env.CACHE_DIR;
let dir: string;
beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "sandbox-video-test-"));
	process.env.CACHE_DIR = dir;
});
afterAll(async () => {
	if (priorCache === undefined) delete process.env.CACHE_DIR;
	else process.env.CACHE_DIR = priorCache;
	await rm(dir, { recursive: true, force: true });
});

test.each([
	[2, "16:9"],
	[4, "1:1"],
	[7, "9:16"],
] as const)(
	"requested %ss at %s produces exactly four silent seconds with motion",
	async (durationSec, aspect) => {
		const result = await sandboxVideo.generate(
			{ imageUrl: "/api/media/source", prompt: "Local mock", durationSec, aspect },
			{ workspaceId: "workspace" },
		);
		const { stdout } = await runMediaCommand(
			"ffprobe",
			["-v", "error", "-show_streams", "-show_format", "-of", "json", result.path],
			AbortSignal.timeout(5000),
		);
		const probe = JSON.parse(stdout);
		expect(result.durationSec).toBe(4);
		expect(Number(probe.format.duration)).toBe(4);
		expect(probe.streams).toHaveLength(1);
		expect(probe.streams[0]).toMatchObject({
			codec_name: "h264",
			pix_fmt: "yuv420p",
			nb_frames: "120",
			avg_frame_rate: "30/1",
		});
		const [w, h] = aspect.split(":").map(Number);
		expect(probe.streams[0].width * h!).toBe(probe.streams[0].height * w!);
		const frames = await runMediaCommand(
			"ffmpeg",
			[
				"-v",
				"error",
				"-i",
				result.path,
				"-vf",
				"select='eq(n,0)+eq(n,100)'",
				"-fps_mode",
				"passthrough",
				"-f",
				"framemd5",
				"-",
			],
			AbortSignal.timeout(5000),
		);
		const hashes = frames.stdout
			.split("\n")
			.filter((line) => line && !line.startsWith("#"))
			.map((line) => line.split(",").at(-1)?.trim());
		expect(hashes).toHaveLength(2);
		expect(hashes[0]).not.toBe(hashes[1]);
	},
	20_000,
);

test("cancelled encoding does not leave partial output", async () => {
	const before = await readdir(dir);
	await expect(
		sandboxVideo.generate(
			{ imageUrl: "unused", prompt: "mock", durationSec: 7 },
			{ workspaceId: "w", signal: AbortSignal.abort() },
		),
	).rejects.toThrow();
	expect(await readdir(dir)).toEqual(before);
});

test("cancelling an active encoder removes scratch and partial output", async () => {
	const before = await readdir(dir);
	const controller = new AbortController();
	const generation = sandboxVideo.generate(
		{ imageUrl: "unused", prompt: "mock", durationSec: 7 },
		{ workspaceId: "w", signal: controller.signal },
	);
	const rejected = generation.then(
		() => false,
		() => true,
	);
	let started = false;
	for (let attempt = 0; attempt < 200; attempt++) {
		if ((await readdir(dir, { recursive: true })).some((path) => path.endsWith("output.mp4"))) {
			started = true;
			break;
		}
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	controller.abort();
	expect(await rejected).toBe(true);
	expect(started).toBe(true);
	expect(await readdir(dir)).toEqual(before);
});

test("failed encoder startup removes scratch output", async () => {
	const before = await readdir(dir),
		priorPath = process.env.PATH;
	try {
		process.env.PATH = "";
		await expect(
			sandboxVideo.generate(
				{ imageUrl: "unused", prompt: "mock", durationSec: 2 },
				{ workspaceId: "w" },
			),
		).rejects.toThrow();
		expect(await readdir(dir)).toEqual(before);
	} finally {
		if (priorPath === undefined) delete process.env.PATH;
		else process.env.PATH = priorPath;
	}
});

test("video readiness requires binaries, not sandbox flag; defaults and retired selections exclude mock", async () => {
	const keys = ["MALEO_SANDBOX", "FAL_KEY", "MALEO_PROVIDER_VIDEO", "PATH"] as const;
	const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
	try {
		delete process.env.MALEO_SANDBOX;
		delete process.env.FAL_KEY;
		delete process.env.MALEO_PROVIDER_VIDEO;
		expect(await sandboxProvider.meta.health("video")).toBe("ready");
		expect(
			(await selectReadyProvider("video", { workspace: { video: "sandbox" } })).provider.meta.id,
		).toBe("sandbox");
		await expect(selectReadyProvider("video")).rejects.toThrow("no ready provider");
		await expect(selectReadyProvider("video", { workspace: { video: "retired" } })).rejects.toThrow(
			"no ready provider",
		);
		process.env.PATH = "";
		expect(await sandboxProvider.meta.health("video")).toBe("unconfigured");
		await expect(selectReadyProvider("video", { workspace: { video: "sandbox" } })).rejects.toThrow(
			"unconfigured",
		);
	} finally {
		for (const key of keys) {
			if (prior[key] === undefined) delete process.env[key];
			else process.env[key] = prior[key];
		}
	}
});

test("conformance rejects missing or undeclared video implementation", () => {
	expect(providerViolations({ ...sandboxProvider, video: undefined })).toContain(
		'declares "video" but ships no implementation, so providersFor() silently drops it',
	);
	const meta = {
		...sandboxProvider.meta,
		capabilities: ["image", "tts"] as ("image" | "tts")[],
		models: undefined,
		explicitOnly: undefined,
	};
	expect(
		providerViolations({ ...sandboxProvider, meta }).some((message) =>
			message.includes('implements "video" but does not declare it'),
		),
	).toBe(true);
});
