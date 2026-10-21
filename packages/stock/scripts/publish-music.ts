/* Publish the library and its manifest to Backblaze B2.
 *
 * Uses B2's own API rather than the S3-compatible one. The credentials already
 * configured — B2_KEY_ID, B2_APP_KEY, B2_BUCKET_NAME — are exactly its input,
 * and the whole upload is three plain requests: authorise, ask for an upload
 * URL, put the file. The S3 route would need an endpoint and region that are not
 * set, and in practice an AWS SDK client, which is a large dependency for
 * uploading a handful of audio files a few times a year.
 *
 * Audio is uploaded exactly as it was downloaded. Nothing is transcoded and
 * nothing is loudness-normalised — the bytes that land in music-source are the
 * bytes that get served.
 *
 * The uploaded name is the downloaded name, unchanged. A bed is therefore
 * findable by eye: the file in music-source, the object in the bucket and the
 * url in the manifest all read the same.
 *
 * That has a consequence worth knowing. A name that is not content-addressed can
 * hold different bytes over time — replace a track and its url stays the same —
 * so beds are NOT cached immutably. They carry a day, not a year. Nothing
 * revalidates a url pinned into a template row, so an immutable cache on a
 * reusable name would serve the old audio for as long as the cache lived.
 *
 * A bed's identity is its SOURCE url, not its filename. The filename encodes the
 * normalised bytes, so re-baking with different settings renames the same track
 * — and a name-based check would call that "never published", upload a second
 * copy, and orphan the first. Publishing therefore diffs against the published
 * manifest, which is also one request rather than one HEAD per bed.
 *
 * The manifest is always rewritten: it is the index, and it is small.
 *
 * Every uploaded bed is verified reachable at its PUBLIC url before it is
 * written into the manifest. That url is what ends up pinned in template rows,
 * so a bed that uploaded but is not actually served would surface much later as
 * a silent video rather than an error here.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { hasAudioTools, probeDurationSec, slug } from "../src/music-audio.ts";
import { isCarried, type CompiledTrack } from "../src/music-compile.ts";
import { assignUniqueIds, dropDuplicateAudio, type PreparedTrack } from "../src/music-dedup.ts";
import {
	MUSIC_MANIFEST_VERSION,
	baseUrlMatchesBucket,
	musicBedUrl,
	musicManifestUrl,
	musicPrefix,
} from "../src/music-manifest.ts";
import { authoriseB2, b2CredentialsFromEnv, uploadToB2, type B2Auth } from "../src/b2.ts";
import { findDuplicates } from "../src/music-dedup.ts";
import { describePlan, planPublish, type PublishedBed } from "../src/music-publish-plan.ts";
import { fieldOf } from "@maleo/shared";

const arg = (name: string): string | undefined =>
	process.argv
		.find((v) => v.startsWith(`--${name}=`))
		?.split("=")
		.slice(1)
		.join("=");

/** A day, not a year, and not immutable.
 *
 *  Bed names are the operator's, not content-addressed, so the same name can
 *  hold different audio after a track is replaced. A url pinned into a template
 *  row is never revalidated, so a long cache here would serve the superseded
 *  bed for as long as it lived. A day is enough for Cloudflare to be doing its
 *  job — egress is free through the Bandwidth Alliance either way — and short
 *  enough that a replacement lands the same day. */
async function uploadBed(auth: B2Auth, name: string, bytes: Uint8Array): Promise<void> {
	await uploadToB2(auth, {
		path: `${musicPrefix()}/${name}`,
		bytes,
		contentType: "audio/mpeg",
		cacheControl: "public, max-age=86400",
	});
}

/** What is already published, by source url. Absent on a first publish, and a
 *  fetch failure is treated the same way — publishing everything is safe because
 *  content-hashed names make an unnecessary upload idempotent, whereas skipping
 *  wrongly would leave the manifest pointing at nothing. */
async function fetchPublished(): Promise<PublishedBed[]> {
	try {
		const res = await fetch(musicManifestUrl(), { signal: AbortSignal.timeout(20_000) });
		if (!res.ok) return [];
		/* A row without a `url` and a `source` is not a published bed, and the
		 * plan below decides what to re-upload by comparing urls — so a malformed
		 * row is dropped rather than carried in as one with `undefined` where the
		 * url should be. The empty-list fallbacks either side of this already
		 * treat "cannot read the manifest" as "nothing is published", and the
		 * caller's comment above explains why that is the safe direction. */
		const tracks = fieldOf(await res.json().catch(() => undefined), "tracks");
		if (!Array.isArray(tracks)) return [];
		return tracks.filter(
			(t): t is PublishedBed =>
				typeof fieldOf(t, "url") === "string" && typeof fieldOf(t, "source") === "string",
		);
	} catch {
		return [];
	}
}

/** Is this bed actually served at the public url that will be pinned? */
async function reachable(url: string): Promise<boolean> {
	try {
		const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(20_000) });
		return res.ok;
	} catch {
		return false;
	}
}

async function main(): Promise<void> {
	const creds = b2CredentialsFromEnv();
	if ("missing" in creds) {
		// Refuse entirely rather than publish half a library: a manifest listing
		// beds that were never uploaded is worse than no manifest.
		console.error(`Publishing needs ${creds.missing.join(", ")}. None of them are optional.`);
		process.exit(1);
	}

	// Uploading to one bucket while recording urls that point at another is the
	// one misconfiguration that produces no error anywhere: the upload succeeds,
	// and the urls 404 exactly as an unpublished library does.
	if (!baseUrlMatchesBucket(creds.credentials.bucketName)) {
		console.error(
			`STOCK_MUSIC_BASE_URL does not point at ${creds.credentials.bucketName}, which is the bucket being uploaded to.`,
		);
		console.error(`It would publish urls under ${musicManifestUrl()} for files written elsewhere.`);
		process.exit(1);
	}

	const sourceDir = resolve(arg("source") ?? "music-source");
	const manifestPath = join(sourceDir, "manifest.json");
	if (!existsSync(manifestPath)) {
		console.error(`No manifest.json in ${sourceDir}. Run: bun run compile:manifest`);
		process.exit(1);
	}
	// SAFETY: the manifest is written by `compile-manifest.ts` from `CompiledTrack` rows.
	const source = JSON.parse(await readFile(manifestPath, "utf8")) as { tracks?: CompiledTrack[] };
	if (!source.tracks?.length) {
		console.error("manifest.json lists no beds.");
		process.exit(1);
	}
	if (!hasAudioTools()) {
		console.warn("ffprobe not found — beds will be published without a duration.\n");
	}

	// Read what is on disk and describe it. No transcoding: the hash is of the
	// bytes that will be uploaded, which are the bytes that were downloaded.
	const prepared: PreparedTrack[] = [];
	let rejected = 0;

	for (const track of source.tracks) {
		if (isCarried(track)) {
			/* `id` comes from `SidecarTrack`'s index signature, so it is `unknown` —
			 * a carried bed whose manifest carries a non-string id would have been
			 * pushed into a `PreparedTrack.id` that must be a string. Falls back to
			 * the slug, which is what an absent id already did. */
			const carriedId =
				typeof track.id === "string" && track.id ? track.id : slug(track.emotion || track.title);
			prepared.push({ ...track, id: carriedId });
			continue;
		}
		const path = join(sourceDir, track.file);
		if (!existsSync(path)) {
			console.warn(`  missing   ${track.file} — listed in the manifest but not in the folder`);
			rejected++;
			continue;
		}
		if (!track.source?.trim() || !track.license?.trim()) {
			console.warn(`  no proof  ${track.file} — needs both source and license`);
			rejected++;
			continue;
		}
		if (!track.tags?.length) {
			console.warn(`  untagged  ${track.file} — will be hard to find; add tags`);
		}

		// Measured, not judged. The resolver PREFERS a bed of a minute or more and
		// falls back to the longest it has, so a short bed is worth having — it is
		// simply picked less often. Refusing one here would have thrown away a
		// track the operator deliberately downloaded.
		const durationSec = hasAudioTools() ? await probeDurationSec(path) : 0;

		const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
		const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
		prepared.push({
			id: slug(track.emotion || track.title),
			// The name it was downloaded as. Unchanged, so the folder, the bucket
			// and the manifest all read the same.
			file: track.file,
			...(track.author ? { author: track.author } : {}),
			localPath: path,
			title: track.title,
			description: track.description ?? "",
			tags: track.tags ?? [],
			...(track.emotion ? { emotion: track.emotion } : {}),
			...(durationSec ? { durationSec: Math.round(durationSec * 100) / 100 } : {}),
			bytes: bytes.byteLength,
			sha256,
			source: track.source,
			license: track.license,
		});
	}

	const { kept, dropped } = dropDuplicateAudio(prepared);
	for (const bed of dropped)
		console.warn(`  duplicate ${bed.file} — byte-identical to a bed already listed, skipping`);
	const tracksToPublish = assignUniqueIds(kept);
	if (rejected || dropped.length) console.warn("");

	// Names are no longer content-addressed, so two different tracks can want the
	// same object. Whichever uploaded second would overwrite the first, and both
	// manifest entries would point at one file — a bed silently replaced by
	// another. Cheap to detect, impossible to notice afterwards.
	const byName = new Map<string, string[]>();
	for (const track of tracksToPublish) {
		if (isCarried(track)) continue;
		const group = byName.get(track.file) ?? [];
		group.push(track.source);
		byName.set(track.file, group);
	}
	const collisions = [...byName].filter(([, sources]) => sources.length > 1);
	if (collisions.length) {
		console.error("Refusing to publish — two beds would upload to the same name:\n");
		for (const [name, sources] of collisions) {
			console.error(`  ${name}`);
			for (const source of sources) console.error(`      ${source}`);
		}
		console.error("\nRename one of the files in music-source and its sidecar, then re-run.");
		process.exit(1);
	}

	// Validate the whole set BEFORE uploading anything. A manifest with a
	// duplicate id would leave one bed permanently unreachable through the emotion
	// lookup, and finding that out after a partial upload means cleaning a bucket
	// by hand.
	const problems = findDuplicates(tracksToPublish);
	if (problems.length) {
		console.error("Refusing to publish — the prepared set has duplicates:\n");
		for (const problem of problems) {
			console.error(`  ${problem.message}`);
			for (const file of problem.files) console.error(`      ${file}`);
		}
		console.error("\nFix music-source/manifest.json and re-run.");
		process.exit(1);
	}

	const auth = await authoriseB2(creds.credentials);

	// Identity is the SOURCE url, not the filename: the filename encodes the
	// normalised bytes, so a re-bake renames the same track and a name-based check
	// would upload a duplicate and orphan the original.
	const published = await fetchPublished();
	const plan = planPublish(tracksToPublish, published);
	console.log(`Plan: ${describePlan(plan)}`);

	const tracks: Array<Record<string, unknown>> = [];
	let uploaded = 0;

	const emit = (track: Record<string, unknown> & { file: string }, url: string): void => {
		const { file: _file, localPath: _localPath, ...rest } = track;
		tracks.push({ ...rest, url });
	};

	for (const { track, url } of plan.unchanged) emit(track, url);

	for (const track of [...plan.added, ...plan.replaced.map((r) => r.track)]) {
		const url = musicBedUrl(track.file);
		const bytes = new Uint8Array(await Bun.file(String(track.localPath)).arrayBuffer());
		await uploadBed(auth, track.file, bytes);
		uploaded++;
		if (!(await reachable(url))) {
			console.error(`  uploaded but not reachable: ${url}`);
			console.error(
				"  Publishing stopped. A url that is not served would be pinned into templates and fail silently later.",
			);
			process.exit(1);
		}
		emit(track, url);
	}

	// A replaced bed now uploads to the SAME url it had, because the name is the
	// operator's rather than a hash of the bytes. planPublish still reports the
	// superseded url as orphaned — true when names were content-addressed, wrong
	// now — so anything still referenced is filtered out before it is reported as
	// prunable. Deleting one of these would break a live bed.
	const live = new Set(tracks.map((track) => String(track.url)));
	const orphaned = plan.orphaned.filter((url) => !live.has(url));

	if (orphaned.length) {
		console.log(`\n${orphaned.length} file(s) left in the bucket with nothing referencing them:`);
		for (const url of orphaned) console.log(`  ${url}`);
		console.log("Harmless, but worth pruning once the library settles.");
	}

	const manifest = { schemaVersion: MUSIC_MANIFEST_VERSION, publishedAt: Date.now(), tracks };
	await uploadToB2(auth, {
		path: `${musicPrefix()}/manifest.json`,
		bytes: new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`),
		contentType: "application/json",
		// The manifest is rewritten in place, so it must not be cached the way a
		// content-hashed bed is.
		cacheControl: "public, max-age=300",
	});

	console.log(
		`\nUploaded ${uploaded}, reused ${plan.unchanged.length}, rejected ${rejected}. ${tracks.length} bed(s) published.`,
	);
	console.log(`Manifest: ${musicManifestUrl()}`);
}

await main();
