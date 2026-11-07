import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveRustInputs } from "./rust-inputs";

const BASE = "http://127.0.0.1:8091/public";
let dir: string | null = null;
afterEach(async () => {
	if (dir) await rm(dir, { recursive: true, force: true });
});

async function publicDir(): Promise<string> {
	dir = await mkdtemp(join(tmpdir(), "maleo-rust-inputs-"));
	const pub = join(dir, "public");
	await mkdir(join(pub, "render-inputs", "job-1"), { recursive: true });
	await writeFile(join(pub, "render-inputs", "job-1", "a.png"), "png");
	return pub;
}

test("public-base, data and external URLs become local files; scratch goes on cleanup", async () => {
	const pub = await publicDir();
	const server = Bun.serve({
		port: 0,
		fetch: () => new Response("stock-bytes", { headers: { "content-length": "11" } }),
	});
	try {
		const external = `http://127.0.0.1:${server.port}/stock/clip.mp4?sig=1`;
		const result = await resolveRustInputs(
			[`${BASE}/render-inputs/job-1/a.png`, "data:text/plain;base64,aGk=", external],
			{ publicBase: BASE, publicDir: pub },
		);
		expect(result.media[`${BASE}/render-inputs/job-1/a.png`]).toBe(
			join(pub, "render-inputs", "job-1", "a.png"),
		);
		expect(await Bun.file(result.media["data:text/plain;base64,aGk="]!).text()).toBe("hi");
		expect(result.media[external]).toEndWith(".mp4");
		expect(await Bun.file(result.media[external]!).text()).toBe("stock-bytes");
		await result.cleanup();
		expect(await readdir(join(pub, "rust-inputs"))).toEqual([]);
		// The managed input itself belongs to its own cleanup.
		expect(await Bun.file(join(pub, "render-inputs", "job-1", "a.png")).exists()).toBe(true);
	} finally {
		void server.stop(true);
	}
});

test.each([
	[`${BASE}/../secret.txt`, "leaves the public directory"],
	[`${BASE}/render-inputs/job-1/missing.png`, "is not a local file"],
	["media/relative.png", "has no local file"],
])("refuses %s and removes scratch", async (url, message) => {
	const pub = await publicDir();
	await expect(resolveRustInputs([url], { publicBase: BASE, publicDir: pub })).rejects.toThrow(
		message,
	);
	expect(await readdir(join(pub, "rust-inputs"))).toEqual([]);
});

test("an unavailable external input fails with its status", async () => {
	const pub = await publicDir();
	await expect(
		resolveRustInputs(["https://stock.invalid/x.jpg"], {
			publicBase: BASE,
			publicDir: pub,
			fetchImpl: async () => new Response(null, { status: 403 }),
		}),
	).rejects.toThrow("unavailable (403)");
});
