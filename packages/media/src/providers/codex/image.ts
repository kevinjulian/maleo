/* Codex image generation. The CLI leaves its output under Codex storage and a
 * per-run temp workspace; only a copy inside the media-worker cache is a valid
 * media result, so neither original path escapes this module. */
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	CODEX_PROVIDER_ID,
	SUPPORTED_IMAGE_EXTENSIONS,
	codexImageTimeoutMs,
	type CodexImageExtension,
} from "./constants.ts";
import { runCodexCliImage } from "./cli.ts";
import { mediaWorkerCacheDir, resolveRepoPath } from "../../paths.ts";
import { imageExtensionFromPath } from "./extensions.ts";
import { resolveCodexReferences } from "./references.ts";

export interface CodexImageInput {
	prompt: string;
	aspect?: string;
	referenceUrls?: string[];
	workspaceId: string;
	projectId?: string;
	// Present only for deduplicated work; without it every attempt regenerates so
	// each generation stays individually attributable in the image ledger.
	idempotencyKey?: string;
	signal?: AbortSignal;
}

export interface CodexImageResult {
	path: string;
	from_cache: boolean;
}

export function normalizeCodexPrompt(prompt: string): string {
	return prompt
		.split(/\r?\n+/)
		.map((part) => part.trim())
		.filter(Boolean)
		.join(" ");
}

export function codexImageCacheKey(input: {
	prompt: string;
	aspect?: string;
	references: string[];
	workspaceId: string;
	projectId?: string;
	idempotencyKey?: string;
}): string {
	const parts = [
		CODEX_PROVIDER_ID,
		normalizeCodexPrompt(input.prompt),
		input.aspect ?? "",
		input.references.join(","),
		input.workspaceId,
		input.projectId ?? "",
		input.idempotencyKey ?? "",
	];
	return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

function cachedArtifact(key: string): string | null {
	return (
		SUPPORTED_IMAGE_EXTENSIONS.map((ext) =>
			join(mediaWorkerCacheDir(), `${CODEX_PROVIDER_ID}-${key}.${ext}`),
		).find((path) => existsSync(path)) ?? null
	);
}

function outputExtension(path: string): CodexImageExtension {
	const ext = imageExtensionFromPath(path);
	if (!ext) throw new Error(`Codex returned an unsupported image type: ${path}`);
	return ext;
}

// Copies the generated output into the worker cache and returns the managed path.
async function adoptOutput(reportedPath: string, fileName: string): Promise<string> {
	const sourcePath = resolveRepoPath(reportedPath);
	if (!existsSync(sourcePath))
		throw new Error(`Codex reported a missing output file: ${reportedPath}`);
	const bytes = await readFile(sourcePath);
	if (bytes.byteLength === 0) throw new Error(`Codex output file was empty: ${reportedPath}`);
	const cacheDir = mediaWorkerCacheDir();
	const cachePath = join(cacheDir, `${fileName}.${outputExtension(sourcePath)}`);
	await mkdir(cacheDir, { recursive: true });
	await writeFile(cachePath, bytes);
	return cachePath;
}

export async function generateImageViaCodex(input: CodexImageInput): Promise<CodexImageResult> {
	const prompt = normalizeCodexPrompt(input.prompt);
	if (!prompt) throw new Error("Codex image generation requires a non-empty prompt.");
	const references = resolveCodexReferences(input.referenceUrls);
	const key = codexImageCacheKey({ ...input, prompt, references });

	if (input.idempotencyKey) {
		const cached = cachedArtifact(key);
		if (cached) return { path: cached, from_cache: true };
	}

	const output = await runCodexCliImage(
		{ prompt, aspect: input.aspect, references },
		{ timeoutMs: codexImageTimeoutMs(), signal: input.signal },
	);
	const fileName = input.idempotencyKey
		? `${CODEX_PROVIDER_ID}-${key}`
		: `${CODEX_PROVIDER_ID}-${key}-${randomUUID()}`;
	try {
		return { path: await adoptOutput(output.path, fileName), from_cache: false };
	} finally {
		await output.cleanup();
	}
}
