import { expect, test, vi } from "vite-plus/test";
import {
	createSourceLoader,
	type SourceDownload,
	type SourceSink,
	type SourceFetch,
} from "./source-loader.ts";

const source: SourceDownload = {
	requestId: 1,
	id: "source",
	revision: "r1",
	target: { url: "https://media.invalid/signed", credentials: "omit" },
};
function sink() {
	const chunks: Blob[] = [];
	return {
		write: vi.fn(async (bytes: Uint8Array) => {
			chunks.push(new Blob([Uint8Array.from(bytes)]));
		}),
		close: vi.fn(async (type: string) => new File(chunks, "source", { type })),
		abort: vi.fn(async () => {
			chunks.length = 0;
		}),
	} satisfies SourceSink;
}

test("metadata and partial bytes are not completion; EOF and local size are required", async () => {
	const target = sink();
	const progress = vi.fn();
	let stream!: ReadableStreamDefaultController<Uint8Array>;
	const response = new Response(
		new ReadableStream({
			start(controller) {
				stream = controller;
			},
		}),
		{ headers: { "content-length": "3" } },
	);
	const fetcher = vi.fn(async () => response);
	const loader = createSourceLoader({ createSink: async () => target, progress, fetch: fetcher });
	let completed = false;
	const promise = loader.load(source).then((file) => {
		completed = true;
		return file;
	});
	await vi.waitFor(() => expect(progress).toHaveBeenCalledWith(source, { loaded: 0, total: 3 }));
	stream.enqueue(new Uint8Array([1, 2]));
	await vi.waitFor(() => expect(progress).toHaveBeenCalledWith(source, { loaded: 2, total: 3 }));
	expect(completed).toBe(false);
	stream.enqueue(new Uint8Array([3]));
	stream.close();
	expect(Array.from(new Uint8Array(await (await promise).arrayBuffer()))).toEqual([1, 2, 3]);
	expect(fetcher).toHaveBeenCalledWith(
		source.target.url,
		expect.objectContaining({ credentials: "omit", signal: expect.any(AbortSignal) }),
	);
});

test.each([
	new Response("abc", { status: 206, headers: { "content-range": "bytes 0-2/20" } }),
	new Response("abc", { headers: { "content-length": "4" } }),
	new Response("abc", { headers: { "content-length": "2" } }),
	new Response(null, { status: 204 }),
])("partial, short and empty responses fail", async (response) => {
	const target = sink();
	const loader = createSourceLoader({
		createSink: async () => target,
		progress: () => {},
		fetch: async () => response,
	});
	await expect(loader.load(source)).rejects.toThrow();
	expect(target.close).not.toHaveBeenCalled();
});

test.each([new Headers(), new Headers({ "content-encoding": "gzip", "content-length": "1" })])(
	"unknown or compressed lengths report indeterminate progress",
	async (headers) => {
		const progress = vi.fn();
		const loader = createSourceLoader({
			createSink: async () => sink(),
			progress,
			fetch: async () => new Response("abc", { headers }),
		});
		expect((await loader.load(source)).size).toBe(3);
		expect(progress).toHaveBeenLastCalledWith(source, { loaded: 3, total: null });
	},
);

test("four downloads maximum, shared source deduplication and queued cancellation", async () => {
	const responses: Array<(response: Response) => void> = [];
	const fetcher = vi.fn(() => new Promise<Response>((resolve) => responses.push(resolve)));
	const loader = createSourceLoader({
		createSink: async () => sink(),
		progress: () => {},
		fetch: fetcher,
	});
	const sources = Array.from({ length: 6 }, (_, id) => ({ ...source, id: String(id) }));
	const promises = sources.map((item) => loader.load(item));
	const settled = Promise.allSettled(promises);
	expect(loader.load(sources[0]!)).toBe(promises[0]);
	expect(fetcher).toHaveBeenCalledTimes(4);
	await loader.cancel(sources[5]!);
	responses[0]!(new Response("one"));
	await promises[0];
	await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(5));
	for (const complete of responses.slice(1)) complete(new Response("next"));
	const results = await settled;
	expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(5);
	expect(results[5]?.status).toBe("rejected");
});

test("abort discards partial writes and disposal rejects further work", async () => {
	const target = sink();
	const fetcher: SourceFetch = async (_url, init) =>
		new Response(
			new ReadableStream({
				start(controller) {
					controller.enqueue(new Uint8Array([1]));
					init?.signal?.addEventListener("abort", () =>
						controller.error(new DOMException("Aborted", "AbortError")),
					);
				},
			}),
		);
	const loader = createSourceLoader({
		createSink: async () => target,
		progress: () => {},
		fetch: fetcher,
	});
	const pending = loader.load(source);
	const rejected = expect(pending).rejects.toThrow();
	await vi.waitFor(() => expect(target.write).toHaveBeenCalledOnce());
	await loader.dispose();
	await rejected;
	expect(target.abort).toHaveBeenCalledOnce();
	await expect(loader.load(source)).rejects.toThrow("disposed");
});

test.each(["data:audio/wav;base64,YQ==", "data:image/png;base64," + "a".repeat(64 * 1024)])(
	"disallowed inline media fails before fetch",
	async (url) => {
		const fetcher = vi.fn(async () => new Response("bytes"));
		const loader = createSourceLoader({
			createSink: async () => sink(),
			progress: () => {},
			fetch: fetcher,
		});
		await expect(loader.load({ ...source, target: { url, credentials: "omit" } })).rejects.toThrow(
			"data:",
		);
		expect(fetcher).not.toHaveBeenCalled();
		await loader.dispose();
	},
);

test("chunk storms coalesce progress and always report the final byte count", async () => {
	const progress = vi.fn();
	const chunks = Array.from({ length: 200 }, () => new Uint8Array([1]));
	const loader = createSourceLoader({
		createSink: async () => sink(),
		progress,
		fetch: async () =>
			new Response(
				new ReadableStream({
					start(controller) {
						for (const chunk of chunks) controller.enqueue(chunk);
						controller.close();
					},
				}),
				{ headers: { "content-length": String(chunks.length) } },
			),
	});
	expect((await loader.load(source)).size).toBe(200);
	expect(progress.mock.calls.length).toBeLessThan(10);
	expect(progress).toHaveBeenLastCalledWith(source, { loaded: 200, total: 200 });
});
