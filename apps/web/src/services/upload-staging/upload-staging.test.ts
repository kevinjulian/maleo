import { expect, test } from "vite-plus/test";
import { createUploadStaging, type StagingDirectory, type StagingFile } from "./upload-staging.ts";

/* An in-memory origin-private file system with the calls staging makes. */
function opfs(): StagingDirectory & { tree: Map<string, unknown> } {
	const dir = (tree: Map<string, unknown>): StagingDirectory & { tree: Map<string, unknown> } => ({
		tree,
		async getDirectoryHandle(name, options) {
			let child = tree.get(name);
			if (!child) {
				if (!options?.create) throw new DOMException("missing", "NotFoundError");
				child = new Map();
				tree.set(name, child);
			}
			if (!(child instanceof Map)) throw new DOMException("not a directory", "TypeMismatchError");
			return dir(child);
		},
		async getFileHandle(name, options): Promise<StagingFile> {
			if (!tree.has(name) && !options?.create) throw new DOMException("missing", "NotFoundError");
			return {
				async getFile() {
					return tree.get(name) as File;
				},
				async createWritable() {
					let data: Blob = new Blob([]);
					return {
						async write(blob: Blob) {
							data = blob;
						},
						async close() {
							tree.set(name, new Blob([data], { type: data.type }));
						},
					};
				},
			};
		},
		async removeEntry(name) {
			if (!tree.delete(name)) throw new DOMException("missing", "NotFoundError");
		},
	});
	return dir(new Map());
}
const storage = (root: StagingDirectory | undefined, free = 1e9) => {
	let persisted = 0;
	return {
		estimate: async () => ({ quota: free, usage: 0 }),
		persist: async () => {
			persisted++;
			return true;
		},
		getDirectory: root ? async () => root : undefined,
		get persisted() {
			return persisted;
		},
	};
};
const file = new File(["video bytes"], "beach.mov", { type: "video/quicktime" });

test("a staged file survives a reload as the same file, and is gone once removed", async () => {
	const root = opfs(),
		manager = storage(root);
	expect(await createUploadStaging(manager).stage("p1", "k1", file)).toBe("persisted");
	expect(manager.persisted).toBe(1);
	const reloaded = createUploadStaging(manager);
	const read = (await reloaded.read("p1", "k1"))!;
	expect([read.name, await read.text()]).toEqual(["beach.mov", "video bytes"]);
	await reloaded.remove("p1", "k1");
	expect(await createUploadStaging(manager).read("p1", "k1")).toBeUndefined();
	expect(await reloaded.read("p2", "k1")).toBeUndefined();
});

test("no room keeps the file in this tab only", async () => {
	const root = opfs(),
		manager = storage(root, 4);
	const staging = createUploadStaging(manager);
	expect(await staging.stage("p1", "k1", file)).toBe("memory");
	expect(await staging.read("p1", "k1")).toBe(file);
	expect(await createUploadStaging(manager).read("p1", "k1")).toBeUndefined();
	expect(root.tree.size).toBe(0);
});

test("without OPFS the file is held in memory", async () => {
	const staging = createUploadStaging(storage(undefined));
	expect(await staging.stage("p1", "k1", file)).toBe("memory");
	expect(await staging.read("p1", "k1")).toBe(file);
	await staging.remove("p1", "k1");
	expect(await staging.read("p1", "k1")).toBeUndefined();
	expect(await createUploadStaging(undefined).stage("p1", "k2", file)).toBe("memory");
});
