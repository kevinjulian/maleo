/* The published music library's contract.
 *
 * The manifest outlives the code that writes it — a library published today is
 * read by whatever ships next year — so it carries a schema version and is
 * validated on read rather than trusted.
 *
 * Every bed records where it came from and under what licence. That is not
 * bookkeeping: it is what answers a Content ID claim, and it is why a bed
 * missing either is refused rather than indexed with a gap. */

/** Bumped only when the shape changes incompatibly. A reader that does not
 *  recognise the version refuses the whole manifest instead of picking out the
 *  fields it happens to understand. */
export const MUSIC_MANIFEST_VERSION = 1;

export interface MusicBed {
	id: string;
	/** Who made it. Optional because the first published beds predate its
	 *  capture, but it is what a Content ID dispute is answered with alongside
	 *  the licence. */
	author?: string;
	/** Absolute, public, non-expiring. Template rows persist this indefinitely. */
	url: string;
	title: string;
	description: string;
	tags: string[];
	/** Emotion this bed scores, when it was curated for one. */
	emotion?: string;
	durationSec: number;
	bytes?: number;
	/** Hash of the normalised bytes; also the basis of the filename. */
	sha256?: string;
	source: string;
	license: string;
}

export interface MusicManifest {
	schemaVersion: number;
	publishedAt?: number;
	tracks: MusicBed[];
}

/* Where the library is served from.
 *
 * B2's friendly download url is
 *
 *   <host>/file/<bucket-name>/<prefix>/<file>
 *
 * and a Cloudflare custom domain in front of the bucket keeps that shape. None
 * of it is derivable: b2_authorize_account reports B2's own download host, and
 * nothing in the API knows the custom domain.
 *
 * The bucket is read from B2_BUCKET_NAME — the same variable publishing uses to
 * decide where to UPLOAD. That is the point: two copies of a bucket name is one
 * copy too many, and if they ever drifted the app would read from a bucket
 * nothing was written to. This failure is silent, because a wrong base still
 * answers 404 and a 404 is how an unpublished library looks.
 *
 * Every part keeps a default, so a deployment that sets none of them still
 * resolves to the live library. An environment variable can then correct any
 * piece without a release, and STOCK_MUSIC_BASE_URL replaces the lot for a
 * staging bucket somewhere else entirely. */
// Declared in @maleo/shared so the web app can read it without depending on
// this (server) package; re-exported here so every existing caller resolves.
export { MUSIC_PUBLIC_HOST } from "@maleo/shared";
import { MUSIC_PUBLIC_HOST } from "@maleo/shared";
export const MUSIC_BUCKET = "example-bucket";
export const MUSIC_PREFIX_DEFAULT = "music";

const env = (name: string): string | undefined => process.env[name]?.trim() || undefined;

export function musicHost(): string {
	return (env("STOCK_MUSIC_HOST") ?? MUSIC_PUBLIC_HOST).replace(/\/+$/, "");
}

export function musicBucket(): string {
	return (env("B2_BUCKET_NAME") ?? MUSIC_BUCKET).replace(/^\/+|\/+$/g, "");
}

/** The folder inside the bucket. Read and write derive it from the same call,
 *  so they cannot disagree within one process — but they are different
 *  processes on different machines, which is why publishing verifies that what
 *  it uploaded is actually reachable at the url it is about to record. */
export function musicPrefix(): string {
	return (env("STOCK_MUSIC_PREFIX") ?? MUSIC_PREFIX_DEFAULT).replace(/^\/+|\/+$/g, "");
}

/** Kept as a constant for callers that want the shipped default rather than
 *  what this environment happens to say. */
export const MUSIC_PUBLIC_BASE_URL = `${MUSIC_PUBLIC_HOST}/file/${MUSIC_BUCKET}`;

export function musicBaseUrl(): string {
	const whole = env("STOCK_MUSIC_BASE_URL");
	if (whole) return whole.replace(/\/+$/, "");
	return `${musicHost()}/file/${musicBucket()}`;
}

export function musicManifestUrl(): string {
	return `${musicBaseUrl()}/${musicPrefix()}/manifest.json`;
}

export function musicBedUrl(filename: string): string {
	// Encoded per segment: the name is whatever the file was called when it was
	// downloaded, and a space or an accent in it would otherwise produce a url
	// that resolves for nobody. Ordinary slug characters pass through untouched.
	return `${musicBaseUrl()}/${musicPrefix()}/${encodeURIComponent(filename)}`;
}

/** Does the base actually point at the bucket being written to?
 *
 *  Only publishing can ask this, because only publishing knows both. A full
 *  STOCK_MUSIC_BASE_URL override that names a different bucket is the one way
 *  to upload to one place and record urls pointing at another — and the result
 *  reads as an unpublished library rather than as an error. */
export function baseUrlMatchesBucket(bucketName: string): boolean {
	if (!env("STOCK_MUSIC_BASE_URL")) return true;
	return musicBaseUrl().replace(/\/+$/, "").endsWith(`/${bucketName}`);
}

function isNonEmpty(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

/** Parse a manifest, or throw with the reason. Callers that must not fail
 *  generation catch this and fall back to a retained copy. */
export function parseMusicManifest(raw: unknown): MusicManifest {
	if (!raw || typeof raw !== "object") throw new Error("manifest is not an object");
	const value = raw as Partial<MusicManifest>;
	if (value.schemaVersion !== MUSIC_MANIFEST_VERSION) {
		throw new Error(
			`unsupported manifest schemaVersion ${String(value.schemaVersion)}, expected ${MUSIC_MANIFEST_VERSION}`,
		);
	}
	if (!Array.isArray(value.tracks)) throw new Error("manifest has no tracks array");

	const tracks = value.tracks.map((track, index): MusicBed => {
		const bed = track as Partial<MusicBed>;
		if (!isNonEmpty(bed.id)) throw new Error(`track ${index} has no id`);
		if (!isNonEmpty(bed.url)) throw new Error(`track ${bed.id} has no url`);
		// Provenance is mandatory. A bed nobody can trace is a bed nobody can defend.
		if (!isNonEmpty(bed.source)) throw new Error(`track ${bed.id} has no source`);
		if (!isNonEmpty(bed.license)) throw new Error(`track ${bed.id} has no license`);
		return {
			id: bed.id,
			url: bed.url,
			title: isNonEmpty(bed.title) ? bed.title : bed.id,
			description: typeof bed.description === "string" ? bed.description : "",
			tags: Array.isArray(bed.tags) ? bed.tags.filter(isNonEmpty) : [],
			...(isNonEmpty(bed.emotion) ? { emotion: bed.emotion } : {}),
			durationSec: typeof bed.durationSec === "number" ? bed.durationSec : 0,
			...(typeof bed.bytes === "number" ? { bytes: bed.bytes } : {}),
			...(isNonEmpty(bed.sha256) ? { sha256: bed.sha256 } : {}),
			source: bed.source,
			license: bed.license,
		};
	});
	return { schemaVersion: value.schemaVersion, publishedAt: value.publishedAt, tracks };
}
