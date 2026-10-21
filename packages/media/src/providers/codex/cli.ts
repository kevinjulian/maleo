import { PROMPT_FRAGMENTS } from "./cli-prompt-definitions.ts";
import { renderPromptParts } from "@maleo/shared";
/* The Codex boundary: `codex exec` running the `$imagegen` skill. The agent
 * generates through its built-in image tool (output lands under
 * $CODEX_HOME/generated_images), saves a copy into a per-run temp workspace, and
 * reports that path as its last message. */
import { homedir, tmpdir } from "node:os";
import { realpathSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import {
	CODEX_CLI_COMMAND,
	CODEX_IMAGE_FEATURE,
	CODEX_IMAGE_SKILL,
	codexCliPath,
	codexImageModel,
} from "./constants.ts";
import { spawnCapture } from "./spawn.ts";

const OUTPUT_FILE = "codex-image-result.txt";

export class CodexCliUnavailableError extends Error {
	constructor() {
		super(`no Codex image runner available; the ${CODEX_CLI_COMMAND} CLI is not on PATH`);
		this.name = "CodexCliUnavailableError";
	}
}

export interface CodexImageRequest {
	prompt: string;
	aspect?: string;
	references: string[];
}

export function buildCodexImagePrompt(input: CodexImageRequest): string {
	const lines = [
		renderPromptParts(PROMPT_FRAGMENTS.buildCodexImagePromptFragment0.parts, [
			CODEX_IMAGE_SKILL,
			input.prompt,
		]),
		"",
	];
	if (input.aspect)
		lines.push(
			renderPromptParts(PROMPT_FRAGMENTS.buildCodexImagePromptFragment1.parts, [input.aspect]),
			"",
		);
	if (input.references.length > 0) {
		lines.push(
			renderPromptParts(PROMPT_FRAGMENTS.buildCodexImagePromptFragment2.parts, [
				input.references.length,
			]),
			"",
		);
	}
	lines.push(
		PROMPT_FRAGMENTS.buildCodexImagePromptFragment3.parts[0],
		PROMPT_FRAGMENTS.buildCodexImagePromptFragment4.parts[0],
		PROMPT_FRAGMENTS.buildCodexImagePromptFragment5.parts[0],
		PROMPT_FRAGMENTS.buildCodexImagePromptFragment6.parts[0],
		PROMPT_FRAGMENTS.buildCodexImagePromptFragment7.parts[0],
	);
	return lines.join(PROMPT_FRAGMENTS.buildCodexImagePromptFragment8.parts[0]);
}

/* Exported for the arg-shape test. Each flag is load-bearing:
 *  --ephemeral / --ignore-user-config  the text provider learned that user
 *      config lifecycle hooks can hang the process past its timeout;
 *  --sandbox workspace-write + -C      the agent must be able to write the image
 *      into its own temp workspace and nowhere else;
 *  tools.web_search=false              this is a single-shot generation, not
 *      research; left on, the agent wanders and blows the timeout. */
export function buildCodexImageArgs(input: {
	workDir: string;
	references: string[];
	model?: string;
}): string[] {
	return [
		"exec",
		"--color",
		"never",
		"--sandbox",
		"workspace-write",
		"--ephemeral",
		"--ignore-user-config",
		"--skip-git-repo-check",
		"--enable",
		CODEX_IMAGE_FEATURE,
		"-c",
		"tools.web_search=false",
		...(input.model ? ["-c", `model=${input.model}`] : []),
		"-C",
		input.workDir,
		"--output-last-message",
		join(input.workDir, OUTPUT_FILE),
		...input.references.flatMap((path) => ["-i", path]),
		"-",
	];
}

function codexHome(): string {
	return process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
}

/* Compare real paths, not strings. On macOS `/var` is a symlink to `/private/var`,
 * so a temp dir created as `/var/folders/…` is reported back by Codex as
 * `/private/var/folders/…` — the same directory, and a raw string compare
 * rejected it. Resolving symlinks also closes the reverse hole: a symlink planted
 * inside the workspace that points outside it no longer passes the check. */
function canonical(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}

function isInside(root: string, path: string): boolean {
	const base = canonical(root);
	const target = canonical(path);
	return target === base || target.startsWith(base.endsWith(sep) ? base : base + sep);
}

/* The reported path comes out of a model turn, so it is untrusted: constrain it
 * to the run's own workspace or Codex's own image storage. Without this, a
 * prompt-injected reply could name any readable file on the box and this package
 * would publish it into the worker cache as a generated image. */
export function parseCodexOutputPath(lastMessage: string, workDir: string): string {
	const line = lastMessage
		.split("\n")
		.map((part) =>
			part
				.trim()
				.replace(/^[`'"]+|[`'"]+$/g, "")
				.trim(),
		)
		.filter(Boolean)
		.at(-1);
	if (!line) throw new Error("Codex CLI reported no output image path.");
	const path = resolve(workDir, line);
	if (!isInside(workDir, path) && !isInside(codexHome(), path)) {
		throw new Error(`Codex CLI reported an image path outside its workspace: ${line}`);
	}
	return path;
}

export interface CodexCliOutput {
	path: string;
	cleanup: () => Promise<void>;
}

export async function runCodexCliImage(
	request: CodexImageRequest,
	options: { timeoutMs: number; signal?: AbortSignal },
): Promise<CodexCliOutput> {
	if (!codexCliPath()) throw new CodexCliUnavailableError();
	// Canonical from the start: Codex reports the resolved path back, so handing it
	// a symlinked workspace guarantees the two forms disagree.
	const workDir = await realpath(await mkdtemp(join(tmpdir(), "maleo-codex-image-")));
	const cleanup = (): Promise<void> => rm(workDir, { recursive: true, force: true });
	try {
		const result = await spawnCapture(
			CODEX_CLI_COMMAND,
			buildCodexImageArgs({ workDir, references: request.references, model: codexImageModel() }),
			{
				timeoutMs: options.timeoutMs,
				signal: options.signal,
				stdin: buildCodexImagePrompt(request),
				cwd: workDir,
				label: "Codex image CLI",
			},
		);
		if (result.code !== 0) {
			throw new Error(
				`Codex image CLI exited ${result.code}: ${result.stderr.trim().slice(-400) || "no output"}`,
			);
		}
		const lastMessage = await readFile(join(workDir, OUTPUT_FILE), "utf8").catch(() => "");
		return { path: parseCodexOutputPath(lastMessage, workDir), cleanup };
	} catch (error) {
		await cleanup();
		throw error;
	}
}
