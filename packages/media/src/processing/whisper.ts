import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { resolveRepoPath } from "../paths.ts";
import { MEDIA_INPUT_OPTIONS, runMediaCommand } from "./probe.ts";
import {
	downloadWhisperModel,
	installWhisperCpp,
	type WhisperModel,
} from "@remotion/install-whisper-cpp";

/* Declared in the run contract: the editor receives aligned words verbatim. */
import type { CaptionWord } from "@maleo/shared/agent-wire";
import { oneOf, alignCaptionWordsToScript, offsetCaptionWords } from "@maleo/shared";
export type { CaptionWord } from "@maleo/shared/agent-wire";

export interface LocalWhisperResult {
	words: CaptionWord[];
	cached: boolean;
	model: WhisperModel;
	detectedLanguage?: string;
}

export interface LocalWhisperStatus {
	ready: boolean;
	enabled: boolean;
	model: WhisperModel;
	version: string;
	whisperDir: string;
	cacheDir: string;
	mainInstalled: boolean;
	modelInstalled: boolean;
	ffmpegInstalled: boolean;
	cacheBytes: number;
}

const DEFAULT_VERSION = "1.5.5";
const DEFAULT_MODEL: WhisperModel = "base";
const defaultWhisperDir = resolveRepoPath("data/whisper.cpp");
const defaultCacheDir = resolveRepoPath("data/caption-cache");

export function whisperModel(): WhisperModel {
	const raw = process.env.MALEO_WHISPER_MODEL;
	const allowed: WhisperModel[] = [
		"tiny",
		"tiny.en",
		"base",
		"base.en",
		"small",
		"small.en",
		"medium",
		"medium.en",
		"large-v1",
		"large-v2",
		"large-v3",
		"large-v3-turbo",
	];
	return oneOf(raw, allowed) ?? DEFAULT_MODEL;
}

function whisperDir(): string {
	return resolveRepoPath(process.env.MALEO_WHISPER_CPP_DIR || defaultWhisperDir);
}

function cacheDir(): string {
	return resolveRepoPath(process.env.MALEO_CAPTION_CACHE_DIR || defaultCacheDir);
}

function enabled(): boolean {
	return process.env.MALEO_CAPTION_TRANSCRIBE === "1";
}

function autoInstall(): boolean {
	return process.env.MALEO_WHISPER_AUTO_INSTALL === "1";
}

function whisperVersion(): string {
	return process.env.MALEO_WHISPER_CPP_VERSION || DEFAULT_VERSION;
}

function modelPath(folder: string, model: WhisperModel): string {
	return path.join(folder, `ggml-${model}.bin`);
}

async function exists(pathname: string): Promise<boolean> {
	try {
		await stat(pathname);
		return true;
	} catch {
		return false;
	}
}

async function dirSizeBytes(pathname: string): Promise<number> {
	try {
		const entries = await readdir(pathname, { withFileTypes: true });
		let total = 0;
		for (const entry of entries) {
			const child = path.join(pathname, entry.name);
			if (entry.isDirectory()) total += await dirSizeBytes(child);
			else if (entry.isFile()) total += (await stat(child)).size;
		}
		return total;
	} catch {
		return 0;
	}
}

async function commandAvailable(command: string): Promise<boolean> {
	try {
		await runMediaCommand(command, ["-version"], AbortSignal.timeout(3000));
		return true;
	} catch {
		return false;
	}
}

export async function getLocalWhisperStatus(): Promise<LocalWhisperStatus> {
	const model = whisperModel();
	const folder = whisperDir();
	const mainInstalled = await exists(executable());
	const modelInstalled = await exists(modelPath(folder, model));
	const ffmpegInstalled = await commandAvailable("ffmpeg");
	return {
		ready: mainInstalled && modelInstalled && ffmpegInstalled,
		enabled: enabled(),
		model,
		version: whisperVersion(),
		whisperDir: folder,
		cacheDir: cacheDir(),
		mainInstalled,
		modelInstalled,
		ffmpegInstalled,
		cacheBytes: await dirSizeBytes(cacheDir()),
	};
}

export async function setupLocalWhisper(
	signal = AbortSignal.timeout(30 * 60 * 1000),
): Promise<LocalWhisperStatus> {
	await installRuntime(signal);
	return getLocalWhisperStatus();
}

/* The deployed image ships a prebuilt binary (MALEO_WHISPER_CPP_BIN), so setup
 * only fetches the model there; a source checkout still builds whisper.cpp. */
async function installRuntime(signal: AbortSignal): Promise<void> {
	const model = whisperModel();
	const folder = whisperDir();
	if (prebuiltExecutable()) {
		if (!(await exists(executable())))
			throw new Error(`Image has no whisper.cpp at ${executable()}; rebuild the image`);
	} else {
		/* A failed build leaves the clone without its binary, and the installer
		 * then treats the folder as installed and skips the build on every retry. */
		if ((await exists(folder)) && !(await exists(executable())))
			await rm(folder, { recursive: true, force: true });
		await installWhisperCpp({ to: folder, version: whisperVersion(), printOutput: false, signal });
		if (!(await exists(executable())))
			throw new Error(`whisper.cpp build produced no executable at ${executable()}`);
	}
	await mkdir(folder, { recursive: true });
	try {
		await downloadWhisperModel({ model, folder, printOutput: false, signal });
	} catch (error) {
		/* Same trap for the model: a truncated file is skipped on retry. */
		// ponytail: a crash mid-download still leaves a partial file; verify size if that happens.
		await rm(modelPath(folder, model), { force: true });
		throw error;
	}
}

async function ensureWhisperReady(signal: AbortSignal): Promise<void> {
	if (autoInstall()) await installRuntime(signal);
}

const wordSchema = z
	.object({
		text: z.string(),
		startSec: z.number().finite().nonnegative(),
		endSec: z.number().finite().nonnegative(),
	})
	.refine((word) => word.endSec > word.startSec);
const cacheSchema = z.object({
	words: z.array(wordSchema),
	detectedLanguage: z.string().optional(),
});
const transcriptionSchema = z.object({
	result: z.object({ language: z.string() }).optional(),
	transcription: z.array(
		z.object({
			text: z.string(),
			offsets: z.object({ from: z.number().finite(), to: z.number().finite() }),
		}),
	),
});

function prebuiltExecutable(): string | undefined {
	return process.env.MALEO_WHISPER_CPP_BIN?.trim() || undefined;
}

function executable(): string {
	const prebuilt = prebuiltExecutable();
	if (prebuilt) return prebuilt;
	const [major = 1, minor = 5, patch = 5] = whisperVersion().split(".").map(Number);
	const modern = major > 1 || minor > 7 || (minor === 7 && patch >= 4);
	return (
		path.join(whisperDir(), modern ? "build/bin/whisper-cli" : "main") +
		(process.platform === "win32" ? ".exe" : "")
	);
}

export async function transcribeLocalWhisper(input: {
	audioPath: string;
	language?: string;
	offsetSec?: number;
	text?: string;
	force?: boolean;
	signal?: AbortSignal;
}): Promise<LocalWhisperResult | null> {
	if (!input.force && !enabled()) return null;
	const signal = input.signal ?? AbortSignal.timeout(30 * 60 * 1000);
	signal.throwIfAborted();
	const audioPath = path.resolve(input.audioPath);
	if (!audioPath.toLowerCase().endsWith(".wav")) return null;
	const model = whisperModel();
	const version = whisperVersion();
	const audio = await readFile(audioPath);
	const hash = createHash("sha256")
		.update(audio)
		.update(model)
		.update(version)
		.update("split-on-word-v6-worker-owned")
		.update(input.language || "auto")
		.update(input.text || "")
		.digest("hex")
		.slice(0, 24);
	const dir = cacheDir();
	await mkdir(dir, { recursive: true });
	const cachePath = path.join(dir, `${hash}.words.json`);
	try {
		const cached = cacheSchema.parse(JSON.parse(await readFile(cachePath, "utf8")));
		signal.throwIfAborted();
		return {
			...cached,
			words: offsetCaptionWords(cached.words, input.offsetSec ?? 0),
			cached: true,
			model,
		};
	} catch {
		// cache miss
	}

	await ensureWhisperReady(signal);
	const scratch = await mkdtemp(path.join(dir, "recognize-"));
	try {
		const wav = path.join(scratch, "audio.wav"),
			output = path.join(scratch, "transcript");
		await runMediaCommand(
			"ffmpeg",
			[
				"-nostdin",
				"-v",
				"error",
				...MEDIA_INPUT_OPTIONS,
				"-i",
				audioPath,
				"-ar",
				"16000",
				"-ac",
				"1",
				"-c:a",
				"pcm_s16le",
				wav,
			],
			signal,
		);
		const dtw = model.replace(/^large-v/, "large.v").replace("-turbo", ".turbo");
		await runMediaCommand(
			executable(),
			[
				"-f",
				wav,
				"--output-file",
				output,
				"--output-json",
				"-ojf",
				"--max-len",
				"1",
				"--dtw",
				dtw,
				"-m",
				modelPath(whisperDir(), model),
				"-l",
				input.language || "auto",
				"--split-on-word",
				...(input.text?.trim() ? ["--prompt", input.text.trim().slice(0, 800)] : []),
			],
			signal,
		);
		signal.throwIfAborted();
		const parsed = transcriptionSchema.parse(JSON.parse(await readFile(`${output}.json`, "utf8")));
		const recognized = parsed.transcription.flatMap((item) => {
			const text = item.text.trim();
			// Whisper emits these event markers as text even for empty audio.
			const event = /^\[(BLANK_AUDIO|MUSIC|APPLAUSE|SILENCE|NO_SPEECH)\]$/i.test(text);
			return text && !event && item.offsets.to > item.offsets.from
				? [
						{
							text,
							startSec: Math.max(0, item.offsets.from / 1000),
							endSec: item.offsets.to / 1000,
						},
					]
				: [];
		});
		const words = alignCaptionWordsToScript(recognized, input.text);
		if (!words.length) return null;
		const cached = cacheSchema.parse({
			words,
			...(parsed.result?.language ? { detectedLanguage: parsed.result.language } : {}),
		});
		signal.throwIfAborted();
		const pending = path.join(scratch, "words.json");
		await writeFile(pending, JSON.stringify(cached));
		signal.throwIfAborted();
		await rename(pending, cachePath);
		return {
			...cached,
			words: offsetCaptionWords(words, input.offsetSec ?? 0),
			cached: false,
			model,
		};
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}
