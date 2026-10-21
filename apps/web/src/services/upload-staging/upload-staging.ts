import { z } from "zod";
/* Files chosen for import, kept in browser-private storage until their import is
 * ready, so a reload can resume the upload (`use-media-while-uploading` D5).
 *
 * Origin-private file system at `pending-uploads/<projectId>/<requestKey>/`: the bytes
 * in `source`, the original name and type beside them in `name`, so a staged file comes
 * back as the same `File`.
 * Where OPFS is unavailable, or the browser has no room, the file is held in memory
 * for this tab only, and a reload marks the asset interrupted. */

/** The subset of the OPFS directory handle this module uses (and a test shim provides). */
export interface StagingDirectory {
	getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<StagingDirectory>;
	getFileHandle(name: string, options?: { create?: boolean }): Promise<StagingFile>;
	removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
}
export interface StagingFile {
	getFile(): Promise<File>;
	createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
}
interface StorageManagerLike {
	estimate(): Promise<{ quota?: number; usage?: number }>;
	persist?(): Promise<boolean>;
	getDirectory?(): Promise<StagingDirectory>;
}

/** Where a staged file lives: across reloads, or only in this tab. */
export type StagingResult = "persisted" | "memory";

export interface UploadStaging {
	stage(projectId: string, requestKey: string, file: File): Promise<StagingResult>;
	read(projectId: string, requestKey: string): Promise<File | undefined>;
	remove(projectId: string, requestKey: string): Promise<void>;
}

const ROOT = "pending-uploads";
const StagedNameSchema = z.object({ name: z.string().min(1), type: z.string() });

export function createUploadStaging(
	storage: StorageManagerLike | undefined = typeof navigator === "undefined"
		? undefined
		: navigator.storage,
): UploadStaging {
	const memory = new Map<string, File>();
	const id = (projectId: string, key: string) => `${projectId}/${key}`;
	let asked = false;
	const root = async (): Promise<StagingDirectory | undefined> => {
		try {
			return await storage?.getDirectory?.();
		} catch {
			return undefined;
		}
	};
	const directory = async (
		projectId: string,
		key: string,
		create: boolean,
	): Promise<StagingDirectory | undefined> => {
		try {
			const base = await root();
			if (!base) return undefined;
			const uploads = await base.getDirectoryHandle(ROOT, { create });
			const project = await uploads.getDirectoryHandle(projectId, { create });
			return await project.getDirectoryHandle(key, { create });
		} catch {
			return undefined;
		}
	};
	return {
		async stage(projectId, key, file) {
			memory.set(id(projectId, key), file);
			try {
				const { quota, usage } = await storage!.estimate();
				// ponytail: one file's headroom only; a batch of large files may still meet quota mid-write, which falls back to memory.
				if (quota == null || quota - (usage ?? 0) < file.size) return "memory";
				const target = await directory(projectId, key, true);
				if (!target) return "memory";
				if (!asked) {
					asked = true;
					await storage!.persist?.().catch(() => false);
				}
				const write = async (name: string, data: Blob) => {
					const writable = await (
						await target.getFileHandle(name, { create: true })
					).createWritable();
					await writable.write(data);
					await writable.close();
				};
				await write("source", file);
				await write("name", new Blob([JSON.stringify({ name: file.name, type: file.type })]));
				return "persisted";
			} catch {
				await this.remove(projectId, key).catch(() => {});
				memory.set(id(projectId, key), file);
				return "memory";
			}
		},
		async read(projectId, key) {
			const held = memory.get(id(projectId, key));
			if (held) return held;
			const target = await directory(projectId, key, false);
			if (!target) return undefined;
			try {
				const { name, type } = StagedNameSchema.parse(
					JSON.parse(await (await (await target.getFileHandle("name")).getFile()).text()),
				);
				const bytes = await (await target.getFileHandle("source")).getFile();
				return new File([bytes], name, { type });
			} catch {
				return undefined; /* Evicted, partly written or unreadable: not staged. */
			}
		},
		async remove(projectId, key) {
			memory.delete(id(projectId, key));
			try {
				const base = await root();
				const project = await (await base?.getDirectoryHandle(ROOT))?.getDirectoryHandle(projectId);
				await project?.removeEntry(key, { recursive: true });
			} catch {
				/* Nothing staged. */
			}
		},
	};
}
