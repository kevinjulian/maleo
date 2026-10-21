import { beforeAll, expect, test } from "vite-plus/test";
import { execFileSync } from "node:child_process";
import { probeLocalMedia } from "./local-media-probe.ts";

/* A 0.25 s mono 8 kHz 16-bit PCM WAV, written byte by byte. */
function wav(seconds = 0.25, rate = 8000): File {
	const samples = Math.round(seconds * rate),
		data = samples * 2;
	const view = new DataView(new ArrayBuffer(44 + data));
	const text = (at: number, value: string) => {
		for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i));
	};
	text(0, "RIFF");
	view.setUint32(4, 36 + data, true);
	text(8, "WAVE");
	text(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, rate, true);
	view.setUint32(28, rate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	text(36, "data");
	view.setUint32(40, data, true);
	return new File([view.buffer], "tone.wav", { type: "audio/wav" });
}

let mp4: File;
beforeAll(() => {
	mp4 = new File(
		[
			execFileSync("ffmpeg", [
				"-v",
				"error",
				"-f",
				"lavfi",
				"-i",
				"color=c=red:s=32x24:r=30",
				"-f",
				"lavfi",
				"-i",
				"sine=frequency=440",
				"-t",
				"0.5",
				"-c:v",
				"libx264",
				"-pix_fmt",
				"yuv420p",
				"-c:a",
				"aac",
				"-shortest",
				"-movflags",
				"frag_keyframe+empty_moov",
				"-f",
				"mp4",
				"pipe:1",
			]),
		],
		"clip.mp4",
		{ type: "video/mp4" },
	);
});

test("audio reports duration and audio presence", async () => {
	const probe = await probeLocalMedia(wav(), "audio");
	expect(probe.duration).toBeCloseTo(0.25, 2);
	expect(probe.hasAudio).toBe(true);
	expect(probe.blocked).toBeUndefined();
});

test("video reports duration, dimensions, audio and whether this browser decodes it", async () => {
	const probe = await probeLocalMedia(mp4, "video", { canDecode: async () => true });
	expect(probe).toMatchObject({ width: 32, height: 24, hasAudio: true, decodable: true });
	// AAC priming pads the container a frame or two past the half second.
	expect(probe.duration).toBeGreaterThan(0.45);
	expect(probe.duration).toBeLessThan(0.6);
	// Bun has no WebCodecs, so the default check is the real "cannot preview here" answer.
	expect((await probeLocalMedia(mp4, "video")).decodable).toBe(false);
});

test("image size comes from the browser's image decoder", async () => {
	const probe = await probeLocalMedia(new File([new Uint8Array([1])], "a.png"), "image", {
		decodeImage: async () => ({ width: 640, height: 360, close() {} }),
	});
	expect(probe).toEqual({ width: 640, height: 360, decodable: true });
	expect(
		await probeLocalMedia(new File([new Uint8Array([1])], "a.png"), "image", {
			decodeImage: async () => {
				throw new Error("bad");
			},
		}),
	).toEqual({ decodable: false });
});

test("a file whose duration cannot be measured blocks placement with a reason", async () => {
	const probe = await probeLocalMedia(
		new File([new Uint8Array(256).fill(7)], "noise.mp4"),
		"video",
	);
	expect(probe.duration).toBeUndefined();
	expect(probe.decodable).toBe(false);
	expect(probe.blocked).toBe("Length unknown until processing finishes");
});
