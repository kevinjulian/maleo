#!/usr/bin/env bun
import { getRegions } from "@remotion/lambda";
import { renderMediaOnLambda, getRenderProgress } from "@remotion/lambda/client";
import fs from "node:fs/promises";
import path from "node:path";
import { productSchema } from "@maleo/video/schema";
import { PRESETS } from "@maleo/video/lib/presets";

function getArg(name: string): string | undefined {
	const flag = `--${name}=`;
	return process.argv.find((a) => a.startsWith(flag))?.slice(flag.length);
}

async function main() {
	const configured = process.env.REMOTION_AWS_REGION ?? "us-east-1";
	const region = getRegions().find((candidate) => candidate === configured);
	if (!region) throw new Error(`REMOTION_AWS_REGION ${configured} is not a Remotion Lambda region`);
	const functionName = process.env.REMOTION_LAMBDA_FUNCTION;
	const serveUrl = process.env.REMOTION_LAMBDA_SERVE_URL;

	if (!functionName || !serveUrl) {
		console.error(
			"Missing env: REMOTION_LAMBDA_FUNCTION and REMOTION_LAMBDA_SERVE_URL. Run scripts/deploy-lambda.ts first.",
		);
		process.exit(1);
	}

	const inputFile = getArg("input");
	const presetId = getArg("preset") ?? "tiktok";
	const preset = PRESETS[presetId];
	if (!preset) {
		console.error(`Unknown preset: ${presetId}`);
		process.exit(1);
	}
	if (!inputFile) {
		console.error("Pass --input=path/to/product.json");
		process.exit(1);
	}

	const raw = await fs.readFile(path.resolve(inputFile), "utf8");
	const product = productSchema.parse(JSON.parse(raw));

	console.log(`Triggering Lambda render: ${preset.compositionId} (${presetId})`);
	const { renderId, bucketName } = await renderMediaOnLambda({
		region,
		functionName,
		serveUrl,
		composition: preset.compositionId,
		inputProps: product,
		codec: preset.codec,
		privacy: "private",
		videoBitrate: preset.videoBitrate,
		audioBitrate: preset.audioBitrate,
		pixelFormat: preset.pixelFormat,
	});
	console.log(`  renderId: ${renderId}`);
	console.log(`  bucket:   ${bucketName}`);

	while (true) {
		const progress = await getRenderProgress({
			renderId,
			bucketName,
			functionName,
			region,
		});
		if (progress.fatalErrorEncountered) {
			console.error("Render failed:", progress.errors);
			process.exit(1);
		}
		if (progress.done) {
			console.log(`✓ done: ${progress.outputFile}`);
			console.log(`  cost (estimated): $${progress.costs.accruedSoFar.toFixed(4)}`);
			return;
		}
		console.log(`  progress: ${(progress.overallProgress * 100).toFixed(1)}%`);
		await new Promise((r) => setTimeout(r, 3000));
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
