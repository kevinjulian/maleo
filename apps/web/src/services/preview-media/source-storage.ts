import type { SourceSink } from "./source-loader.ts";

const MEMORY_LIMIT = 64 * 1024 * 1024;
export interface SourceMemory {
	reserve(bytes: number): Promise<boolean>;
	release(bytes: number): void;
}

/** Disposable derived bytes. This never opens the pending-uploads namespace. */
export function createSourceStorage(
	sessionId: string,
	storage: Partial<Pick<StorageManager, "getDirectory">> | undefined = typeof navigator ===
	"undefined"
		? undefined
		: navigator.storage,
	memory?: SourceMemory,
	locks: LockManager | undefined = typeof navigator === "undefined" ? undefined : navigator.locks,
) {
	if (!/^[a-zA-Z0-9-]{1,100}$/.test(sessionId))
		throw new Error("Invalid preview media session identity");
	let used = 0;
	let next = 0;
	let disposed = false;
	let directory: Promise<FileSystemDirectoryHandle | undefined> | undefined;
	const releases = new Set<() => Promise<void>>();
	let releaseOwnership: (() => void) | undefined;
	let ownership: Promise<unknown> | undefined;
	async function openDirectory() {
		if (!storage?.getDirectory) return undefined;
		let root: FileSystemDirectoryHandle;
		try {
			root = await storage.getDirectory();
		} catch (error) {
			if (error instanceof DOMException && error.name === "QuotaExceededError") throw error;
			// WebKit private contexts expose OPFS but reject its root with UnknownError.
			return undefined;
		}
		const base = await root.getDirectoryHandle("preview-media", { create: true });
		if (locks) {
			await new Promise<void>((resolve, reject) => {
				ownership = locks
					.request(`maleo-preview-media:${sessionId}`, async () => {
						await new Promise<void>((release) => {
							releaseOwnership = release;
							resolve();
						});
					})
					.catch(reject);
			});
		}
		try {
			const target = await base.getDirectoryHandle(sessionId, { create: true });
			if (locks) {
				for await (const [name, entry] of base.entries()) {
					if (
						name === sessionId ||
						entry.kind !== "directory" ||
						!/^[a-zA-Z0-9-]{1,100}$/.test(name)
					)
						continue;
					await locks.request(
						`maleo-preview-media:${name}`,
						{ ifAvailable: true },
						async (lock) => {
							if (lock) await base.removeEntry(name, { recursive: true });
						},
					);
				}
			}
			return target;
		} catch (error) {
			releaseOwnership?.();
			await ownership;
			throw error;
		}
	}
	return {
		async createSink(): Promise<SourceSink> {
			if (disposed) throw new Error("Preview media storage is disposed");
			directory ??= openDirectory();
			const target = await directory;
			if (disposed) throw new Error("Preview media storage is disposed");
			const name = String(++next);
			let released = false;
			let closed = false;
			let size = 0;
			const chunks: Blob[] = [];
			const file = target ? await target.getFileHandle(name, { create: true }) : undefined;
			let writer: FileSystemWritableFileStream | undefined;
			try {
				writer = await file?.createWritable();
			} catch (error) {
				await target?.removeEntry(name);
				throw error;
			}
			const release = async (): Promise<void> => {
				if (released) return;
				released = true;
				if (!writer) {
					used -= size;
					memory?.release(size);
				}
				chunks.length = 0;
				releases.delete(release);
				if (writer && !closed) await writer.abort();
				if (target) await target.removeEntry(name);
			};
			releases.add(release);
			return {
				async write(bytes) {
					if (released || closed || disposed) throw new Error("Preview media source is closed");
					if (!writer && used + bytes.byteLength > MEMORY_LIMIT)
						throw new Error(
							"Preview media needs more than 64 MiB of tab memory. Free browser storage or remove media.",
						);
					if (writer) await writer.write(Uint8Array.from(bytes));
					else {
						if (memory && !(await memory.reserve(bytes.byteLength)))
							throw new Error(
								"Preview media needs more than 64 MiB of tab memory. Free browser storage or remove media.",
							);
						// Cancellation can race the main-thread reservation acknowledgement.
						if (released || disposed) {
							memory?.release(bytes.byteLength);
							throw new Error("Preview media source is closed");
						}
						chunks.push(new Blob([Uint8Array.from(bytes)]));
						used += bytes.byteLength;
					}
					size += bytes.byteLength;
				},
				async close(type) {
					if (released || closed || disposed) throw new Error("Preview media source is closed");
					if (writer) await writer.close();
					closed = true;
					return new File(file ? [await file.getFile()] : chunks, name, { type });
				},
				abort: release,
			};
		},
		/** Borrowed complete File stays owned by upload staging. */
		lease(file: File) {
			if (disposed) throw new Error("Preview media storage is disposed");
			let borrowed: File | undefined = file;
			const release = async (): Promise<void> => {
				borrowed = undefined;
				releases.delete(release);
			};
			releases.add(release);
			return { read: () => borrowed, release };
		},
		async dispose(): Promise<void> {
			disposed = true;
			try {
				// One failed file removal must not keep the session directory; it removes recursively.
				const results = await Promise.allSettled([...releases].map((release) => release()));
				if (directory && (await directory) && storage?.getDirectory) {
					const root = await storage.getDirectory();
					await (
						await root.getDirectoryHandle("preview-media")
					).removeEntry(sessionId, { recursive: true });
				}
				for (const result of results) if (result.status === "rejected") throw result.reason;
			} finally {
				releaseOwnership?.();
				await ownership;
			}
		},
	};
}
