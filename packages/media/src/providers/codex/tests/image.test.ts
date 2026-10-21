import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { existsSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { codexImageCacheKey, generateImageViaCodex, normalizeCodexPrompt } from "../index.ts";
import { restoreEnv, snapshotEnv, useFakeCodex, useNoCodex } from "./env.ts";

const snapshot = snapshotEnv();
const cleanup: string[] = [];

async function tempDir(prefix: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	cleanup.push(dir);
	return dir;
}

async function withCache(): Promise<string> {
	const dir = await tempDir("codex-cache-");
	process.env.CACHE_DIR = dir;
	return dir;
}

beforeEach(useFakeCodex);

afterEach(async () => {
	restoreEnv(snapshot);
	await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("codex image generation", () => {
	it("copies CLI output into the worker cache and never returns the run workspace path", async () => {
		const cacheDir = await withCache();

		const result = await generateImageViaCodex({ prompt: "a red bird", workspaceId: "ws-1" });

		expect(dirname(result.path)).toBe(cacheDir);
		expect(result.from_cache).toBe(false);
		expect((await readFile(result.path)).byteLength).toBeGreaterThan(0);
	});

	it("removes the per-run workspace once the output is adopted", async () => {
		await withCache();
		const argvLog = join(await tempDir("codex-log-"), "argv.txt");
		process.env.FAKE_CODEX_ARGV_LOG = argvLog;

		await generateImageViaCodex({ prompt: "a red bird", workspaceId: "ws-1" });
		const argv = (await readFile(argvLog, "utf8")).split("\n");
		const workDir = argv[argv.indexOf("-C") + 1]!;

		expect(existsSync(join(workDir, "out.png"))).toBe(false);
	});

	it("invokes the imagegen skill with the caller prompt and aspect", async () => {
		await withCache();
		const promptLog = join(await tempDir("codex-log-"), "prompt.txt");
		process.env.FAKE_CODEX_PROMPT_LOG = promptLog;

		await generateImageViaCodex({
			prompt: "a blue\n  whale, no text",
			aspect: "16:9",
			workspaceId: "ws-1",
		});
		const prompt = await readFile(promptLog, "utf8");

		expect(prompt).toContain("$imagegen a blue whale, no text");
		expect(prompt).toContain("Aspect ratio: 16:9");
	});

	it("stages managed references as CLI image attachments", async () => {
		const cacheDir = await withCache();
		const reference = join(cacheDir, "reference.png");
		writeFileSync(reference, "ref");
		const argsLog = join(await tempDir("codex-log-"), "refs.txt");
		process.env.FAKE_CODEX_ARGS_LOG = argsLog;

		await generateImageViaCodex({
			prompt: "a fox",
			referenceUrls: [`/files/${basename(reference)}`],
			workspaceId: "ws-1",
		});

		expect((await readFile(argsLog, "utf8")).trim()).toBe(reference);
	});

	it("returns a cached artifact for a repeated idempotency key", async () => {
		await withCache();
		const input = { prompt: "a fox", workspaceId: "ws-1", idempotencyKey: "idem-9" };

		const first = await generateImageViaCodex(input);
		const second = await generateImageViaCodex(input);

		expect(second.path).toBe(first.path);
		expect(second.from_cache).toBe(true);
	});

	it("keeps each attempt attributable when no idempotency key is supplied", async () => {
		await withCache();
		const input = { prompt: "a fox", workspaceId: "ws-1" };

		const first = await generateImageViaCodex(input);
		const second = await generateImageViaCodex(input);

		expect(second.path).not.toBe(first.path);
		expect(second.from_cache).toBe(false);
	});

	it("fails when the generated file has no readable bytes", async () => {
		await withCache();
		process.env.FAKE_CODEX_MODE = "empty";

		await expect(generateImageViaCodex({ prompt: "a fox", workspaceId: "ws-1" })).rejects.toThrow(
			/output file was empty/,
		);
	});

	it("fails on an unsupported output image type", async () => {
		await withCache();
		process.env.FAKE_CODEX_MODE = "bad-ext";

		await expect(generateImageViaCodex({ prompt: "a fox", workspaceId: "ws-1" })).rejects.toThrow(
			/unsupported image type/,
		);
	});

	it("rejects a reported path outside the run workspace", async () => {
		await withCache();
		process.env.FAKE_CODEX_MODE = "outside";

		await expect(generateImageViaCodex({ prompt: "a fox", workspaceId: "ws-1" })).rejects.toThrow(
			/outside its workspace/,
		);
	});

	it("fails when the CLI reports no output path", async () => {
		await withCache();
		process.env.FAKE_CODEX_MODE = "no-message";

		await expect(generateImageViaCodex({ prompt: "a fox", workspaceId: "ws-1" })).rejects.toThrow(
			/no output image path/,
		);
	});

	it("surfaces a non-zero CLI exit with its stderr", async () => {
		await withCache();
		process.env.FAKE_CODEX_MODE = "crash";

		await expect(generateImageViaCodex({ prompt: "a fox", workspaceId: "ws-1" })).rejects.toThrow(
			/exited 3.*exploded/s,
		);
	});

	it("fails loudly when the codex CLI is not on PATH", async () => {
		useNoCodex();

		await expect(generateImageViaCodex({ prompt: "a fox", workspaceId: "ws-1" })).rejects.toThrow(
			/not on PATH/,
		);
	});

	it("times out a CLI run that never answers", async () => {
		await withCache();
		process.env.FAKE_CODEX_MODE = "hang";
		process.env.MALEO_CODEX_IMAGE_TIMEOUT_MS = "300";

		await expect(generateImageViaCodex({ prompt: "a fox", workspaceId: "ws-1" })).rejects.toThrow(
			/timed out after 300ms/,
		);
	});

	it("aborts in-flight generation when the caller signal fires", async () => {
		await withCache();
		process.env.FAKE_CODEX_MODE = "hang";
		const controller = new AbortController();
		const pending = generateImageViaCodex({
			prompt: "a fox",
			workspaceId: "ws-1",
			signal: controller.signal,
		});
		controller.abort();

		await expect(pending).rejects.toThrow(/aborted/);
	});

	it("rejects an empty prompt before spawning the CLI", async () => {
		await expect(generateImageViaCodex({ prompt: "   \n ", workspaceId: "ws-1" })).rejects.toThrow(
			/non-empty prompt/,
		);
	});
});

describe("codex cache keying", () => {
	it("normalizes multi-line prompts", () => {
		expect(normalizeCodexPrompt("a blue\n\n  whale ")).toBe("a blue whale");
	});

	it("separates keys by workspace, project, aspect, and idempotency key", () => {
		const base = { prompt: "p", references: [], workspaceId: "ws-1" };
		const key = codexImageCacheKey(base);
		expect(codexImageCacheKey({ ...base, workspaceId: "ws-2" })).not.toBe(key);
		expect(codexImageCacheKey({ ...base, projectId: "pr-1" })).not.toBe(key);
		expect(codexImageCacheKey({ ...base, aspect: "9:16" })).not.toBe(key);
		expect(codexImageCacheKey({ ...base, idempotencyKey: "idem" })).not.toBe(key);
		expect(codexImageCacheKey({ ...base, prompt: "a blue\nwhale" })).toBe(
			codexImageCacheKey({ ...base, prompt: "a blue whale" }),
		);
	});

	it("names cache files under the codex provider prefix", async () => {
		await withCache();

		const result = await generateImageViaCodex({
			prompt: "a fox",
			workspaceId: "ws-1",
			idempotencyKey: "k",
		});

		expect(basename(result.path)).toBe(
			`codex-${codexImageCacheKey({ prompt: "a fox", references: [], workspaceId: "ws-1", idempotencyKey: "k" })}.png`,
		);
	});
});
