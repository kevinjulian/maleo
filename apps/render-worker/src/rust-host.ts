/* The worker's side of the Rust render host (`maleo-render`, OpenSpec p2-export E4).
 *
 * One process per job. The job file carries the prepared storyboard, the local
 * file of every media URL, the output size, rate and frame count, and the output
 * path. stdout carries JSON lines (`crates/render-host/src/progress.rs`); the exit
 * code says how the run ended: 0 done, 1 failed, 2 refused (coverage), 143
 * cancelled. Cancel is SIGTERM; the host removes its partial files. */
import { writeFile } from "node:fs/promises";
import { z } from "zod";

export function renderHostCommand(): string[] {
	return [process.env.MALEO_RENDER_HOST?.trim() || "maleo-render"];
}

export interface HostJob {
	storyboard: unknown;
	media: Record<string, string>;
	width: number;
	height: number;
	fps: number;
	frames: number;
	out: string;
}

const lineSchema = z.union([
	z.object({ phase: z.string(), frame: z.number().int(), frames: z.number().int().positive() }),
	z.object({ phase: z.string() }),
	z.object({ done: z.literal(true), frames: z.number().int() }),
	z.object({ refused: z.string(), coverage: z.unknown() }),
	z.object({ failed: z.string(), stage: z.string() }),
	z.object({ cancelled: z.literal(true) }),
]);

export class HostRefused extends Error {}
export class HostFailed extends Error {
	constructor(
		readonly stage: string,
		message: string,
	) {
		super(message);
	}
}
export class HostCancelled extends Error {}

export interface HostRun {
	command?: string[];
	onPhase?: (phase: string) => void;
	onFrame?: (frame: number, frames: number) => void;
	/** Polled while the host runs; true sends SIGTERM. */
	cancelled?: () => boolean;
	pollMs?: number;
}

async function readLines(
	stream: ReadableStream<Uint8Array>,
	each: (line: string) => void,
): Promise<void> {
	const decoder = new TextDecoder();
	const reader = stream.getReader();
	let pending = "";
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		pending += decoder.decode(value, { stream: true });
		let at: number;
		while ((at = pending.indexOf("\n")) >= 0) {
			each(pending.slice(0, at));
			pending = pending.slice(at + 1);
		}
	}
	if (pending.trim()) each(pending);
}

async function invoke(
	args: string[],
	run: HostRun,
): Promise<{
	code: number;
	refused?: string;
	failed?: { stage: string; message: string };
	stdout: string[];
}> {
	const command = [...(run.command ?? renderHostCommand()), ...args];
	// The environment as it is now: FFmpeg paths, encoder and WGPU backend come from it.
	const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe", env: { ...process.env } });
	const stdout: string[] = [];
	let refused: string | undefined;
	let failed: { stage: string; message: string } | undefined;
	let terminated = false;
	const poll = setInterval(() => {
		if (!terminated && run.cancelled?.()) {
			terminated = true;
			child.kill("SIGTERM");
		}
	}, run.pollMs ?? 500);
	const stderr = new Response(child.stderr).text();
	try {
		await readLines(child.stdout, (line) => {
			stdout.push(line);
			let value: unknown;
			try {
				value = JSON.parse(line);
			} catch {
				return;
			}
			const parsed = lineSchema.safeParse(value);
			if (!parsed.success) return;
			const event = parsed.data;
			if ("refused" in event) refused = event.refused;
			else if ("failed" in event) failed = { stage: event.stage, message: event.failed };
			else if ("frame" in event) run.onFrame?.(event.frame, event.frames);
			else if ("phase" in event) run.onPhase?.(event.phase);
		});
		const code = await child.exited;
		if (code !== 0 && !failed && !refused && code !== 143)
			failed = {
				stage: "host",
				message: (await stderr).trim().slice(-500) || `exited with ${code}`,
			};
		return { code, refused, failed, stdout };
	} finally {
		clearInterval(poll);
	}
}

function outcome(result: Awaited<ReturnType<typeof invoke>>): void {
	if (result.code === 143) throw new HostCancelled("render host cancelled");
	if (result.code === 2)
		throw new HostRefused(result.refused ?? "render host refused the storyboard");
	if (result.code !== 0) {
		const failed = result.failed ?? { stage: "host", message: `exited with ${result.code}` };
		throw new HostFailed(failed.stage, `render host failed at ${failed.message}`);
	}
}

/** Writes the job file and returns its path. */
export async function writeHostJob(path: string, job: HostJob): Promise<string> {
	await writeFile(path, JSON.stringify(job));
	return path;
}

/** The media URLs the storyboard draws or plays. */
export async function hostMediaUrls(jobFile: string, run: HostRun = {}): Promise<string[]> {
	const result = await invoke(["media", "--job", jobFile], run);
	outcome(result);
	return z.array(z.string()).parse(JSON.parse(result.stdout.at(-1) ?? "[]"));
}

/** Coverage problems over every frame; empty means the Rust host can render it. */
export async function hostCoverage(jobFile: string, run: HostRun = {}): Promise<unknown[]> {
	const result = await invoke(["coverage", "--job", jobFile], run);
	outcome(result);
	return z.array(z.unknown()).parse(JSON.parse(result.stdout.at(-1) ?? "[]"));
}

/** Renders the job's MP4 to its `out`. Throws HostRefused, HostFailed or HostCancelled. */
export async function hostRender(jobFile: string, run: HostRun = {}): Promise<void> {
	outcome(await invoke(["render", "--job", jobFile], run));
}

const planSchema = z.object({
	samples: z.array(
		z.object({
			frame: z.number().int(),
			time: z.number(),
			why: z.enum(["scene", "transition", "second"]),
		}),
	),
	clips: z.array(z.object({ path: z.string(), url: z.string(), start: z.number() })),
});
export type HostPlan = z.infer<typeof planSchema>;

/** The frames a comparison samples and the start of each audio clip (p2-export E7). */
export async function hostPlan(jobFile: string, run: HostRun = {}): Promise<HostPlan> {
	const result = await invoke(["plan", "--job", jobFile], run);
	outcome(result);
	return planSchema.parse(JSON.parse(result.stdout.at(-1) ?? "{}"));
}

const scoresSchema = z.array(
	z.object({ name: z.string(), ssim: z.number(), difference: z.string().nullable() }),
);
export type FrameScore = z.infer<typeof scoresSchema>[number];

/** Golden-scorer SSIM of same-named PNGs; a difference image for each score below `below`. */
export async function hostCompareFrames(
	dirs: { reference: string; candidate: string; difference: string },
	below: number,
	run: HostRun = {},
): Promise<FrameScore[]> {
	const result = await invoke(
		[
			"compare-frames",
			"--reference",
			dirs.reference,
			"--candidate",
			dirs.candidate,
			"--difference",
			dirs.difference,
			"--below",
			String(below),
		],
		run,
	);
	outcome(result);
	return scoresSchema.parse(JSON.parse(result.stdout.at(-1) ?? "[]"));
}
