#!/usr/bin/env bun
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { productSchema } from "../src/schema";
import { PRESETS } from "../src/lib/presets";
import path from "node:path";
import fs from "node:fs/promises";

const inputDir = path.resolve("inputs");
const outDir = path.resolve("out");
const entry = path.resolve("src/index.ts");

function getArg(name: string): string | undefined {
	const flag = `--${name}=`;
	return process.argv.find((a) => a.startsWith(flag))?.slice(flag.length);
}

async function main() {
	await fs.mkdir(outDir, { recursive: true });
	const files = (await fs.readdir(inputDir)).filter((f) => f.endsWith(".json"));
	if (files.length === 0) {
		console.error(`No input JSON in ${inputDir}`);
		process.exit(1);
	}

	const presetIds = (getArg("presets") ?? "tiktok,reels,shorts,ig-feed,yt-long").split(",");
	const presets = presetIds
		.map((id) => PRESETS[id.trim()])
		.filter((p): p is NonNullable<typeof p> => Boolean(p));

	console.log("Bundling…");
	const serveUrl = await bundle({ entryPoint: entry });

	for (const file of files) {
		const raw = await fs.readFile(path.join(inputDir, file), "utf8");
		const product = productSchema.parse(JSON.parse(raw));
		const slug = path.basename(file, ".json");

		for (const preset of presets) {
			const composition = await selectComposition({
				serveUrl,
				id: preset.compositionId,
				inputProps: product,
			});
			const outPath = path.join(outDir, `${slug}.${preset.id}.mp4`);
			console.log(`Rendering ${slug} → ${preset.id} (${preset.compositionId})`);
			await renderMedia({
				composition,
				serveUrl,
				codec: preset.codec,
				outputLocation: outPath,
				inputProps: product,
				videoBitrate: preset.videoBitrate,
				audioBitrate: preset.audioBitrate,
				pixelFormat: preset.pixelFormat,
			});
			console.log(`  ✓ ${outPath}`);
		}
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
