import { describe, expect, test } from "bun:test";
import { wavDuration } from "../src/lib/tts";
import { storyboardSchema } from "../src/schema";
import { prepareStoryboard, wordsForScene, wordCount } from "../src/lib/prepare-storyboard";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { prepareImage } from "../src/lib/image-prep";

const PNG_1X1 = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
	"base64",
);

describe("caption word timing", () => {
	test("wordCount counts whitespace tokens", () => {
		expect(wordCount("halo dunia ini cerita")).toBe(4);
		expect(wordCount("   ")).toBe(0);
	});

	test("wordsForScene distributes evenly across the window", () => {
		const words = wordsForScene("satu dua tiga empat", 10, 18);
		expect(words.length).toBe(4);
		expect(words[0]!.startSec).toBe(10);
		expect(words[3]!.endSec).toBeCloseTo(18, 5);
		// monotonic, non-overlapping
		for (let i = 1; i < words.length; i++) {
			expect(words[i]!.startSec).toBeCloseTo(words[i - 1]!.endSec, 5);
		}
	});

	test("empty scene yields no words", () => {
		expect(wordsForScene("", 0, 5)).toEqual([]);
	});
});

describe("wavDuration", () => {
	test("reads duration from a PCM wav header", async () => {
		// 1 second of 16-bit mono @ 16kHz = 32000 data bytes, byteRate 32000.
		const sampleRate = 16000,
			bits = 16,
			channels = 1;
		const byteRate = sampleRate * channels * (bits / 8);
		const dataBytes = byteRate; // 1 second
		const buf = Buffer.alloc(44 + dataBytes);
		buf.write("RIFF", 0, "ascii");
		buf.writeUInt32LE(36 + dataBytes, 4);
		buf.write("WAVE", 8, "ascii");
		buf.write("fmt ", 12, "ascii");
		buf.writeUInt32LE(16, 16);
		buf.writeUInt16LE(1, 20);
		buf.writeUInt16LE(channels, 22);
		buf.writeUInt32LE(sampleRate, 24);
		buf.writeUInt32LE(byteRate, 28);
		buf.writeUInt16LE(channels * (bits / 8), 32);
		buf.writeUInt16LE(bits, 34);
		buf.write("data", 36, "ascii");
		buf.writeUInt32LE(dataBytes, 40);
		const p = join(tmpdir(), `maleo-wav-${Date.now()}.wav`);
		writeFileSync(p, buf);
		try {
			const dur = await wavDuration(p, "ignored");
			expect(dur).toBeCloseTo(1.0, 2);
		} finally {
			rmSync(p, { force: true });
		}
	});

	test("falls back to wpm estimate on non-wav", async () => {
		const dur = await wavDuration("/nonexistent/file.wav", "satu dua tiga empat lima enam");
		// 6 words / 160 wpm * 60 = 2.25s
		expect(dur).toBeCloseTo(2.25, 2);
	});
});

describe("prepareStoryboard", () => {
	test("keeps authored scene boundaries when later overlays extend the timeline", async () => {
		const input = storyboardSchema.parse({
			scenes: [
				{ image: "", startSec: 0, durationSec: 1.5 },
				{ image: "", startSec: 3, durationSec: 3 },
				{ image: "", startSec: 8, durationSec: 20 },
			],
			videoOverlays: [
				{ url: "https://example.test/video.mp4", kind: "video", startSec: 40, durationSec: 5 },
			],
		});
		const out = await prepareStoryboard(input, { targetDurationSec: 45 });
		expect(
			out.storyboard.scenes.map(({ startSec, durationSec }) => ({ startSec, durationSec })),
		).toEqual(input.scenes.map(({ startSec, durationSec }) => ({ startSec, durationSec })));
		expect(out.storyboard.videoOverlays).toEqual(input.videoOverlays);
		expect(out.totalDurationSec).toBe(45);
	});

	test("keeps authored narration clips instead of generating a replacement track", async () => {
		const input = storyboardSchema.parse({
			scenes: [
				{
					image: "",
					startSec: 3,
					durationSec: 3,
					audioClips: [
						{
							kind: "voiceover",
							content: "Authored narration",
							url: "https://example.test/voice.wav",
							durationSec: 2,
						},
					],
				},
			],
		});
		const stages: string[] = [];
		const out = await prepareStoryboard(input, { onProgress: (p) => stages.push(p.stage) });
		expect(out.storyboard.scenes[0]!.durationSec).toBe(3);
		expect(out.storyboard.scenes[0]!.audioClips).toEqual(input.scenes[0]!.audioClips);
		expect(out.storyboard.voiceover).toEqual(input.voiceover);
		expect(stages).not.toContain("synthesizing_audio");
		expect(out.totalDurationSec).toBe(6);
	});

	test("still adapts untimed storyboards to the requested duration", async () => {
		const input = storyboardSchema.parse({
			scenes: [
				{ image: "", durationSec: 4 },
				{ image: "", durationSec: 4 },
			],
		});
		const out = await prepareStoryboard(input, { targetDurationSec: 12 });
		expect(out.storyboard.scenes.map((s) => s.durationSec)).toEqual([6, 6]);
		expect(out.totalDurationSec).toBe(12);
	});

	test("preserves source pixels and transparency instead of reusing cropped images", async () => {
		const prevBase = process.env.MALEO_VIDEO_PUBLIC_BASE;
		delete process.env.MALEO_VIDEO_PUBLIC_BASE;
		mkdirSync("public/test-fixtures", { recursive: true });
		const source = join("public", "test-fixtures", `maleo-source-${Date.now()}.png`);
		const pixels = Buffer.alloc(32 * 24 * 4);
		for (let i = 0; i < pixels.length; i++) pixels[i] = i % 251;
		await sharp(pixels, { raw: { width: 32, height: 24, channels: 4 } })
			.png()
			.toFile(source);
		const input = storyboardSchema.parse({
			scenes: [
				{
					image: source,
					visual: "",
					voiceover: "",
					durationSec: 4,
					visualClips: [{ url: source, kind: "image", primary: true }],
					sectionTransition: {
						type: "question_card",
						plateId: "thread",
						text: "Next",
						motion: "line_draw",
						durationSec: 0.9,
						plateImageUrl: source,
					},
				},
			],
			visualTimeline: [{ url: source, kind: "image", startSec: 0, durationSec: 4 }],
			videoOverlays: [{ url: source, kind: "image", startSec: 0, durationSec: 4 }],
		});
		try {
			const cropped = await prepareImage({ url: source, aspect: "horizontal" });
			expect((await sharp(cropped.localPath).metadata()).width).toBe(1920);
			for (let run = 0; run < 2; run++) {
				const { storyboard } = await prepareStoryboard(input, { aspect: "horizontal" });
				const paths = [
					storyboard.scenes[0]!.image,
					storyboard.scenes[0]!.visualClips![0]!.url,
					storyboard.scenes[0]!.sectionTransition!.plateImageUrl,
					storyboard.visualTimeline![0]!.url,
					storyboard.videoOverlays![0]!.url,
				];
				for (const asset of paths) {
					const file = join("public", asset!);
					expect(await sharp(file).metadata()).toMatchObject({
						width: 32,
						height: 24,
						hasAlpha: true,
					});
					expect(await sharp(file).raw().toBuffer()).toEqual(pixels);
				}
				// A second preparation must use the cache even after the source disappears.
				rmSync(source, { force: true });
			}
		} finally {
			if (prevBase == null) delete process.env.MALEO_VIDEO_PUBLIC_BASE;
			else process.env.MALEO_VIDEO_PUBLIC_BASE = prevBase;
			rmSync(source, { force: true });
		}
	});

	test("rewrites transition plate images through the render asset base", async () => {
		const prevBase = process.env.MALEO_VIDEO_PUBLIC_BASE;
		process.env.MALEO_VIDEO_PUBLIC_BASE = "http://dash.local";
		mkdirSync("public/test-fixtures", { recursive: true });
		const sceneImage = join("public", "test-fixtures", `maleo-scene-${Date.now()}.png`);
		const plateImage = join("public", "test-fixtures", `maleo-plate-${Date.now()}.png`);
		writeFileSync(sceneImage, PNG_1X1);
		writeFileSync(plateImage, PNG_1X1);

		try {
			const out = await prepareStoryboard(
				storyboardSchema.parse({
					scenes: [
						{
							image: sceneImage,
							visual: "",
							voiceover: "",
							durationSec: 4,
							sectionTransition: {
								type: "question_card",
								plateId: "thread",
								text: "Next question",
								motion: "line_draw",
								durationSec: 0.9,
								plateImageUrl: plateImage,
							},
						},
					],
				}),
			);

			const sceneUrl = out.storyboard.scenes[0]!.image;
			const plateUrl = out.storyboard.scenes[0]!.sectionTransition?.plateImageUrl;
			expect(sceneUrl).toStartWith("http://dash.local/images/");
			expect(plateUrl).toStartWith("http://dash.local/images/");
			expect(plateUrl).not.toBe(plateImage);
		} finally {
			if (prevBase == null) delete process.env.MALEO_VIDEO_PUBLIC_BASE;
			else process.env.MALEO_VIDEO_PUBLIC_BASE = prevBase;
			rmSync(sceneImage, { force: true });
			rmSync(plateImage, { force: true });
		}
	});

	test("rewrites visual clip, visual timeline, and image overlay assets", async () => {
		const prevBase = process.env.MALEO_VIDEO_PUBLIC_BASE;
		process.env.MALEO_VIDEO_PUBLIC_BASE = "http://video.local/public";
		mkdirSync("public/test-fixtures", { recursive: true });
		const visualClip = join("public", "test-fixtures", `maleo-vclip-${Date.now()}.png`);
		const timelineClip = join("public", "test-fixtures", `maleo-vtimeline-${Date.now()}.png`);
		const overlayClip = join("public", "test-fixtures", `maleo-overlay-${Date.now()}.png`);
		writeFileSync(visualClip, PNG_1X1);
		writeFileSync(timelineClip, PNG_1X1);
		writeFileSync(overlayClip, PNG_1X1);

		try {
			const out = await prepareStoryboard(
				storyboardSchema.parse({
					scenes: [
						{
							image: "",
							visual: "",
							voiceover: "",
							durationSec: 4,
							visualClips: [{ url: visualClip, kind: "image", primary: true }],
						},
					],
					visualTimeline: [
						{
							url: timelineClip,
							kind: "image",
							startSec: 0,
							durationSec: 4,
							layout: { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 },
						},
					],
					videoOverlays: [
						{
							url: overlayClip,
							kind: "image",
							startSec: 0,
							durationSec: 4,
							layout: { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 },
						},
					],
				}),
			);

			const mappedVisualClip = out.storyboard.scenes[0]!.visualClips?.[0]?.url;
			const mappedTimelineClip = out.storyboard.visualTimeline?.[0]?.url;
			const mappedOverlayClip = out.storyboard.videoOverlays?.[0]?.url;
			expect(mappedVisualClip).toStartWith("http://video.local/public/images/");
			expect(mappedTimelineClip).toStartWith("http://video.local/public/images/");
			expect(mappedOverlayClip).toStartWith("http://video.local/public/images/");
			expect(mappedVisualClip).not.toBe(visualClip);
			expect(mappedTimelineClip).not.toBe(timelineClip);
			expect(mappedOverlayClip).not.toBe(overlayClip);
		} finally {
			if (prevBase == null) delete process.env.MALEO_VIDEO_PUBLIC_BASE;
			else process.env.MALEO_VIDEO_PUBLIC_BASE = prevBase;
			rmSync(visualClip, { force: true });
			rmSync(timelineClip, { force: true });
			rmSync(overlayClip, { force: true });
		}
	});
});
