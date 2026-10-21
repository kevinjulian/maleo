#!/usr/bin/env bun
// Render a sample ~1-minute 16:9 storyteller video for the "maestro" workspace.
// Uses per-scene placeholder images (no external image service needed) and
// renders silent-with-captions if no TTS provider is reachable. With
// MALEO_KOKORO_URL set, it adds self-hosted voiceover.
//
//   bun scripts/sample-maestro.ts
//
// Output: out/sample-maestro.mp4
import path from "node:path";
import fs from "node:fs/promises";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { storyboardSchema } from "../src/schema";
import { PRESETS } from "../src/lib/presets";
import { prepareStoryboard } from "../src/lib/prepare-storyboard";

// 12 scenes x ~5s = ~60s. A tiny fable. Scene 1 + 12 reuse the same visual
// (forest at dawn) to demonstrate image reuse.
const FOREST = "Hutan tua saat fajar, kabut tipis di antara pohon-pohon raksasa";
const SCENES = [
	{
		label: "Pembuka",
		visual: FOREST,
		voiceover: "Di hutan tua, saat fajar pertama menyentuh dedaunan, sebuah cerita bermula.",
		movement: "Slow Zoom In",
		transition: "fade",
	},
	{
		label: "Si Rubah",
		visual: "Seekor rubah kecil berbulu jingga mengintip dari balik semak",
		voiceover: "Seekor rubah kecil terbangun, lapar dan penasaran.",
		movement: "Ken Burns",
		transition: "cut",
	},
	{
		label: "Jejak",
		visual: "Jejak kaki samar di tanah lembab menuju kejauhan",
		voiceover: "Ia menemukan jejak aneh yang menuju ke dalam hutan.",
		movement: "Slow Pan Right",
		transition: "slide",
	},
	{
		label: "Sungai",
		visual: "Sungai jernih berkilau memantulkan cahaya pagi",
		voiceover: "Jejak itu membawanya ke sungai yang berkilauan.",
		movement: "Slow Pan Left",
		transition: "fade",
	},
	{
		label: "Pertemuan",
		visual: "Seekor burung hantu bijak bertengger di dahan rendah",
		voiceover: "Di tepi sungai, seekor burung hantu tua menyapanya.",
		movement: "Slight Push In",
		transition: "cut",
	},
	{
		label: "Nasihat",
		visual: "Mata burung hantu besar menatap penuh makna",
		voiceover: "Burung hantu berkata: yang kau cari ada di tempat kau memulai.",
		movement: "Slow Zoom In",
		transition: "fade",
	},
	{
		label: "Ragu",
		visual: "Rubah kecil menunduk, bingung di tengah cahaya redup",
		voiceover: "Rubah itu ragu, namun rasa penasaran mengalahkan takut.",
		movement: "Static",
		transition: "cut",
	},
	{
		label: "Perjalanan",
		visual: "Lorong pepohonan panjang dengan cahaya menembus celah daun",
		voiceover: "Maka ia kembali menyusuri jalan yang sama.",
		movement: "Slow Pan Right",
		transition: "slide",
	},
	{
		label: "Penemuan",
		visual: "Sarang hangat tersembunyi di bawah akar pohon besar",
		voiceover: "Dan di tempat ia memulai, tersembunyi sebuah sarang hangat.",
		movement: "Ken Burns",
		transition: "fade",
	},
	{
		label: "Makna",
		visual: "Cahaya keemasan menyinari sarang kecil yang nyaman",
		voiceover: "Yang ia cari selama ini, ternyata rumahnya sendiri.",
		movement: "Slight Push In",
		transition: "fade",
	},
	{
		label: "Pulang",
		visual: "Rubah kecil meringkuk bahagia di dalam sarang",
		voiceover: "Rubah kecil pun pulang, mengerti arti perjalanan.",
		movement: "Slow Zoom Out",
		transition: "cut",
	},
	{
		label: "Penutup",
		visual: FOREST,
		voiceover: "Dan hutan tua kembali sunyi, menyimpan satu cerita lagi.",
		movement: "Slow Zoom Out",
		transition: "fade",
	},
];

async function main() {
	const raw = storyboardSchema.parse({
		scenes: SCENES.map((s) => ({ ...s, durationSec: 5, image: "" })),
		accentColor: "#7C3AED",
		bgColor: "#0B0B0F",
		fgColor: "#FFFFFF",
		musicMood: "chill",
	});

	console.log("[sample] preparing storyboard (per-scene images + TTS + captions)…");
	// Target ~60s; with MALEO_IMAGE_URL set, scenes get real generated images.
	const prepared = await prepareStoryboard(raw, { aspect: "horizontal", targetDurationSec: 60 });
	console.log(
		`[sample] ${prepared.uniqueImages} unique image(s), ${prepared.reusedScenes} reused scene(s), ${prepared.totalDurationSec.toFixed(1)}s`,
	);

	const preset = PRESETS["storyboard-wide"]!;
	const outDir = path.resolve("out");
	await fs.mkdir(outDir, { recursive: true });
	const outPath = path.join(outDir, "sample-maestro.mp4");

	console.log("[sample] bundling Remotion…");
	const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts") });
	const composition = await selectComposition({
		serveUrl,
		id: preset.compositionId,
		inputProps: prepared.storyboard,
	});

	console.log("[sample] rendering…");
	await renderMedia({
		composition,
		serveUrl,
		codec: preset.codec,
		outputLocation: outPath,
		inputProps: prepared.storyboard,
		videoBitrate: preset.videoBitrate,
		audioBitrate: preset.audioBitrate,
		pixelFormat: preset.pixelFormat,
		onProgress: ({ progress }) =>
			process.stdout.write(`\r[sample] ${(progress * 100).toFixed(0)}%   `),
	});
	console.log(`\n[sample] done -> ${outPath}`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
