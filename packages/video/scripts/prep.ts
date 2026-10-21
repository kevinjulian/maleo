#!/usr/bin/env bun
import fs from "node:fs/promises";
import path from "node:path";
import { aspectMap, productSchema, type Aspect } from "../src/schema";
import { prepareAll } from "../src/lib/image-prep";
import { synthesize } from "../src/lib/tts";
import { transcribe } from "../src/lib/transcribe";

function getArg(name: string): string | undefined {
	const flag = `--${name}=`;
	return process.argv.find((a) => a.startsWith(flag))?.slice(flag.length);
}

/* `Aspect` is `keyof typeof aspectMap`, so an own-property test IS the check —
 * `hasOwn` rather than `in`, which would accept an inherited name. A predicate
 * rather than a cast because the narrowing is something this function proves. */
function isAspect(value: string): value is Aspect {
	return Object.hasOwn(aspectMap, value);
}

async function main() {
	const inputDir = path.resolve(getArg("in") ?? "inputs");
	// A CLI flag is user input. `--aspect=nonsense` used to travel as an `Aspect`
	// and fail wherever `aspectMap` was finally indexed; it now fails here, naming
	// what was wrong. `oneOf` would be the shared helper for this, but
	// `@maleo/video` cannot import `@maleo/shared`, so the predicate is local.
	const aspectArg = getArg("aspect") ?? "vertical";
	if (!isAspect(aspectArg)) {
		console.error(
			`unknown --aspect=${aspectArg}; expected one of ${Object.keys(aspectMap).join(", ")}`,
		);
		process.exit(1);
	}
	const aspect = aspectArg;
	const doTTS = getArg("tts") === "true";
	const doImages = getArg("images") !== "false";

	const files = (await fs.readdir(inputDir)).filter((f) => f.endsWith(".json"));
	for (const file of files) {
		const filePath = path.join(inputDir, file);
		const raw = await fs.readFile(filePath, "utf8");
		const product = productSchema.parse(JSON.parse(raw));
		let changed = false;

		if (doImages && product.images.length > 0) {
			const localPaths = await prepareAll(product.images, aspect, {
				removeBg: false,
				upscale: false,
			});
			product.images = localPaths;
			changed = true;
			console.log(`  ✓ images prepped: ${file}`);
		}

		if (doTTS && product.voiceover?.text && !product.voiceover.audioUrl) {
			const tts = await synthesize({ text: product.voiceover.text });
			product.voiceover.audioUrl = tts.audioPath;
			const tx = await transcribe({
				audioPath: tts.audioPath,
				text: product.voiceover.text,
			});
			product.voiceover.words = tx.words;
			product.voiceover.endSec =
				product.voiceover.startSec +
				(tx.words.length > 0 ? tx.words[tx.words.length - 1]!.endSec : tts.durationSec);
			changed = true;
			console.log(`  ✓ tts + captions: ${file}`);
		}

		if (changed) {
			await fs.writeFile(filePath, JSON.stringify(product, null, 2));
		}
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
