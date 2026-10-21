import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DEFAULT_WORKER_DATA_DIR = "apps/media-worker/data";

export function resolveRepoPath(path: string): string {
	return isAbsolute(path) ? path : resolve(REPO_ROOT, path);
}

export function mediaWorkerDbPath(): string {
	return resolveRepoPath(
		process.env.GEN_WORKER_DB?.trim() || `${DEFAULT_WORKER_DATA_DIR}/gen-worker.sqlite`,
	);
}

export function mediaWorkerCacheDir(): string {
	return resolveRepoPath(process.env.CACHE_DIR?.trim() || `${DEFAULT_WORKER_DATA_DIR}/cache`);
}

export function ensureParentDir(path: string): void {
	mkdirSync(dirname(path), { recursive: true });
}
