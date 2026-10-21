import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deleteMedia, getMedia, putMedia } from "@maleo/storage";

const endpoint = process.env.MALEO_MEDIA_TEST_ENDPOINT;
const run = endpoint ? test : test.skip;

run(
	"render output survives video service restart in private object storage",
	async () => {
		const root = await mkdtemp(join(tmpdir(), "maleo-render-minio-"));
		const port = 19091;
		const base = `http://127.0.0.1:${port}`;
		const token = "render-storage-smoke";
		const mediaId = crypto.randomUUID();
		const workspace = "render-test";
		let inputReads = 0;
		let inputKey: string | undefined;
		const inputServer = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			async fetch(request) {
				const url = new URL(request.url);
				if (
					url.pathname !== `/internal/media/${mediaId}` ||
					url.searchParams.get("workspace") !== workspace ||
					request.headers.get("authorization") !== `Bearer ${token}` ||
					!inputKey
				)
					return new Response(null, { status: 404 });
				inputReads++;
				return new Response(await (await getMedia(inputKey)).arrayBuffer(), {
					headers: { "content-type": "image/png" },
				});
			},
		});
		const overrides = {
			MALEO_VIDEO_PORT: String(port),
			MALEO_VIDEO_TOKEN: token,
			MALEO_VIDEO_DB: join(root, "jobs.db"),
			MALEO_MEDIA_STORAGE_BACKEND: "s3",
			MALEO_MEDIA_S3_BUCKET: process.env.MALEO_MEDIA_TEST_BUCKET ?? "maleo-test",
			MALEO_MEDIA_S3_ENDPOINT: endpoint!,
			MALEO_MEDIA_S3_PUBLIC_ENDPOINT: endpoint!,
			MALEO_MEDIA_S3_REGION: "us-east-1",
			MALEO_MEDIA_S3_ACCESS_KEY_ID: process.env.MALEO_MEDIA_TEST_ACCESS_KEY ?? "maleoapp",
			MALEO_MEDIA_S3_SECRET_ACCESS_KEY: process.env.MALEO_MEDIA_TEST_SECRET_KEY ?? "maleoappsecret",
			MALEO_API_URL: `http://127.0.0.1:${inputServer.port}`,
			MALEO_SERVICE_TOKEN: token,
		};
		const env = { ...process.env, ...overrides };
		const prior = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
		let service: ReturnType<typeof Bun.spawn> | undefined;
		let storageKey: string | undefined;
		const start = async () => {
			service = Bun.spawn(["bun", "src/index.ts"], {
				cwd: join(import.meta.dir, ".."),
				env,
				stdout: "ignore",
				stderr: "ignore",
			});
			for (let i = 0; i < 100; i++) {
				if (
					await fetch(`${base}/health`)
						.then((r) => r.ok)
						.catch(() => false)
				)
					return;
				await Bun.sleep(300);
			}
			throw new Error("video service did not become healthy");
		};
		const stop = async () => {
			service?.kill();
			await service?.exited;
			service = undefined;
		};
		try {
			Object.assign(process.env, overrides);
			await start();
			const image = await readFile(
				new URL("../../../../apps/web/visual/baselines/image-lab-1024.png", import.meta.url),
			);
			inputKey = (
				await putMedia({ workspace, kind: "image", body: image, contentType: "image/png" })
			).key;
			const response = await fetch(`${base}/render`, {
				method: "POST",
				headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
				body: JSON.stringify({
					workspace,
					project_id: "render-test-project",
					preset: "tiktok",
					product: { title: "Storage smoke", images: [`/api/media/${mediaId}`] },
				}),
			});
			expect(response.status).toBe(202);
			const { id } = (await response.json()) as { id: string };
			let job: { status: string; error: string | null; output_storage: string | null } | undefined;
			for (let i = 0; i < 180; i++) {
				job = await (
					await fetch(`${base}/render/${id}`, { headers: { authorization: `Bearer ${token}` } })
				).json();
				if (["done", "done_with_fallback", "error"].includes(job!.status)) break;
				await Bun.sleep(1000);
			}
			expect(job?.status, job?.error ?? "render timed out").toMatch(/^done/);
			expect(inputReads).toBeGreaterThan(0);
			storageKey = (JSON.parse(job!.output_storage!) as { key: string }).key;
			const bytes = new Uint8Array(await (await getMedia(storageKey)).arrayBuffer());
			expect(new TextDecoder().decode(bytes.slice(4, 8))).toBe("ftyp");
			await stop();
			await start();
			const after = (await (
				await fetch(`${base}/render/${id}`, { headers: { authorization: `Bearer ${token}` } })
			).json()) as { output_storage: string | null };
			expect(JSON.parse(after.output_storage!).key).toBe(storageKey);
			expect(
				new TextDecoder().decode(
					new Uint8Array(await (await getMedia(storageKey)).arrayBuffer()).slice(4, 8),
				),
			).toBe("ftyp");
		} finally {
			await stop();
			if (storageKey) await deleteMedia(storageKey);
			if (inputKey) await deleteMedia(inputKey);
			void inputServer.stop();
			for (const [key, value] of Object.entries(prior)) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
			await rm(root, { recursive: true, force: true });
		}
	},
	240_000,
);
