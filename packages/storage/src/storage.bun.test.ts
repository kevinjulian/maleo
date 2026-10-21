import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	assertMediaStorageConfigured,
	deleteMedia,
	getMedia,
	MediaObjectMissingError,
	listMedia,
	mediaDisposition,
	putMedia,
	verifyMediaStorageReady,
} from "./storage.ts";

const oldCwd = process.cwd();
const oldBackend = process.env.MALEO_MEDIA_STORAGE_BACKEND;
const oldDataDir = process.env.MALEO_DATA_DIR;
const oldNodeEnv = process.env.NODE_ENV;
const s3Vars = [
	"MALEO_MEDIA_S3_BUCKET",
	"MALEO_MEDIA_S3_ENDPOINT",
	"MALEO_MEDIA_S3_PUBLIC_ENDPOINT",
	"MALEO_MEDIA_S3_REGION",
	"MALEO_MEDIA_S3_ACCESS_KEY_ID",
	"MALEO_MEDIA_S3_SECRET_ACCESS_KEY",
] as const;
const oldS3 = Object.fromEntries(s3Vars.map((key) => [key, process.env[key]]));
let root: string | undefined;

afterEach(async () => {
	process.chdir(oldCwd);
	if (oldBackend === undefined) delete process.env.MALEO_MEDIA_STORAGE_BACKEND;
	else process.env.MALEO_MEDIA_STORAGE_BACKEND = oldBackend;
	process.env.MALEO_DATA_DIR = oldDataDir ?? join(tmpdir(), "maleo-test-data-fallback");
	if (oldNodeEnv === undefined) delete process.env.NODE_ENV;
	else process.env.NODE_ENV = oldNodeEnv;
	for (const key of s3Vars) {
		if (oldS3[key] === undefined) delete process.env[key];
		else process.env[key] = oldS3[key];
	}
	if (root) await rm(root, { recursive: true, force: true });
});

test("configured but unreachable S3 fails without writing a local copy", async () => {
	root = await mkdtemp(join(tmpdir(), "maleo-media-s3-failure-"));
	process.env.MALEO_DATA_DIR = root;
	process.env.MALEO_MEDIA_STORAGE_BACKEND = "s3";
	process.env.MALEO_MEDIA_S3_BUCKET = "test";
	process.env.MALEO_MEDIA_S3_ENDPOINT = "http://127.0.0.1:9";
	process.env.MALEO_MEDIA_S3_PUBLIC_ENDPOINT = "http://127.0.0.1:9";
	process.env.MALEO_MEDIA_S3_REGION = "us-east-1";
	process.env.MALEO_MEDIA_S3_ACCESS_KEY_ID = "test";
	process.env.MALEO_MEDIA_S3_SECRET_ACCESS_KEY = "test";
	assertMediaStorageConfigured();
	await expect(verifyMediaStorageReady()).rejects.toThrow();
	expect(
		putMedia({
			workspace: "one",
			kind: "image",
			body: new Uint8Array([1]),
			contentType: "image/png",
		}),
	).rejects.toThrow();
	expect(await Bun.file(join(root, "media", "workspaces", "b25l", "image")).exists()).toBe(false);
});

test("local media uses MALEO_DATA_DIR from another cwd and deduplicates by workspace", async () => {
	root = await mkdtemp(join(tmpdir(), "maleo-media-storage-"));
	process.env.MALEO_MEDIA_STORAGE_BACKEND = "local";
	process.env.MALEO_DATA_DIR = join(root, "data");
	await verifyMediaStorageReady();
	process.chdir(root);
	const body = new Blob(["bytes"], { type: "audio/mpeg" });
	const first = await putMedia({
		workspace: "one",
		kind: "audio",
		body,
		contentType: body.type,
		project: "proj-1",
		filename: "take one.mp3",
	});
	const repeat = await putMedia({
		workspace: "one",
		kind: "audio",
		body,
		contentType: body.type,
		project: "proj-1",
		filename: "take one.mp3",
	});
	const other = await putMedia({ workspace: "two", kind: "audio", body, contentType: body.type });
	// Keys group by workspace, then kind, then project, and end in a readable name.
	expect(first.key).toMatch(/^workspaces\/one\/audio\/proj-1\/[0-9a-f-]{36}-take_one\.mp3$/);
	// Workspace-level media omits the project segment; the name comes from the kind.
	expect(other.key).toMatch(/^workspaces\/two\/audio\/[0-9a-f-]{36}-audio\.mp3$/);
	// Each write is its own object, so deleting one cannot take the other's bytes.
	expect(first.key).not.toBe(repeat.key);
	expect(first.hash).toBe(repeat.hash);
	expect(first.hash).toHaveLength(64);
	expect(await Bun.file(join(root, "data", "media", first.key)).text()).toBe("bytes");
	expect(await (await getMedia(first.key)).text()).toBe("bytes");
	await deleteMedia(first.key);
	await expect(getMedia(first.key)).rejects.toBeInstanceOf(MediaObjectMissingError);
	expect(await (await getMedia(repeat.key)).text()).toBe("bytes");
	expect(await (await getMedia(other.key)).text()).toBe("bytes");
});

test("an owner that is not one path segment fails the write", async () => {
	root = await mkdtemp(join(tmpdir(), "maleo-media-owner-"));
	process.env.MALEO_MEDIA_STORAGE_BACKEND = "local";
	process.env.MALEO_DATA_DIR = join(root, "data");
	const body = new Uint8Array([1]);
	const write = (workspace: string, project?: string) =>
		putMedia({ workspace, project, kind: "image", body, contentType: "image/png" });
	/* Validated, not sanitized. Rewriting "a/b" into "a_b" is not injective, so
	 * two workspaces could land on one prefix and a delete for one would take the
	 * other's bytes. Refusing is the only safe answer. */
	for (const bad of ["../escape", "a/b", "team one", ""]) {
		expect(write(bad)).rejects.toThrow(/workspace/);
	}
	expect(write("team", "../escape")).rejects.toThrow(/project/);
	// Nothing reached disk under a rewritten name.
	expect(await Array.fromAsync(listMedia())).toEqual([]);
});

test("only non-executable rendered media is served inline", () => {
	for (const type of [
		"image/png",
		"image/jpeg",
		"audio/mpeg",
		"video/mp4",
		"IMAGE/PNG",
		"audio/wav; codecs=1",
	]) {
		expect(mediaDisposition(type)).toBe("inline");
	}
	// SVG is an image that carries script; HTML and unknown bytes download too.
	for (const type of [
		"image/svg+xml",
		"text/html",
		"application/json",
		"application/octet-stream",
	]) {
		expect(mediaDisposition(type)).toBe("attachment");
	}
});

test("listing a store that was never written to yields nothing", async () => {
	root = await mkdtemp(join(tmpdir(), "maleo-media-empty-"));
	process.env.MALEO_MEDIA_STORAGE_BACKEND = "local";
	process.env.MALEO_DATA_DIR = join(root, "never-written");
	expect(await Array.fromAsync(listMedia())).toEqual([]);
});

test("local backend is explicit and refused in production", async () => {
	delete process.env.MALEO_MEDIA_STORAGE_BACKEND;
	expect(
		putMedia({
			workspace: "one",
			kind: "file",
			body: new Uint8Array([1]),
			contentType: "application/octet-stream",
		}),
	).rejects.toThrow("not configured");
	process.env.MALEO_MEDIA_STORAGE_BACKEND = "local";
	process.env.NODE_ENV = "production";
	expect(
		putMedia({
			workspace: "one",
			kind: "file",
			body: new Uint8Array([1]),
			contentType: "application/octet-stream",
		}),
	).rejects.toThrow("not configured");
});
