/* The traversal guards, tested once instead of asserted twice.
 *
 * This suite is the reason the two copies of `referenceToLocalPath` could be
 * merged: it pins the behaviour both of them had, so a future edit to the single
 * implementation cannot quietly widen what a provider is allowed to read.
 *
 * Every negative case below fails if the corresponding clause is deleted, which
 * is the property that makes them worth having — a guard suite that still passes
 * with the guard removed is decoration. */
import { afterEach, describe, expect, it } from "vite-plus/test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { referenceToLocalPath } from "./paths.ts";

const priorCacheDir = process.env.CACHE_DIR;
const priorUploads = process.env.MALEO_UPLOADS_DIR;
const priorApiUploads = process.env.MALEO_API_UPLOADS_DIR;
const cleanup: string[] = [];

afterEach(async () => {
	for (const [key, value] of [
		["CACHE_DIR", priorCacheDir],
		["MALEO_UPLOADS_DIR", priorUploads],
		["MALEO_API_UPLOADS_DIR", priorApiUploads],
	] as const) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/** A cache dir and an uploads dir, each holding one real file. */
async function sandbox(): Promise<{ cacheDir: string; uploadsDir: string; outside: string }> {
	const root = await mkdtemp(join(tmpdir(), "shared-paths-"));
	cleanup.push(root);
	const cacheDir = join(root, "cache");
	const uploadsDir = join(root, "uploads");
	const secrets = join(root, "secrets");
	for (const dir of [cacheDir, uploadsDir, secrets]) await mkdir(dir, { recursive: true });
	await writeFile(join(cacheDir, "cached.png"), "png");
	await writeFile(join(uploadsDir, "photo.png"), "png");
	// Reachable from uploadsDir by `../secrets/private.png`, so a refusal below is
	// the guard doing its job rather than the file simply not being there.
	await writeFile(join(secrets, "private.png"), "png");
	// Needs percent-decoding to be found at all, which pins decode-then-check
	// ordering: a version that never decodes cannot resolve this.
	await writeFile(join(uploadsDir, "my photo.png"), "png");
	process.env.CACHE_DIR = cacheDir;
	process.env.MALEO_UPLOADS_DIR = uploadsDir;
	delete process.env.MALEO_API_UPLOADS_DIR;
	return { cacheDir, uploadsDir, outside: join(secrets, "private.png") };
}

describe("managed surfaces resolve", () => {
	it("resolves a worker /files/ reference into the cache dir", async () => {
		const { cacheDir } = await sandbox();
		expect(referenceToLocalPath("http://worker.test/files/cached.png")).toBe(
			join(cacheDir, "cached.png"),
		);
	});

	it("resolves the legacy /api/image-gen/files/ prefix too", async () => {
		const { cacheDir } = await sandbox();
		expect(referenceToLocalPath("http://api.test/api/image-gen/files/cached.png")).toBe(
			join(cacheDir, "cached.png"),
		);
	});

	it("resolves an /uploads/ reference into the uploads dir", async () => {
		const { uploadsDir } = await sandbox();
		expect(referenceToLocalPath("https://app.test/uploads/photo.png")).toBe(
			join(uploadsDir, "photo.png"),
		);
	});

	it("resolves an existing absolute path directly", async () => {
		const { outside } = await sandbox();
		// An absolute path the caller already holds is not a managed-surface
		// lookup; the guards below govern URL-shaped references.
		expect(referenceToLocalPath(outside)).toBe(outside);
	});

	it("resolves a file:// URL that exists", async () => {
		const { cacheDir } = await sandbox();
		expect(referenceToLocalPath(`file://${join(cacheDir, "cached.png")}`)).toBe(
			join(cacheDir, "cached.png"),
		);
	});
});

describe("traversal and unmanaged references are refused", () => {
	it("refuses a .. segment in an uploads name", async () => {
		await sandbox();
		expect(referenceToLocalPath("https://app.test/uploads/../secrets/private.png")).toBeNull();
	});

	it("refuses a percent-encoded .. segment that would otherwise reach a real file", async () => {
		await sandbox();
		// `url.pathname` keeps the escapes, so the name is only dangerous once
		// decoded — and decoded it resolves to a file that genuinely exists. The
		// guard is the only thing between this reference and secrets/private.png.
		expect(
			referenceToLocalPath("https://app.test/uploads/%2e%2e%2fsecrets%2fprivate.png"),
		).toBeNull();
	});

	it("decodes before looking up, so an escaped name still resolves", async () => {
		const { uploadsDir } = await sandbox();
		// The counterpart to the case above: the guard must reject traversal
		// without breaking ordinary names that need decoding.
		expect(referenceToLocalPath("https://app.test/uploads/my%20photo.png")).toBe(
			join(uploadsDir, "my photo.png"),
		);
	});

	it("refuses an encoded forward slash, so the name stays a leaf", async () => {
		await sandbox();
		expect(referenceToLocalPath("https://app.test/uploads/nested%2Fphoto.png")).toBeNull();
	});

	it("refuses an encoded backslash", async () => {
		await sandbox();
		expect(referenceToLocalPath("https://app.test/uploads/nested%5Cphoto.png")).toBeNull();
	});

	it("refuses a malformed percent escape rather than throwing", async () => {
		await sandbox();
		expect(referenceToLocalPath("https://app.test/uploads/%E0%A4%A")).toBeNull();
	});

	it("refuses an empty uploads name", async () => {
		await sandbox();
		expect(referenceToLocalPath("https://app.test/uploads/")).toBeNull();
	});

	it("refuses a pathname on no managed surface, even when its basename is cached", async () => {
		await sandbox();
		// `cached.png` DOES exist in the cache dir, so a version that fell back to
		// a basename lookup for unmanaged pathnames would resolve this. Only the
		// prefix check refuses it.
		expect(referenceToLocalPath("https://app.test/private/cached.png")).toBeNull();
		expect(referenceToLocalPath("https://app.test/etc/passwd")).toBeNull();
	});

	it("refuses a managed pathname whose file does not exist", async () => {
		await sandbox();
		expect(referenceToLocalPath("https://app.test/files/missing.png")).toBeNull();
		expect(referenceToLocalPath("https://app.test/uploads/missing.png")).toBeNull();
	});

	it("refuses a non-http, non-file protocol", async () => {
		await sandbox();
		expect(referenceToLocalPath("data:image/png;base64,iVBORw0KGgo=")).toBeNull();
		expect(referenceToLocalPath("ftp://app.test/files/cached.png")).toBeNull();
	});

	it("refuses an absolute path that does not exist and is not managed", async () => {
		await sandbox();
		expect(referenceToLocalPath("/etc/shadow-does-not-exist")).toBeNull();
	});

	it("refuses a file:// URL to a missing file", async () => {
		const { cacheDir } = await sandbox();
		expect(referenceToLocalPath(`file://${join(cacheDir, "absent.png")}`)).toBeNull();
	});
});

describe("uploads roots are honoured in order", () => {
	it("falls back to the API uploads dir when the primary has no match", async () => {
		const { uploadsDir } = await sandbox();
		const apiUploads = await mkdtemp(join(tmpdir(), "api-uploads-"));
		cleanup.push(apiUploads);
		await writeFile(join(apiUploads, "only-here.png"), "png");
		process.env.MALEO_API_UPLOADS_DIR = apiUploads;

		expect(referenceToLocalPath("https://app.test/uploads/only-here.png")).toBe(
			join(apiUploads, "only-here.png"),
		);
		// The primary root still wins for a name both hold.
		expect(referenceToLocalPath("https://app.test/uploads/photo.png")).toBe(
			join(uploadsDir, "photo.png"),
		);
	});
});

/* The API writes uploads to its OWN package directory, not the repo root, and
 * this process has to read them from there. The two halves named the same
 * `/uploads/<name>` URL and meant different folders until that root was added,
 * so a cloned voice's recording resolved to nothing and synthesis refused a
 * reference the API had just written. */
describe("the API's own uploads directory is reachable", () => {
	it("resolves a file the API wrote under apps/api/public/uploads", async () => {
		const dir = fileURLToPath(new URL("../../../../../apps/api/public/uploads/", import.meta.url));
		await mkdir(dir, { recursive: true });
		const name = `paths-test-${Date.now()}.wav`;
		const path = join(dir, name);
		await writeFile(path, "wav");
		try {
			expect(referenceToLocalPath(`/uploads/${name}`)).toBe(path);
		} finally {
			await rm(path, { force: true });
		}
	});

	it("still refuses to climb out of it", () => {
		expect(referenceToLocalPath("/uploads/../../../../etc/passwd")).toBeNull();
		expect(referenceToLocalPath("/uploads/%2e%2e%2fetc%2fpasswd")).toBeNull();
	});
});
