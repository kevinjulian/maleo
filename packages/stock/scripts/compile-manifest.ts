/* Merge the published manifest and the per-track sidecars into one source
 * manifest.
 *
 *   music-source/
 *     published.json      ← fetch:manifest
 *     <track>.mp3         ← the extension
 *     <track>.json        ← the extension
 *     manifest.json       ← written here
 *
 *   bun run compile:manifest
 *
 * A bed already published is carried through with its url and hash even when
 * its audio is long gone from the folder, which is what stops the library
 * shrinking every time it is rebuilt. See src/music-compile.ts.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fieldOf } from "@maleo/shared";
import {
	compileManifest,
	describeCompile,
	readPublishedTrack,
	readSidecar,
	type PublishedTrack,
	type SidecarTrack,
} from "../src/music-compile.ts";

const arg = (name: string): string | undefined =>
	process.argv
		.find((v) => v.startsWith(`--${name}=`))
		?.split("=")
		.slice(1)
		.join("=");

/** Everything in the folder except the two files this pipeline writes itself. */
const RESERVED = new Set(["published.json", "manifest.json", "prepared.json"]);

async function main(): Promise<void> {
	const dir = resolve(arg("source") ?? "music-source");
	if (!existsSync(dir)) {
		console.error(`No ${dir}. Capture some tracks first, or run: bun run fetch:manifest`);
		process.exit(1);
	}

	const publishedPath = join(dir, "published.json");
	let published: PublishedTrack[] = [];
	if (existsSync(publishedPath)) {
		const tracks = fieldOf(JSON.parse(await readFile(publishedPath, "utf8")), "tracks");
		published = Array.isArray(tracks) ? tracks.map(readPublishedTrack) : [];
	} else {
		// Not fatal, but worth being loud about: compiling without it treats every
		// published bed as gone, and the publish after would drop them.
		console.warn(`No published.json in ${dir}. Run: bun run fetch:manifest`);
		console.warn("Continuing as though nothing is published — safe only on a first run.\n");
	}

	const names = (await readdir(dir)).filter((n) => n.endsWith(".json") && !RESERVED.has(n)).sort();
	const sidecars: SidecarTrack[] = [];
	for (const name of names) {
		try {
			sidecars.push(readSidecar(JSON.parse(await readFile(join(dir, name), "utf8"))));
		} catch {
			console.warn(`  unreadable ${name} — not valid JSON, skipping`);
		}
	}

	const result = compileManifest(published, sidecars);
	for (const problem of result.problems) console.warn(`  ${problem}`);

	// A sidecar naming audio that is not there will fail at bake with a clearer
	// message, but saying it now saves a round trip.
	for (const track of result.tracks) {
		if (track.file && !existsSync(join(dir, track.file))) {
			console.warn(`  missing   ${track.file} — named by a sidecar but not in the folder`);
		}
	}

	await writeFile(
		join(dir, "manifest.json"),
		`${JSON.stringify({ tracks: result.tracks }, null, 2)}\n`,
	);

	console.log(
		`\n${describeCompile(result)}. ${result.tracks.length} bed(s) → ${join(dir, "manifest.json")}`,
	);
	if (!result.tracks.length) {
		console.error("Nothing to build.");
		process.exit(1);
	}
	console.log("Next: bun run enrich:music, then publish:music");
}

await main();
