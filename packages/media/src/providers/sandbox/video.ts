import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { mediaWorkerCacheDir } from "../../paths.ts";
import { runMediaCommand } from "../../processing/probe.ts";
import { measureGeneratedVideo } from "../video-output.ts";
import type { VideoProvider } from "../types.ts";
import { createSandboxSvg, resolveSandboxDimensions } from "./image.ts";

export const sandboxVideo: VideoProvider = {
	async generate(input, ctx) {
		const deadline = AbortSignal.timeout(60_000);
		const signal = ctx.signal ? AbortSignal.any([ctx.signal, deadline]) : deadline;
		signal.throwIfAborted();
		const dims = resolveSandboxDimensions({ aspect: input.aspect });
		const ratio = input.aspect?.split(":").map(Number) ?? [dims.width, dims.height];
		if (
			ratio.length !== 2 ||
			ratio.some((value) => !Number.isSafeInteger(value) || value <= 0 || value > 10000)
		)
			throw new Error("Invalid sandbox video aspect ratio");
		let divisor = ratio[0]!,
			remainder = ratio[1]!;
		while (remainder) [divisor, remainder] = [remainder, divisor % remainder];
		const unitWidth = ratio[0]! / divisor,
			unitHeight = ratio[1]! / divisor;
		// An even common multiplier preserves the exact ratio while satisfying H.264.
		const multiplier = Math.max(2, Math.floor(720 / Math.max(unitWidth, unitHeight) / 2) * 2);
		const width = unitWidth * multiplier,
			height = unitHeight * multiplier;
		if (
			Math.min(width, height) < 64 ||
			Math.max(width, height) > 3840 ||
			Math.min(width, height) > 2160
		)
			throw new Error("Unsupported sandbox video aspect ratio");
		const cache = mediaWorkerCacheDir();
		await mkdir(cache, { recursive: true });
		const dir = await mkdtemp(join(cache, "sandbox-video-"));
		const id = randomUUID();
		const path = join(cache, `sandbox-video-${id}.mp4`);
		try {
			const image = join(dir, "frame.png");
			const output = join(dir, "output.mp4");
			await sharp(Buffer.from(createSandboxSvg({ id, prompt: input.prompt, width, height })))
				.png()
				.toFile(image);
			await runMediaCommand(
				"ffmpeg",
				[
					"-nostdin",
					"-v",
					"error",
					"-loop",
					"1",
					"-i",
					image,
					"-vf",
					`zoompan=z='1+0.0015*on':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=${width}x${height}:fps=30`,
					"-frames:v",
					"120",
					"-an",
					"-c:v",
					"libx264",
					"-preset",
					"ultrafast",
					"-pix_fmt",
					"yuv420p",
					"-threads",
					"1",
					"-filter_threads",
					"1",
					"-fs",
					"33554432",
					"-movflags",
					"+faststart",
					output,
				],
				signal,
			);
			const metadata = await measureGeneratedVideo(output, signal);
			if (metadata.duration !== 4 || metadata.hasAudio)
				throw new Error("Sandbox video must be four seconds and silent");
			signal.throwIfAborted();
			await rename(output, path);
			return { path, durationSec: 4, fromCache: false };
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	},
};
