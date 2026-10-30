import { expect, test } from "vite-plus/test";
import { createSourceStorage } from "./source-storage.ts";

class Directory {
	files = new Map<string, Directory | File>();
	failWrite = false;
	failRemove = false;
	async *entries(): AsyncIterableIterator<[string, { kind: "directory" | "file" }]> {
		for (const [name, value] of this.files)
			yield [name, { kind: value instanceof Directory ? "directory" : "file" }];
	}
	async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<Directory> {
		const held = this.files.get(name);
		if (held instanceof Directory) return held;
		if (!options?.create) throw new DOMException("Missing", "NotFoundError");
		const child = new Directory();
		this.files.set(name, child);
		return child;
	}
	async getFileHandle(name: string) {
		this.files.set(name, new File([], name));
		return {
			getFile: async () => this.files.get(name) as File,
			createWritable: async () => {
				const chunks: Blob[] = [];
				return {
					write: async (data: Uint8Array) => {
						if (this.failWrite) throw new DOMException("Full", "QuotaExceededError");
						chunks.push(new Blob([Uint8Array.from(data)]));
					},
					close: async () => {
						this.files.set(name, new File(chunks, name));
					},
					abort: async () => {
						chunks.length = 0;
					},
				};
			},
		};
	}
	async removeEntry(name: string, options?: { recursive?: boolean }) {
		if (this.failRemove && !options?.recursive) throw new DOMException("Busy", "InvalidStateError");
		this.files.delete(name);
	}
}

function storage(root: Directory): Pick<StorageManager, "getDirectory"> {
	// SAFETY: the fixture implements exactly the OPFS methods this adapter consumes.
	return { getDirectory: async () => root as unknown as FileSystemDirectoryHandle };
}

test("OPFS bytes remain complete and disposal only removes this session", async () => {
	const root = new Directory();
	const uploads = await root.getDirectoryHandle("pending-uploads", { create: true });
	const first = createSourceStorage("first", storage(root));
	const second = createSourceStorage("second", storage(root));
	const a = await first.createSink();
	await a.write(new TextEncoder().encode("first bytes"));
	expect(await (await a.close("video/mp4")).text()).toBe("first bytes");
	const b = await second.createSink();
	await b.write(new TextEncoder().encode("second bytes"));
	const held = await b.close("video/mp4");
	expect(held.type).toBe("video/mp4");
	await first.dispose();
	const base = await root.getDirectoryHandle("preview-media");
	expect(base.files.has("first")).toBe(false);
	expect(base.files.has("second")).toBe(true);
	expect(root.files.get("pending-uploads")).toBe(uploads);
	expect(await held.text()).toBe("second bytes");
	await second.dispose();
});

test("quota failure allows partial-file cleanup without touching other sessions", async () => {
	const root = new Directory();
	const cache = createSourceStorage("quota", storage(root));
	const sink = await cache.createSink();
	const session = await (
		await root.getDirectoryHandle("preview-media")
	).getDirectoryHandle("quota");
	await sink.write(new Uint8Array([1]));
	session.failWrite = true;
	await expect(sink.write(new Uint8Array([2]))).rejects.toThrow("Full");
	await sink.abort();
	expect(session.files.size).toBe(0);
	await cache.dispose();
});

test("memory backend enforces 64 MiB across complete and in-progress files", async () => {
	const cache = createSourceStorage("memory", {});
	const first = await cache.createSink();
	await first.write(new Uint8Array(64 * 1024 * 1024));
	expect((await first.close("video/mp4")).size).toBe(64 * 1024 * 1024);
	const next = await cache.createSink();
	await expect(next.write(new Uint8Array([1]))).rejects.toThrow("64 MiB");
	await first.abort();
	await next.write(new Uint8Array([2]));
	expect(Array.from(new Uint8Array(await (await next.close("video/mp4")).arrayBuffer()))).toEqual([
		2,
	]);
	await cache.dispose();
});

test("pending File leases release references without deleting staged originals", async () => {
	const cache = createSourceStorage("lease", {});
	const original = new File(["pending original"], "upload.mp4");
	const lease = cache.lease(original);
	expect(lease.read()).toBe(original);
	expect(await lease.read()!.text()).toBe("pending original");
	await cache.dispose();
	expect(lease.read()).toBeUndefined();
	expect(await original.text()).toBe("pending original");
});

test("an unavailable OPFS root uses bounded memory; quota failure remains a blocker", async () => {
	const unavailable = createSourceStorage("unavailable", {
		getDirectory: async () => {
			throw new DOMException("Unavailable", "UnknownError");
		},
	});
	const sink = await unavailable.createSink();
	await sink.write(new TextEncoder().encode("local"));
	expect(await (await sink.close("video/mp4")).text()).toBe("local");
	await unavailable.dispose();
	const quota = createSourceStorage("quota-root", {
		getDirectory: async () => {
			throw new DOMException("Full", "QuotaExceededError");
		},
	});
	await expect(quota.createSink()).rejects.toThrow("Full");
});

test("abandoned preview sessions are reclaimed only while their exclusive ownership is absent", async () => {
	const active = new Set<string>();
	const locks = {
		request: async (
			name: string,
			optionsOrCallback: unknown,
			callback?: (lock: unknown) => Promise<unknown>,
		) => {
			const run =
				typeof optionsOrCallback === "function"
					? (optionsOrCallback as (lock: unknown) => Promise<unknown>)
					: callback!;
			if (active.has(name)) return run(null);
			active.add(name);
			try {
				return await run({ name, mode: "exclusive" });
			} finally {
				active.delete(name);
			}
		},
	};
	// SAFETY: fixture exercises the request overloads used by this storage adapter.
	const manager = locks as unknown as LockManager;
	const root = new Directory();
	const base = await root.getDirectoryHandle("preview-media", { create: true });
	await base.getDirectoryHandle("abandoned", { create: true });
	const first = createSourceStorage("first", storage(root), undefined, manager);
	const a = await first.createSink();
	await a.write(new Uint8Array([1]));
	await a.close("image/png");
	expect(base.files.has("abandoned")).toBe(false);
	const second = createSourceStorage("second", storage(root), undefined, manager);
	await second.createSink();
	expect(base.files.has("first")).toBe(true);
	await second.dispose();
	expect(base.files.has("first")).toBe(true);
	await first.dispose();
	expect(base.files.size).toBe(0);
	expect(active.size).toBe(0);
});

test("a failed file removal still removes the session directory and reports the failure", async () => {
	const root = new Directory();
	const cache = createSourceStorage("stuck", storage(root));
	const sink = await cache.createSink();
	await sink.write(new TextEncoder().encode("bytes"));
	await sink.close("video/mp4");
	const base = await root.getDirectoryHandle("preview-media");
	(await base.getDirectoryHandle("stuck")).failRemove = true;
	await expect(cache.dispose()).rejects.toThrow("Busy");
	expect(base.files.has("stuck")).toBe(false);
});
