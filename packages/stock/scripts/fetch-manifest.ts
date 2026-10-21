/* Bring the published manifest down so the next compile builds on it.
 *
 *   bun run fetch:manifest
 *
 * Writes music-source/published.json. Needs no credentials — the library is
 * public, which is the same property that lets a render worker read it.
 *
 * An empty file is written when nothing is published yet, so a first run has
 * something to compile against rather than an error to interpret.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { MUSIC_MANIFEST_VERSION, musicManifestUrl } from "../src/music-manifest.ts";
import { fieldOf } from "@maleo/shared";

const arg = (name: string): string | undefined =>
	process.argv
		.find((v) => v.startsWith(`--${name}=`))
		?.split("=")
		.slice(1)
		.join("=");

async function main(): Promise<void> {
	const dir = resolve(arg("source") ?? "music-source");
	const out = join(dir, "published.json");
	const url = musicManifestUrl();

	await mkdir(dir, { recursive: true });

	const res = await fetch(url, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
	if (res?.status === 404) {
		await writeFile(
			out,
			`${JSON.stringify({ schemaVersion: MUSIC_MANIFEST_VERSION, tracks: [] }, null, 2)}\n`,
		);
		console.log(`Nothing published yet at ${url}. Wrote an empty ${out}.`);
		return;
	}
	if (!res?.ok) {
		// Deliberately fatal. Writing an empty file here would make the next
		// compile look like a fresh library, and the publish after it would drop
		// every bed already live.
		console.error(`Could not read ${url}${res ? ` — ${res.status}` : ""}.`);
		console.error(
			"Refusing to write an empty manifest: the next publish would drop every published bed.",
		);
		process.exit(1);
	}

	/* The version check below is the whole point of this script, so it reads the
	 * field rather than declaring it: a manifest whose `schemaVersion` is a
	 * string would have compared unequal and exited anyway, but a body that is
	 * not an object at all used to reach `JSON.stringify` and get written to
	 * disk as the manifest. */
	const body: unknown = await res.json().catch(() => undefined);
	const schemaVersion = fieldOf(body, "schemaVersion");
	if (schemaVersion !== MUSIC_MANIFEST_VERSION) {
		console.error(
			`Published manifest is schema ${String(schemaVersion)}, this repo reads ${MUSIC_MANIFEST_VERSION}.`,
		);
		process.exit(1);
	}

	await writeFile(out, `${JSON.stringify(body, null, 2)}\n`);
	const tracks = fieldOf(body, "tracks");
	console.log(`${Array.isArray(tracks) ? tracks.length : 0} published bed(s) → ${out}`);
	console.log("Next: bun run compile:manifest");
}

await main();
