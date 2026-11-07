import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { materializeManagedInputs } from "./managed-inputs";

const before = {
	cwd: process.cwd(),
	api: process.env.MALEO_API_URL,
	token: process.env.MALEO_SERVICE_TOKEN,
	public: process.env.MALEO_VIDEO_PUBLIC_BASE,
};
let dir: string | null = null;
afterEach(async () => {
	process.chdir(before.cwd);
	if (dir) await rm(dir, { recursive: true, force: true });
	for (const [key, value] of [
		["MALEO_API_URL", before.api],
		["MALEO_SERVICE_TOKEN", before.token],
		["MALEO_VIDEO_PUBLIC_BASE", before.public],
	] as const) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

test("render fetches managed bytes with workspace scope and removes temporary copy", async () => {
	dir = await mkdtemp(join(tmpdir(), "maleo-video-media-test-"));
	process.chdir(dir);
	process.env.MALEO_API_URL = "http://api.invalid";
	process.env.MALEO_SERVICE_TOKEN = "secret";
	process.env.MALEO_VIDEO_PUBLIC_BASE = "http://video.invalid/public";
	const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
	let calls = 0;
	const result = await materializeManagedInputs(
		{ scenes: [{ image: `/api/media/${id}` }], external: "https://example.invalid/stock.jpg" },
		"team",
		async (url, init) => {
			calls++;
			expect(url.toString()).toContain(`workspace=team`);
			expect(init?.headers).toEqual({ authorization: "Bearer secret" });
			return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
		},
	);
	expect(calls).toBe(1);
	expect(result.value.external).toBe("https://example.invalid/stock.jpg");
	const rendered = result.value.scenes[0]!.image;
	expect(rendered).toStartWith("http://video.invalid/public/render-inputs/");
	const local = join(dir, "public", new URL(rendered).pathname.replace(/^\/public\//, ""));
	expect(new Uint8Array(await Bun.file(local).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
	// A value derived from the live input (a prepared storyboard) gets the stable URLs back.
	expect(result.restore({ prepared: [rendered, "keep"] })).toEqual({
		prepared: [`/api/media/${id}`, "keep"],
	});
	await result.cleanup();
	expect(await Bun.file(local).exists()).toBe(false);
});

test("managed bytes that differ from the registry SHA-256 fail before any render and leave no copy", async () => {
	dir = await mkdtemp(join(tmpdir(), "maleo-video-media-test-"));
	process.chdir(dir);
	process.env.MALEO_API_URL = "http://api.invalid";
	process.env.MALEO_SERVICE_TOKEN = "secret";
	process.env.MALEO_VIDEO_PUBLIC_BASE = "http://video.invalid/public";
	const id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
	await expect(
		materializeManagedInputs(
			{ image: `/api/media/${id}` },
			"team",
			async () =>
				new Response(new Uint8Array([1, 2, 3]), {
					headers: { "content-type": "image/png", "x-maleo-sha256": "0".repeat(64) },
				}),
		),
	).rejects.toThrow(`managed render input ${id} failed its SHA-256 check`);
	expect(await readdir(join(dir, "public", "render-inputs"))).toEqual([]);
});

test("managed bytes that match the registry SHA-256 are used", async () => {
	dir = await mkdtemp(join(tmpdir(), "maleo-video-media-test-"));
	process.chdir(dir);
	process.env.MALEO_API_URL = "http://api.invalid";
	process.env.MALEO_SERVICE_TOKEN = "secret";
	process.env.MALEO_VIDEO_PUBLIC_BASE = "http://video.invalid/public";
	const bytes = new Uint8Array([1, 2, 3]);
	const sha = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
	const result = await materializeManagedInputs(
		{ image: "/api/media/dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
		"team",
		async () =>
			new Response(bytes, {
				headers: { "content-type": "image/png", "x-maleo-sha256": sha.toUpperCase() },
			}),
	);
	expect(result.value.image).toStartWith("http://video.invalid/public/render-inputs/");
	await result.cleanup();
});

test("missing managed object fails render input prep", async () => {
	dir = await mkdtemp(join(tmpdir(), "maleo-video-media-test-"));
	process.chdir(dir);
	process.env.MALEO_API_URL = "http://api.invalid";
	process.env.MALEO_SERVICE_TOKEN = "secret";
	process.env.MALEO_VIDEO_PUBLIC_BASE = "http://video.invalid/public";
	await expect(
		materializeManagedInputs(
			{ audioUrl: "/api/media/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
			"team",
			async () => new Response(null, { status: 404 }),
		),
	).rejects.toThrow("unavailable (404)");
});

test.each(["headers", "body"])(
	"stalled managed input %s times out and removes scratch",
	async (stage) => {
		dir = await mkdtemp(join(tmpdir(), "maleo-video-media-test-"));
		process.chdir(dir);
		const server = Bun.serve({
			port: 0,
			fetch: () =>
				stage === "headers"
					? new Promise<Response>(() => {})
					: new Response(
							new ReadableStream({
								start(controller) {
									controller.enqueue(new Uint8Array([1]));
								},
							}),
						),
		});
		process.env.MALEO_API_URL = server.url.toString();
		process.env.MALEO_SERVICE_TOKEN = "secret";
		process.env.MALEO_VIDEO_PUBLIC_BASE = "http://video.invalid/public";
		const timeout = AbortSignal.timeout.bind(AbortSignal);
		const deadline = spyOn(AbortSignal, "timeout").mockImplementation(() => timeout(50));
		try {
			await expect(
				materializeManagedInputs(
					{ image: "/api/media/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
					"team",
				),
			).rejects.toThrow();
			expect(deadline).toHaveBeenCalledWith(120_000);
			expect(await readdir(join(dir, "public/render-inputs"))).toEqual([]);
		} finally {
			deadline.mockRestore();
			void server.stop(true);
		}
	},
);
