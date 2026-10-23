// @vitest-environment happy-dom
import { expect, test } from "vite-plus/test";
import { DEFAULT_MEDIA_IMPORT_LIMITS, ProjectMediaImportResponseSchema } from "@maleo/shared";
import {
	act,
	admitted,
	current,
	json,
	mount,
	response,
	setUploadProgress,
	stub,
	tick,
	useHarness,
} from "./use-media-import.harness.ts";

useHarness();

test("partial batch keeps successes and retries only failed files with original request identity", async () => {
	const attempts = new Map<string, string[]>();
	stub(async (url, init) => {
		if (url.includes("readiness"))
			return json({ available: true, limits: DEFAULT_MEDIA_IMPORT_LIMITS });
		const headers = new Headers(init.headers);
		const name = decodeURIComponent(headers.get("x-file-name")!);
		const previous = attempts.get(name) ?? [];
		previous.push(headers.get("x-upload-id")!);
		attempts.set(name, previous);
		expect(headers.get("x-file-size")).toBe("1");
		return name === "retry.png" && previous.length === 1
			? json({ message: "Storage offline" }, 503)
			: json(response(name), 202);
	});
	await mount("first");
	await act(async () =>
		current().enqueue([
			new File(["x"], "good.png"),
			new File(["x"], "retry.png"),
			new File(["x"], "bad.exe"),
		]),
	);
	await tick();
	expect(admitted.map(({ asset }) => asset.label)).toEqual(["good.png"]);
	expect(current().rows.map((row) => row.status)).toEqual(["ready", "failed", "failed"]);
	const retry = current().rows.find((row) => row.filename === "retry.png")!;
	await act(async () => current().retry(retry.key));
	await tick();
	expect(admitted.map(({ asset }) => asset.label)).toEqual(["good.png", "retry.png"]);
	expect(attempts.get("good.png")).toHaveLength(1);
	expect(attempts.get("retry.png")).toEqual([retry.key, retry.key]);
	expect(current().rows[0]!.file).toBeUndefined();
});

test("only two uploads run; cancelling queued file never submits it", async () => {
	const pending: Array<{ name: string; finish: (response: Response) => void }> = [];
	stub(async (url, init) => {
		if (url.includes("readiness"))
			return json({ available: true, limits: DEFAULT_MEDIA_IMPORT_LIMITS });
		if (init.method === "DELETE") return json({}, 404);
		const name = decodeURIComponent(new Headers(init.headers).get("x-file-name")!);
		return new Promise((finish) => pending.push({ name, finish }));
	});
	await mount("first");
	await act(async () =>
		current().enqueue(
			["first.png", "second.png", "third.png"].map((name) => new File(["x"], name)),
		),
	);
	expect(pending.map((request) => request.name)).toEqual(["first.png", "second.png"]);
	await act(async () => current().cancel(current().rows[2]!.key));
	await act(async () => {
		for (const request of pending) request.finish(json(response(request.name), 202));
	});
	await tick();
	expect(current().rows.map((row) => row.status)).toEqual(["ready", "ready", "cancelled"]);
	expect(pending).toHaveLength(2);
});

test("project switch aborts upload and ignores completion even when transport ignores cancellation", async () => {
	let placements = 0;
	let finish: ((response: Response) => void) | undefined;
	let signal: AbortSignal | undefined;
	stub(async (url, init) => {
		if (url.includes("readiness"))
			return json({ available: true, limits: DEFAULT_MEDIA_IMPORT_LIMITS });
		signal = init.signal ?? undefined;
		return new Promise((resolve) => {
			finish = resolve;
		});
	});
	await mount("first");
	await act(async () =>
		current().enqueue([new File(["x"], "late.png")], () => {
			placements++;
			return true;
		}),
	);
	await mount("second");
	expect(signal?.aborted).toBe(true);
	await act(async () => finish?.(json(response("late.png"), 202)));
	await tick();
	expect(admitted).toEqual([]);
	expect(placements).toBe(0);
	expect(current().rows).toEqual([]);
});

test("reload restores durable pending import by polling; never uploads again or places stale drop", async () => {
	const ready = response("restored.png");
	const pending = { ...ready, status: "processing", asset: null };
	let polls = 0;
	stub(
		async (url, init) => {
			if (url.includes("readiness"))
				return json({ available: true, limits: DEFAULT_MEDIA_IMPORT_LIMITS });
			expect(init.method).toBeUndefined();
			polls++;
			return json(ready);
		},
		[{ requestKey: "restored-key", import: ProjectMediaImportResponseSchema.parse(pending) }],
	);
	await mount("first");
	await tick();
	expect(polls).toBe(1);
	expect(admitted[0]).toMatchObject({ project: "first", asset: ready.asset });
	expect(current().rows[0]).toMatchObject({
		key: "restored-key",
		id: ready.id,
		status: "ready",
		retryable: false,
	});
});

test("a drop before import is available is reported, not silently discarded", async () => {
	stub(async (url) =>
		url.includes("readiness")
			? json({
					available: false,
					limits: DEFAULT_MEDIA_IMPORT_LIMITS,
					reason: "Media worker unavailable",
				})
			: json({}, 500),
	);
	await mount("first");
	await act(async () => current().enqueue([new File(["x"], "early.png")]));
	expect(current().rows).toEqual([]);
	expect(current().error).toBe("Import unavailable: Media worker unavailable");
});

test("a transient poll failure keeps polling the same import; only a missing import fails", async () => {
	const pending = { ...response("flaky.png"), status: "processing" as const, asset: null };
	const ready = { ...response("flaky.png"), id: pending.id };
	let polls = 0,
		uploads = 0;
	stub(
		async (url, init) => {
			if (url.includes("readiness"))
				return json({ available: true, limits: DEFAULT_MEDIA_IMPORT_LIMITS });
			if (init.method === "POST") {
				uploads++;
				return json(pending, 202);
			}
			if (url.includes("gone")) return json({ message: "Import not found" }, 404);
			polls++;
			return polls === 1 ? json({ message: "Bad gateway" }, 502) : json(ready);
		},
		[
			{
				requestKey: "gone-key",
				import: ProjectMediaImportResponseSchema.parse({
					...pending,
					id: "gone",
					filename: "gone.png",
				}),
			},
		],
	);
	await mount("first");
	await act(async () => current().enqueue([new File(["x"], "flaky.png")]));
	await tick();
	expect(current().rows.find((row) => row.filename === "flaky.png")).toMatchObject({
		status: "processing",
	});
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 2100));
	});
	expect(current().rows.find((row) => row.filename === "flaky.png")).toMatchObject({
		status: "ready",
	});
	expect(current().rows.find((row) => row.id === "gone")).toMatchObject({
		status: "failed",
		error: "Import not found",
	});
	expect(uploads).toBe(1);
});

test("row updates replace row objects instead of mutating rendered state", async () => {
	stub(async (url) =>
		url.includes("readiness")
			? json({ available: true, limits: DEFAULT_MEDIA_IMPORT_LIMITS })
			: new Promise(() => {}),
	);
	await mount("first");
	await act(async () => current().enqueue([new File(["x"], "held.png")]));
	const uploading = current().rows[0]!;
	expect(uploading.status).toBe("uploading");
	await act(async () => current().cancel(uploading.key));
	expect(uploading.status).toBe("uploading");
	expect(current().rows[0]!.status).toBe("cancelled");
});

test("upload rows report real byte progress, then processing after the last byte", async () => {
	const pending = { ...response("progress.png"), status: "processing" as const, asset: null };
	let release!: () => void;
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	stub(async (url, init) => {
		if (url.includes("readiness"))
			return json({ available: true, limits: DEFAULT_MEDIA_IMPORT_LIMITS });
		if (init.method === "POST") {
			await held;
			return json(pending, 202);
		}
		return new Promise(() => {});
	});
	setUploadProgress([0.25, 0.5]);
	await mount("first");
	await act(async () => current().enqueue([new File(["xxxx"], "progress.png")]));
	expect(current().rows[0]).toMatchObject({ status: "uploading", progress: 0.5 });
	setUploadProgress([]);
	await act(async () => {
		release();
	});
	await tick();
	expect(current().rows[0]).toMatchObject({ status: "processing" });
});

test("a gateway HTML error reads as a short message, and Delete dismisses a failed row for good", async () => {
	const cancelled: string[] = [];
	stub(async (url, init) => {
		if (url.includes("readiness"))
			return json({ available: true, limits: DEFAULT_MEDIA_IMPORT_LIMITS });
		if (init.method === "DELETE") {
			cancelled.push(url);
			return json({}, 404);
		}
		return new Response("<!DOCTYPE html><title>502: Bad gateway</title>", {
			status: 502,
			headers: { "content-type": "text/html" },
		});
	});
	await mount("first");
	await act(async () => current().enqueue([new File(["x"], "gateway.png")]));
	await tick();
	expect(current().rows[0]).toMatchObject({
		status: "failed",
		error: "Upload service unavailable (HTTP 502). Retry in a moment.",
	});
	await act(async () => current().dismiss(current().rows[0]!.key));
	await tick();
	expect(current().rows).toEqual([]);
	expect(cancelled.some((url) => url.includes("/media/import/request/"))).toBe(true);
});
