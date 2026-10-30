import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { FIXTURE_PROJECT_ID } from "./screens.ts";
import { replayApi } from "./har.ts";

test("lightweight media worker retains complete local bytes and disposes its session", async ({
	page,
	context,
}) => {
	let downloads = 0;
	const fixture = readFileSync(join(import.meta.dirname, "../static/maleo-favicon-32.png"));
	await replayApi(context, join(import.meta.dirname, "fixtures/api.har"));
	await context.route("**/source-fixture.bin", (route) => {
		downloads++;
		return route.fulfill({
			body: fixture,
			contentType: "image/png",
		});
	});
	await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
	await expect(page.locator(".tl2-timeline")).toBeVisible();
	const result = await page.evaluate(async () => {
		const worker = new Worker("/preview-media-worker.js");
		const messages: Array<{ type: string; loaded?: number; total?: number }> = [];
		let file: File | undefined;
		try {
			await new Promise<void>((resolve, reject) => {
				worker.onerror = () => reject(new Error("Media worker failed"));
				worker.onmessage = (
					event: MessageEvent<{
						type: string;
						file?: File;
						loaded?: number;
						total?: number;
						message?: string;
					}>,
				) => {
					const message = event.data;
					messages.push({ type: message.type, loaded: message.loaded, total: message.total });
					if (message.type === "failed" || message.type === "protocol-error")
						reject(new Error(message.message));
					if (message.type === "complete") {
						file = message.file;
						resolve();
					}
				};
				worker.postMessage({
					type: "load",
					source: {
						requestId: 1,
						kinds: ["image"],
						id: "fixture",
						revision: "1",
						target: { url: location.origin + "/source-fixture.bin", credentials: "omit" },
					},
				});
			});
			if (!file) throw new Error("Worker returned no local File");
			const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
			await new Promise<void>((resolve, reject) => {
				worker.onmessage = (event: MessageEvent<{ type: string; message?: string }>) =>
					event.data.type === "disposed" ? resolve() : reject(new Error(event.data.message));
				worker.postMessage({ type: "dispose" });
			});
			return { bytes, size: file.size, messages };
		} finally {
			worker.terminate();
		}
	});
	expect(downloads).toBe(1);
	expect(result.bytes).toEqual(Array.from(fixture));
	expect(result.size).toBe(fixture.length);
	expect(
		result.messages.some(
			(message) => message.type === "progress" && message.loaded === fixture.length,
		),
	).toBe(true);
});

test("OPFS ownership protects live workers and reclaims crashed sessions without staged-file loss", async ({
	page,
	context,
}) => {
	const png = readFileSync(join(import.meta.dirname, "../static/maleo-favicon-32.png"));
	await context.route("**/storage-probe", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: "<!doctype html><title>Storage probe</title>",
		}),
	);
	await context.route("**/storage-source.png", (route) =>
		route.fulfill({ contentType: "image/png", body: png }),
	);
	await page.goto("/storage-probe");
	const result = await page.evaluate(async (fixture) => {
		const root = await navigator.storage.getDirectory();
		const base = await root.getDirectoryHandle("preview-media", { create: true });
		const staged = await root.getDirectoryHandle("pending-uploads", { create: true });
		const stagedFile = await staged.getFileHandle("keep-original", { create: true });
		const writer = await stagedFile.createWritable();
		await writer.write("original");
		await writer.close();
		const orphan = crypto.randomUUID();
		await base.getDirectoryHandle(orphan, { create: true });
		async function names() {
			const found: string[] = [];
			for await (const [name] of base.entries()) found.push(name);
			return found.sort();
		}
		type Reply = { type: string; message?: string; file?: File };
		async function load(worker: Worker, id: string, file?: File) {
			return new Promise<File>((resolve, reject) => {
				worker.onerror = () => reject(new Error("Storage worker failed"));
				worker.onmessage = (event: MessageEvent<Reply>) => {
					if (event.data.type === "complete" && event.data.file) resolve(event.data.file);
					if (event.data.type === "failed" || event.data.type === "protocol-error")
						reject(new Error(event.data.message));
				};
				worker.postMessage({
					type: "load",
					source: {
						id,
						revision: "1",
						requestId: 1,
						kinds: ["image"],
						...(file
							? { file }
							: { target: { url: location.origin + "/storage-source.png", credentials: "omit" } }),
					},
				});
			});
		}
		async function dispose(worker: Worker) {
			await new Promise<void>((resolve, reject) => {
				worker.onmessage = (event: MessageEvent<Reply>) =>
					event.data.type === "disposed" ? resolve() : reject(new Error(event.data.message));
				worker.postMessage({ type: "dispose" });
			});
			worker.terminate();
		}
		const first = new Worker("/preview-media-worker.js"),
			second = new Worker("/preview-media-worker.js"),
			third = new Worker("/preview-media-worker.js");
		try {
			await load(first, "first");
			const borrowed = new File([Uint8Array.from(fixture)], "pending.png", { type: "image/png" });
			const afterFirst = await names();
			await load(second, "second");
			const afterSecond = await names();
			first.terminate();
			await navigator.locks.request(`maleo-preview-media:${afterFirst[0]}`, () => {});
			await load(third, "third");
			const afterCrash = await names();
			// Borrow the completed pending File: this creates no extra cache file.
			await load(third, "pending", borrowed);
			const afterLease = await names();
			const original = await (await stagedFile.getFile()).text();
			await dispose(second);
			await dispose(third);
			return {
				orphan,
				afterFirst,
				afterSecond,
				afterCrash,
				afterLease,
				afterDispose: await names(),
				original,
			};
		} finally {
			first.terminate();
			second.terminate();
			third.terminate();
		}
	}, Array.from(png));
	expect(result.afterFirst).toHaveLength(1);
	expect(result.afterFirst).not.toContain(result.orphan);
	expect(result.afterSecond).toHaveLength(2);
	expect(result.afterSecond).toContain(result.afterFirst[0]);
	expect(result.afterCrash).toHaveLength(2);
	expect(result.afterCrash).not.toContain(result.afterFirst[0]);
	expect(result.afterLease).toEqual(result.afterCrash);
	expect(result.afterDispose).toEqual([]);
	expect(result.original).toBe("original");
});
