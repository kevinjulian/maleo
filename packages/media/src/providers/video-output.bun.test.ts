import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import * as output from "./video-output.ts";
import { runMediaCommand } from "../processing/probe.ts";
import * as probe from "../processing/probe.ts";

let dir: string;
const signal = () => AbortSignal.timeout(30_000);
beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "prepare-video-"));
});
afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
});

async function fixture(name: string, args: string[] = []) {
	const path = join(dir, `${name}.mp4`);
	await runMediaCommand(
		"ffmpeg",
		[
			"-nostdin",
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"testsrc2=size=720x480:rate=10:duration=1",
			"-c:v",
			name === "vp9" ? "libvpx-vp9" : "libx264",
			"-threads",
			"1",
			...args,
			path,
		],
		signal(),
	);
	return path;
}

function boxTypes(bytes: Buffer): string[] {
	const types: string[] = [];
	for (let offset = 0; offset + 8 <= bytes.length;) {
		let size = bytes.readUInt32BE(offset);
		types.push(bytes.toString("ascii", offset + 4, offset + 8));
		if (size === 1) size = Number(bytes.readBigUInt64BE(offset + 8));
		if (!size) break;
		offset += size;
	}
	return types;
}

for (const codec of ["h264", "vp9"])
	test(`prepares ${codec} as faststart H.264 with a bounded JPEG`, async () => {
		const input = await fixture(codec);
		const before = boxTypes(Buffer.from(await Bun.file(input).arrayBuffer()));
		expect(before.indexOf("moov")).toBeGreaterThan(before.indexOf("mdat"));
		const target = join(dir, codec);
		await mkdir(target);
		const result = await output.prepareGeneratedVideo(input, target, signal());
		const types = boxTypes(Buffer.from(await Bun.file(result.video).arrayBuffer()));
		expect(types.indexOf("moov")).toBeGreaterThanOrEqual(0);
		expect(types.indexOf("moov")).toBeLessThan(types.indexOf("mdat"));
		const metadata = await output.measureGeneratedVideo(result.video, signal());
		expect(metadata.videoCodec).toBe("h264");
		expect(Math.abs(metadata.duration! - 1)).toBeLessThanOrEqual(0.1);
		const poster = await sharp(result.poster!).metadata();
		expect(poster.format).toBe("jpeg");
		expect(Math.max(poster.width!, poster.height!)).toBeLessThanOrEqual(640);
	}, 30_000);

test("keeps valid video when poster output cannot be written", async () => {
	const input = await fixture("poster-failure");
	const target = join(dir, "poster-failure");
	await mkdir(join(target, "poster.jpg"), { recursive: true });
	const result = await output.prepareGeneratedVideo(input, target, signal());
	expect(result.poster).toBeNull();
	expect((await output.measureGeneratedVideo(result.video, signal())).duration).toBe(1);
});

test("rejects zero-frame video", async () => {
	const input = await fixture("empty", ["-frames:v", "0"]);
	await expect(output.prepareGeneratedVideo(input, dir, signal())).rejects.toThrow();
});

test("rejects output duration mismatch", async () => {
	const input = await fixture("duration");
	const target = join(dir, "duration");
	await mkdir(target);
	const original = probe.runMediaCommand;
	const command = spyOn(probe, "runMediaCommand").mockImplementation(
		async (binary, args, signal) => {
			const result = await original(binary, args, signal);
			if (binary === "ffprobe" && args.includes(join(target, "output.mp4"))) {
				const data = JSON.parse(result.stdout);
				data.format.duration = "2";
				return { ...result, stdout: JSON.stringify(data) };
			}
			return result;
		},
	);
	try {
		await expect(output.prepareGeneratedVideo(input, target, signal())).rejects.toThrow("duration");
	} finally {
		command.mockRestore();
	}
});

test("propagates cancellation", async () => {
	const controller = new AbortController();
	controller.abort(new Error("cancelled"));
	await expect(output.prepareGeneratedVideo("unused.mp4", dir, controller.signal)).rejects.toThrow(
		"cancelled",
	);
});

test("cancellation during poster extraction is not optional poster failure", async () => {
	const input = await fixture("cancel-poster");
	const target = join(dir, "cancel-poster");
	await mkdir(target);
	const controller = new AbortController();
	const original = probe.runMediaCommand;
	const command = spyOn(probe, "runMediaCommand").mockImplementation(
		async (binary, args, signal) => {
			if (binary === "ffmpeg" && args.includes(join(target, "poster.jpg")))
				controller.abort(new Error("poster cancelled"));
			return original(binary, args, signal);
		},
	);
	try {
		await expect(output.prepareGeneratedVideo(input, target, controller.signal)).rejects.toThrow(
			"poster cancelled",
		);
	} finally {
		command.mockRestore();
	}
});
