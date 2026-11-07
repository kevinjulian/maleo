/* Export through the Rust render host (OpenSpec p2-export E4, E6).
 *
 * `chooseRenderer` decides per job, when it starts: `MALEO_EXPORT_RENDERER=rust`
 * sends a storyboard job on the local backend to Rust when the host reports an
 * empty coverage report for every frame; everything else renders on Remotion,
 * and the job records why. `renderWithRust` maps the storyboard's media to local
 * files, runs the host, and reports its progress as the job's phase. */
import { rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { aspectMap, storyboardSeconds } from "@maleo/video/composition";
import type { Storyboard } from "@maleo/video/schema";
import {
	HostCancelled,
	hostCoverage,
	hostMediaUrls,
	hostRender,
	writeHostJob,
	type HostJob,
	type HostRun,
} from "./rust-host";
import { resolveRustInputs } from "./rust-inputs";

export const FPS = 30;

/** The slowest rate a Rust render may run at before it is stopped (task 3.5). The
 * production host draws a plain 1080x1920 frame at about 2 fps; a factor of 8
 * leaves room for heavy frames. */
export const MIN_RENDER_FPS = 0.25;
const TIMEOUT_BASE_SEC = 120;

/** Wall-time limit of one Rust render: a fixed start-up allowance plus the frames at `MIN_RENDER_FPS`. */
export function renderTimeoutSec(frames: number): number {
	return TIMEOUT_BASE_SEC + Math.ceil(frames / MIN_RENDER_FPS);
}

export type Renderer = "remotion" | "rust";
export interface RendererChoice {
	renderer: Renderer;
	note: string | null;
}

export function exportAuthority(): Renderer {
	return process.env.MALEO_EXPORT_RENDERER?.trim() === "rust" ? "rust" : "remotion";
}

/** Shadow comparison renders run unless `MALEO_EXPORT_SHADOW=off` (p2-export E6). */
export function shadowEnabled(): boolean {
	return process.env.MALEO_EXPORT_SHADOW?.trim() !== "off";
}

/** The renderer a shadow job runs: the one the authoritative job did not use. */
export function otherRenderer(renderer: Renderer): Renderer {
	return renderer === "rust" ? "remotion" : "rust";
}

/** Where a shadow job finds the authoritative output it is compared with. */
export function shadowReferencePath(outDir: string, shadowId: string): string {
	return path.join(outDir, "shadow", `${shadowId}.reference.mp4`);
}

const COMPOSITION_ASPECT: Record<string, keyof typeof aspectMap> = {
	StoryboardReel: "vertical",
	StoryboardSquare: "square",
	StoryboardWide: "horizontal",
};

/** The output a storyboard composition renders: Remotion's size and frame count. */
export function storyboardOutput(
	compositionId: string,
	storyboard: Storyboard,
): { width: number; height: number; fps: number; frames: number } | null {
	const aspect = COMPOSITION_ASPECT[compositionId];
	if (!aspect) return null;
	const { width, height } = aspectMap[aspect];
	return {
		width,
		height,
		fps: FPS,
		frames: Math.max(1, Math.ceil(storyboardSeconds(storyboard) * FPS)),
	};
}

function hostJob(
	storyboard: Storyboard,
	output: NonNullable<ReturnType<typeof storyboardOutput>>,
	media: Record<string, string>,
	out: string,
): HostJob {
	return { storyboard, media, ...output, out };
}

const problemSchema = z.object({ frame: z.number(), path: z.string(), reason: z.string() });

function coverageNote(problems: unknown[]): string {
	const parsed = problemSchema.safeParse(problems[0]);
	const first = parsed.success ? parsed.data : undefined;
	return first
		? `Rust renderer does not cover frame ${first.frame}: ${first.path} ${first.reason}`
		: "Rust renderer does not cover this storyboard";
}

export async function chooseRenderer(input: {
	jobId: string;
	compositionId: string;
	storyboard: Storyboard | null;
	backend: "local" | "lambda";
	workDir: string;
	run?: HostRun;
	/** The renderer wanted; the authority setting when absent. A shadow job passes its own. */
	want?: Renderer;
}): Promise<RendererChoice> {
	if ((input.want ?? exportAuthority()) !== "rust") return { renderer: "remotion", note: null };
	if (!input.storyboard)
		return { renderer: "remotion", note: "Product presets render through Remotion" };
	if (input.backend === "lambda")
		return { renderer: "remotion", note: "Lambda renders through Remotion" };
	const output = storyboardOutput(input.compositionId, input.storyboard);
	if (!output)
		return { renderer: "remotion", note: `${input.compositionId} renders through Remotion` };
	const jobFile = path.join(input.workDir, `${input.jobId}.coverage.json`);
	try {
		await writeHostJob(
			jobFile,
			hostJob(input.storyboard, output, {}, path.join(input.workDir, "unused.mp4")),
		);
		const problems = await hostCoverage(jobFile, input.run);
		return problems.length === 0
			? { renderer: "rust", note: null }
			: { renderer: "remotion", note: coverageNote(problems) };
	} catch (error) {
		// No usable host: Remotion keeps the export, and the job says why.
		return {
			renderer: "remotion",
			note: `Rust render host unavailable: ${error instanceof Error ? error.message : String(error)}`,
		};
	} finally {
		await rm(jobFile, { force: true });
	}
}

export async function renderWithRust(input: {
	jobId: string;
	compositionId: string;
	storyboard: Storyboard;
	outPath: string;
	workDir: string;
	publicBase: string;
	cancelled: () => boolean;
	onPhase: (detail: string) => void;
	onProgress: (fraction: number, detail: string) => void;
	run?: HostRun;
	/** Overrides `renderTimeoutSec(frames)`. */
	timeoutSec?: number;
}): Promise<void> {
	const output = storyboardOutput(input.compositionId, input.storyboard);
	if (!output) throw new Error(`${input.compositionId} has no Rust export`);
	const jobFile = path.join(input.workDir, `${input.jobId}.host.json`);
	const limitSec = input.timeoutSec ?? renderTimeoutSec(output.frames);
	const deadline = Date.now() + limitSec * 1000;
	let timedOut = false;
	const run: HostRun = {
		...input.run,
		cancelled: () => {
			if (Date.now() > deadline) timedOut = true;
			return timedOut || input.cancelled();
		},
		onPhase: (phase) => input.onPhase(`rust: ${phase}`),
		onFrame: (frame, frames) => input.onProgress(frame / frames, `rust: frame ${frame}/${frames}`),
	};
	await writeHostJob(jobFile, hostJob(input.storyboard, output, {}, input.outPath));
	let cleanup = async (): Promise<void> => {};
	try {
		const urls = await hostMediaUrls(jobFile, run);
		const inputs = await resolveRustInputs(urls, { publicBase: input.publicBase });
		cleanup = inputs.cleanup;
		await writeHostJob(jobFile, hostJob(input.storyboard, output, inputs.media, input.outPath));
		await hostRender(jobFile, run);
	} catch (error) {
		if (timedOut && error instanceof HostCancelled)
			throw new Error(`render host exceeded ${limitSec} s for ${output.frames} frames`);
		throw error;
	} finally {
		await cleanup();
		await rm(jobFile, { force: true });
	}
}
