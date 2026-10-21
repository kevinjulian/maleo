#!/usr/bin/env bun
import { mkdir, readdir, stat, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.resolve(
	process.env.LEGACY_IMAGE_CACHE_DIR ?? path.join(repoRoot, "data", "legacy-image", "cache"),
);
const targetDir = path.resolve(
	process.env.CACHE_DIR ?? path.join(repoRoot, "apps", "media-worker", "data", "cache"),
);

const dryRun = process.argv.includes("--dry-run");
const overwrite = process.argv.includes("--overwrite");

function validArtifactName(name: string): boolean {
	return Boolean(name) && !name.includes("/") && !name.includes("\\") && !name.includes("..");
}

async function fileSize(p: string): Promise<number | null> {
	try {
		const s = await stat(p);
		return s.isFile() ? s.size : null;
	} catch {
		return null;
	}
}

async function main(): Promise<void> {
	const sourceStat = await stat(sourceDir).catch(() => null);
	if (!sourceStat?.isDirectory()) {
		throw new Error(`legacy cache dir not found: ${sourceDir}`);
	}
	const names = (await readdir(sourceDir)).filter(validArtifactName).sort();
	if (!dryRun) await mkdir(targetDir, { recursive: true });

	let copied = 0;
	let skipped = 0;
	let overwritten = 0;
	let bytes = 0;

	for (const name of names) {
		const src = path.join(sourceDir, name);
		const srcSize = await fileSize(src);
		if (srcSize === null) continue;
		const dst = path.join(targetDir, name);
		const dstSize = await fileSize(dst);
		if (dstSize !== null && !overwrite) {
			skipped += 1;
			continue;
		}
		if (!dryRun) await copyFile(src, dst);
		if (dstSize !== null) overwritten += 1;
		else copied += 1;
		bytes += srcSize;
	}

	console.log(
		JSON.stringify(
			{
				sourceDir,
				targetDir,
				dryRun,
				overwrite,
				copied,
				overwritten,
				skipped,
				bytes,
			},
			null,
			2,
		),
	);
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
});
