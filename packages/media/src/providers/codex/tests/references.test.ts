import { afterEach, describe, expect, it } from "vite-plus/test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveCodexReferences } from "../index.ts";
import { mediaWorkerCacheDir } from "../../../paths.ts";
import { restoreEnv, snapshotEnv } from "./env.ts";

const snapshot = snapshotEnv();
const created: string[] = [];

afterEach(() => {
	restoreEnv(snapshot);
	for (const path of created.splice(0)) rmSync(path, { force: true });
});

let sequence = 0;

function managedFile(): string {
	mkdirSync(mediaWorkerCacheDir(), { recursive: true });
	const path = join(mediaWorkerCacheDir(), `codex-reference-${Date.now()}-${sequence++}.png`);
	writeFileSync(path, "image");
	created.push(path);
	return path;
}

describe("codex reference inputs", () => {
	it("passes through when there are no references", () => {
		expect(resolveCodexReferences(undefined)).toEqual([]);
		expect(resolveCodexReferences([])).toEqual([]);
	});

	it("resolves managed worker files without fetching remote content", () => {
		const path = managedFile();
		const url = `https://dashboard.local/api/image-gen/files/${path.split("/").pop()}`;
		expect(resolveCodexReferences([url, url])).toEqual([path]);
	});

	it("rejects arbitrary remote references instead of dropping them silently", () => {
		expect(() => resolveCodexReferences(["https://example.com/image.png"])).toThrow(
			/unsupported Codex image references/,
		);
	});

	it("rejects more references than the runner boundary accepts", () => {
		const paths = [managedFile(), managedFile(), managedFile(), managedFile(), managedFile()];
		expect(() => resolveCodexReferences(paths)).toThrow(/at most 4 references/);
	});
});
