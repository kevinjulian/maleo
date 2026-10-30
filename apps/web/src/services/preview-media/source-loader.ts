import { localMediaUrlIssues } from "@maleo/shared";

/** About ten readiness updates per second per download. */
const PROGRESS_INTERVAL_MS = 100;

/** Complete compressed sources, separate from codec readiness and decoded caches. */
export interface SourceSink {
	write(bytes: Uint8Array): Promise<void>;
	close(type: string): Promise<File>;
	abort(): Promise<void>;
}

export interface SourceDownload {
	requestId: number;
	id: string;
	revision: string;
	target: { url: string; credentials: RequestCredentials };
}

export interface DownloadProgress {
	loaded: number;
	total: number | null;
}

export type SourceFetch = (url: string, init: RequestInit) => Promise<Response>;

interface Job {
	key: string;
	source: SourceDownload;
	controller: AbortController;
	resolve(file: File): void;
	reject(error: unknown): void;
}

/** The caller resolves authorized fetch targets and supplies session-owned storage. */
export function createSourceLoader(options: {
	createSink(source: SourceDownload): Promise<SourceSink>;
	progress(source: SourceDownload, progress: DownloadProgress): void;
	fetch?: SourceFetch;
}) {
	const pending: Job[] = [];
	const held = new Map<
		string,
		{ promise: Promise<File>; controller: AbortController; sink?: SourceSink }
	>();
	const running = new Set<Promise<void>>();
	let active = 0;
	let disposed = false;
	const keyOf = (source: Pick<SourceDownload, "id" | "revision">) =>
		JSON.stringify([source.id, source.revision]);
	function pump(): void {
		while (!disposed && active < 4 && pending.length) {
			const job = pending.shift()!;
			if (job.controller.signal.aborted) {
				job.reject(new DOMException("Media download cancelled", "AbortError"));
				continue;
			}
			active++;
			const task = download(job)
				.then(job.resolve, (error: unknown) => {
					if (held.get(job.key)?.controller === job.controller) held.delete(job.key);
					job.reject(error);
				})
				.finally(() => {
					active--;
					running.delete(task);
					pump();
				});
			running.add(task);
		}
	}
	async function download(job: Job): Promise<File> {
		const { signal } = job.controller;
		let sink: SourceSink | undefined;
		let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			if (job.source.target.url.startsWith("data:")) {
				const [issue] = localMediaUrlIssues({ url: job.source.target.url });
				if (issue) throw new Error(issue);
			}
			let response: Response;
			try {
				response = await (options.fetch ?? fetch)(job.source.target.url, {
					credentials: job.source.target.credentials,
					signal,
				});
			} catch {
				throw new Error(signal.aborted ? "Media download cancelled" : "Media download failed");
			}
			if (!response.ok) throw new Error(`Media download returned HTTP ${response.status}`);
			if (response.status === 206 || response.headers.has("content-range"))
				throw new Error("Partial media response cannot establish readiness");
			if (!response.body) throw new Error("Media response has no bytes");
			const length = response.headers.get("content-length");
			const encoding = response.headers.get("content-encoding");
			const trustworthy = !encoding || encoding === "identity";
			const total = trustworthy && length !== null && /^\d+$/.test(length) ? Number(length) : null;
			if (total !== null && !Number.isSafeInteger(total))
				throw new Error("Media response length is invalid");
			sink = await options.createSink(job.source);
			const entry = held.get(job.key);
			if (entry?.controller === job.controller) entry.sink = sink;
			signal.throwIfAborted();
			reader = response.body.getReader();
			let loaded = 0,
				reportedAt = 0;
			// Each report is an engine round trip plus a UI notification; coalesce chunk storms.
			const report = () => {
				clearTimeout(timer);
				timer = undefined;
				reportedAt = Date.now();
				options.progress(job.source, { loaded, total });
			};
			report();
			while (true) {
				signal.throwIfAborted();
				const { done, value } = await reader.read();
				if (done) break;
				loaded += value.byteLength;
				if (!Number.isSafeInteger(loaded) || (total !== null && loaded > total))
					throw new Error("Media byte length does not match response");
				await sink.write(value);
				const wait = PROGRESS_INTERVAL_MS - (Date.now() - reportedAt);
				if (wait <= 0) report();
				else timer ??= setTimeout(report, wait);
			}
			signal.throwIfAborted();
			report();
			if (loaded === 0 || (total !== null && loaded !== total))
				throw new Error("Media download ended before complete source bytes arrived");
			const file = await sink.close(
				response.headers.get("content-type") ?? "application/octet-stream",
			);
			signal.throwIfAborted();
			if (file.size !== loaded) throw new Error("Stored media byte length does not match download");
			return file;
		} catch (error) {
			await sink?.abort();
			throw error;
		} finally {
			clearTimeout(timer);
			await reader?.cancel().catch(() => {});
			reader?.releaseLock();
		}
	}
	return {
		load(source: SourceDownload): Promise<File> {
			if (disposed) return Promise.reject(new Error("Media download session is disposed"));
			const key = keyOf(source);
			const existing = held.get(key);
			if (existing) return existing.promise;
			const controller = new AbortController();
			const promise = new Promise<File>((resolve, reject) =>
				pending.push({ key, source, controller, resolve, reject }),
			);
			held.set(key, { promise, controller });
			pump();
			return promise;
		},
		async cancel(source: Pick<SourceDownload, "id" | "revision">): Promise<void> {
			const key = keyOf(source);
			const item = held.get(key);
			item?.controller.abort();
			held.delete(key);
			for (let i = pending.length - 1; i >= 0; i--) {
				if (pending[i]!.key !== key) continue;
				pending.splice(i, 1)[0]!.reject(new DOMException("Media download cancelled", "AbortError"));
			}
			await item?.sink?.abort();
		},
		async dispose(): Promise<void> {
			disposed = true;
			for (const item of held.values()) item.controller.abort();
			held.clear();
			for (const job of pending.splice(0))
				job.reject(new DOMException("Media download cancelled", "AbortError"));
			await Promise.allSettled([...running]);
		},
	};
}
