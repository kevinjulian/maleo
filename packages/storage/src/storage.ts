import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { S3Client } from "bun";

export type MediaKind = "image" | "audio" | "video" | "manifest" | "file";

export interface StoredMedia {
	key: string;
	hash: string;
	size: number;
	contentType: string;
}

/* workspaces/<workspace>/<kind>/<project>/<uuid>-<filename>, project omitted for
 * workspace-level media. The uuid makes every write its own object; the filename
 * makes a bucket listing answer "whose is this and what is it" without a join. */
const KEY =
	/^workspaces\/[A-Za-z0-9_-]+\/(image|audio|video|manifest|file)\/([A-Za-z0-9_-]+\/)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9_.-]{1,100}$/;
/* An owner segment goes into a path, so it has to be exactly one segment. These
 * are validated, never sanitized: sanitizing is not injective, and two owners
 * collapsing onto one prefix would let a delete for one take the other's bytes.
 * Workspace names are already constrained to this shape (workspace/paths.ts). */
const SEGMENT = /^[A-Za-z0-9_-]+$/;
const REPO_DATA_DIR = fileURLToPath(new URL("../../../data/", import.meta.url));

const EXTENSION: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
	"image/avif": "avif",
	"image/gif": "gif",
	"image/svg+xml": "svg",
	"audio/mpeg": "mp3",
	"audio/wav": "wav",
	"audio/ogg": "ogg",
	"audio/mp4": "m4a",
	"video/mp4": "mp4",
	"video/webm": "webm",
	"application/json": "json",
};

/** Keep a filename usable as one path segment; fall back to the content type. */
export function mediaFilename(
	name: string | undefined,
	kind: MediaKind,
	contentType: string,
): string {
	const base = (name ?? "").split(/[\\/]/).pop() ?? "";
	const safe = base
		.replace(/[^A-Za-z0-9_.-]+/g, "_")
		.replace(/^[._]+/, "")
		.slice(-100);
	if (safe && safe !== "." && safe !== "..") return safe;
	return `${kind}.${EXTENSION[contentType.split(";")[0]!.trim().toLowerCase()] ?? "bin"}`;
}

export function mediaObjectKey(input: {
	workspace: string;
	kind: MediaKind;
	project?: string | null;
	filename: string;
}): string {
	for (const [label, value] of [
		["workspace", input.workspace],
		["project", input.project],
	] as const) {
		if (value != null && !SEGMENT.test(value))
			throw new Error(`media storage ${label} is not usable as one path segment`);
	}
	if (!input.workspace) throw new Error("media storage needs an owning workspace");
	const owner = input.project ? `${input.project}/` : "";
	const key = `workspaces/${input.workspace}/${input.kind}/${owner}${randomUUID()}-${input.filename}`;
	if (!KEY.test(key)) throw new Error("media storage key is malformed");
	return key;
}

function localRoot(): string {
	return join(resolve(process.env.MALEO_DATA_DIR?.trim() || REPO_DATA_DIR), "media");
}

export function mediaStorageMode(): "local" | "s3" {
	const selected = process.env.MALEO_MEDIA_STORAGE_BACKEND?.trim();
	if (selected === "local" && process.env.NODE_ENV !== "production") return "local";
	if (selected === "s3") return "s3";
	throw new Error(
		"media storage is not configured: select s3 in production or explicit local in development",
	);
}

const S3_ENV = [
	"MALEO_MEDIA_S3_BUCKET",
	"MALEO_MEDIA_S3_ENDPOINT",
	"MALEO_MEDIA_S3_PUBLIC_ENDPOINT",
	"MALEO_MEDIA_S3_REGION",
	"MALEO_MEDIA_S3_ACCESS_KEY_ID",
	"MALEO_MEDIA_S3_SECRET_ACCESS_KEY",
	"MALEO_MEDIA_URL_LIFETIME_SECONDS",
	"MALEO_MEDIA_EXTERNAL_URL_LIFETIME_SECONDS",
] as const;

interface S3Config {
	internal: S3Client;
	public: S3Client;
	lifetime: number;
	externalLifetime: number;
}

/* Two clients and a parsed config per call would run on every read of every
 * asset. Cached on the env values themselves rather than on first call, so a
 * test that swaps backends mid-process still gets the config it just set. */
let cached: { signature: string; config: S3Config } | undefined;

function positiveSeconds(raw: string | undefined, fallback: number): number {
	const value = raw?.trim() ? Number(raw) : fallback;
	if (!Number.isInteger(value) || value < 1)
		throw new Error("media storage URL lifetime must be a positive whole number of seconds");
	return value;
}

function s3Clients(): S3Config {
	const signature = S3_ENV.map((key) => `${key}=${process.env[key] ?? ""}`).join("\n");
	if (cached?.signature === signature) return cached.config;
	const bucket = process.env.MALEO_MEDIA_S3_BUCKET?.trim();
	const endpoint = process.env.MALEO_MEDIA_S3_ENDPOINT?.trim();
	const publicEndpoint = process.env.MALEO_MEDIA_S3_PUBLIC_ENDPOINT?.trim();
	const region = process.env.MALEO_MEDIA_S3_REGION?.trim();
	const accessKeyId = process.env.MALEO_MEDIA_S3_ACCESS_KEY_ID?.trim();
	const secretAccessKey = process.env.MALEO_MEDIA_S3_SECRET_ACCESS_KEY?.trim();
	if (!bucket || !endpoint || !publicEndpoint || !region || !accessKeyId || !secretAccessKey) {
		throw new Error("media storage S3 configuration is incomplete");
	}
	const lifetime = positiveSeconds(process.env.MALEO_MEDIA_URL_LIFETIME_SECONDS, 300);
	// External providers hold a URL across their own queue, so they need a longer
	// one than a browser that can always reload the stable route.
	const externalLifetime = positiveSeconds(
		process.env.MALEO_MEDIA_EXTERNAL_URL_LIFETIME_SECONDS,
		3600,
	);
	for (const value of [endpoint, publicEndpoint]) {
		const url = new URL(value);
		if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
			throw new Error("invalid media storage endpoint");
	}
	const common = { bucket, region, accessKeyId, secretAccessKey };
	const config: S3Config = {
		internal: new S3Client({ ...common, endpoint }),
		public: new S3Client({ ...common, endpoint: publicEndpoint }),
		lifetime,
		externalLifetime,
	};
	cached = { signature, config };
	return config;
}

/** Lifetime for a URL handed to an external provider rather than a browser. */
export function externalMediaUrlLifetimeSeconds(): number {
	return mediaStorageMode() === "s3"
		? s3Clients().externalLifetime
		: positiveSeconds(process.env.MALEO_MEDIA_EXTERNAL_URL_LIFETIME_SECONDS, 3600);
}

export function assertMediaStorageConfigured(): void {
	if (mediaStorageMode() === "s3") s3Clients();
}

/** Startup gate: bucket, credentials, and service endpoint must already work. */
export async function verifyMediaStorageReady(): Promise<void> {
	if (mediaStorageMode() === "s3")
		await s3Clients().internal.list({ prefix: "workspaces/", maxKeys: 1 });
}

function localPath(key: string): string {
	if (!KEY.test(key)) throw new Error("invalid media storage key");
	return join(localRoot(), key);
}

/* Inline is allowed only for media a page renders and a browser cannot execute.
 * SVG is an image that carries script, so it downloads instead — opening a
 * presigned URL for one would otherwise run its script on the storage origin. */
const INLINE_TYPE = /^(image\/(png|jpeg|gif|webp|avif)|audio\/[\w.+-]+|video\/[\w.+-]+)$/;

export function mediaDisposition(contentType: string): "inline" | "attachment" {
	return INLINE_TYPE.test(contentType.split(";")[0]!.trim().toLowerCase())
		? "inline"
		: "attachment";
}

async function digest(body: Blob | Uint8Array): Promise<string> {
	const hash = createHash("sha256");
	if (body instanceof Uint8Array) hash.update(body);
	else {
		const reader = body.stream().getReader();
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				hash.update(value);
			}
		} finally {
			reader.releaseLock();
		}
	}
	return hash.digest("hex");
}

export async function putMedia(input: {
	workspace: string;
	kind: MediaKind;
	body: Blob | Uint8Array;
	contentType: string;
	/** The owning project, when the media belongs to one rather than the library. */
	project?: string | null;
	/** Shown in a bucket listing; derived from kind and content type when absent. */
	filename?: string;
}): Promise<StoredMedia> {
	const selected = mediaStorageMode();
	/* Recorded, not identity. The key is unique per write, so this no longer
	 * addresses the object; it still validates metadata that crosses a service
	 * boundary and leaves a later dedup pass possible. */
	const hash = await digest(input.body);
	const key = mediaObjectKey({
		workspace: input.workspace,
		kind: input.kind,
		project: input.project,
		filename: mediaFilename(input.filename, input.kind, input.contentType),
	});
	const size = input.body instanceof Blob ? input.body.size : input.body.byteLength;
	if (selected === "s3") {
		// No exists check: the uuid means this key is new, so a HEAD could only
		// ever answer "no" and would cost a round-trip on every write.
		await s3Clients().internal.write(key, input.body, {
			type: input.contentType,
			contentDisposition: mediaDisposition(input.contentType),
		});
		return { key, hash, size, contentType: input.contentType };
	}
	const path = localPath(key);
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		await Bun.write(temporary, input.body);
		await rename(temporary, path);
	} finally {
		await rm(temporary, { force: true });
	}
	return { key, hash, size, contentType: input.contentType };
}

export class MediaObjectMissingError extends Error {
	constructor(key: string) {
		super(`media storage object missing: ${key}`);
		this.name = "MediaObjectMissingError";
	}
}

export async function getMedia(key: string): Promise<Blob> {
	if (!KEY.test(key)) throw new Error("invalid media storage key");
	if (mediaStorageMode() === "s3") {
		const file = s3Clients().internal.file(key);
		if (!(await file.exists())) throw new MediaObjectMissingError(key);
		/* An S3File's `size` is NaN until stat'd. Every caller compares it with a
		 * recorded size or sends it as Content-Length, so return a bounded slice
		 * that knows its size and still streams lazily. */
		return file.slice(0, (await file.stat()).size);
	}
	const file = Bun.file(localPath(key));
	if (!(await file.exists())) throw new MediaObjectMissingError(key);
	return file;
}

export async function deleteMedia(key: string): Promise<void> {
	if (!KEY.test(key)) throw new Error("invalid media storage key");
	if (mediaStorageMode() === "s3") {
		await s3Clients().internal.delete(key);
		return;
	}
	await rm(localPath(key), { force: true });
}

/** Inventory store bytes, including writes that never reached the registry. */
export async function* listMedia(): AsyncGenerator<{ key: string; modifiedAt: number }> {
	if (mediaStorageMode() === "s3") {
		const client = s3Clients().internal;
		let continuationToken: string | undefined;
		do {
			const page = await client.list({ prefix: "workspaces/", maxKeys: 1000, continuationToken });
			for (const entry of page.contents ?? []) {
				if (KEY.test(entry.key))
					yield {
						key: entry.key,
						modifiedAt: entry.lastModified ? Date.parse(entry.lastModified) : NaN,
					};
			}
			if (page.isTruncated && !page.nextContinuationToken)
				throw new Error("media storage listing was truncated without continuation");
			continuationToken = page.nextContinuationToken;
		} while (continuationToken);
		return;
	}
	const root = localRoot();
	const visit = async function* (dir: string): AsyncGenerator<{ key: string; modifiedAt: number }> {
		/* A store that has never been written to holds no objects. Only that case
		 * is tolerated — any other listing failure must still abort the caller,
		 * because cleanup treats a complete inventory as permission to delete. */
		let entries: Dirent[];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch (error) {
			// SAFETY: a caught value is `unknown`; this reads one optional property
			// off it and compares, so a thrown non-object simply fails the test and
			// rethrows. No property is accessed on the result.
			if (dir === root && (error as { code?: string }).code === "ENOENT") return;
			throw error;
		}
		for (const entry of entries) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) yield* visit(path);
			else if (entry.isFile()) {
				const key = relative(root, path).split(sep).join("/");
				if (KEY.test(key)) yield { key, modifiedAt: (await stat(path)).mtimeMs };
			}
		}
	};
	yield* visit(root);
}

/** A null address means the API serves the bytes from this backend. */
export function addressMedia(
	key: string,
	method: "GET" | "HEAD" = "GET",
	lifetimeSeconds?: number,
): string | null {
	if (!KEY.test(key)) throw new Error("invalid media storage key");
	if (mediaStorageMode() === "s3") {
		const { public: client, lifetime } = s3Clients();
		return client.presign(key, { expiresIn: lifetimeSeconds ?? lifetime, method });
	}
	return null;
}
