#!/usr/bin/env bun
import { deployFunction, deploySite, getOrCreateBucket, getRegions } from "@remotion/lambda";
import { VIDEO_ENTRY, VIDEO_ROOT } from "@maleo/video/paths";

async function main() {
	const configured = process.env.AWS_REGION ?? "us-east-1";
	const region = getRegions().find((candidate) => candidate === configured);
	if (!region) throw new Error(`AWS_REGION ${configured} is not a Remotion Lambda region`);

	console.log("Ensuring S3 bucket…");
	const { bucketName } = await getOrCreateBucket({ region });
	console.log(`  bucket: ${bucketName}`);

	console.log("Deploying Lambda function…");
	const fn = await deployFunction({
		region,
		memorySizeInMb: 3009,
		diskSizeInMb: 10240,
		timeoutInSeconds: 300,
		createCloudWatchLogGroup: true,
	});
	console.log(`  function: ${fn.functionName}`);

	console.log("Deploying site bundle…");
	const site = await deploySite({
		region,
		bucketName,
		entryPoint: VIDEO_ENTRY,
		options: { rootDir: VIDEO_ROOT },
		siteName: "maleo-video",
	});
	console.log(`  site: ${site.serveUrl}`);

	console.log("\nSave these to .env:");
	console.log(`REMOTION_AWS_REGION=${region}`);
	console.log(`REMOTION_LAMBDA_FUNCTION=${fn.functionName}`);
	console.log(`REMOTION_LAMBDA_SERVE_URL=${site.serveUrl}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
